# Direct MessagePack Encoder - High Performance Query Streaming

## Goal

Optimize the entire query streaming pipeline end-to-end:
- **First rows visible**: <10ms
- **10K rows total**: <30ms
- **Memory**: Minimal allocations, reuse buffers, reduce GC pressure

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ RUST (src-tauri)                                                │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL Binary Protocol                                     │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────┐                       │
│  │ DirectMsgPackEncoder                │                       │
│  │ - Skip serde_json::Value entirely   │                       │
│  │ - rmp::encode direct to buffer      │                       │
│  │ - Pre-allocated buffers             │                       │
│  │ - Micro-batch streaming (16→64→256) │                       │
│  └─────────────────────────────────────┘                       │
│         │                                                       │
│         ▼                                                       │
│  IPC Channel (raw bytes)                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐                       │
│  │ msgpackr decoder (Web Worker)       │                       │
│  │ - 2-3x faster than @msgpack/msgpack │                       │
│  │ - Safari compatible                 │                       │
│  │ - Reusable decoder instance         │                       │
│  └─────────────────────────────────────┘                       │
│         │                                                       │
│         ▼                                                       │
│  React state update (progressive)                               │
└─────────────────────────────────────────────────────────────────┘
```

## Rust Direct MessagePack Encoder

### File: `src-tauri/src/adapters/postgres/direct_msgpack.rs`

**Core principles:**
1. Zero intermediate allocations - PostgreSQL bytes → MessagePack bytes directly
2. Pre-allocated buffers - Estimate size based on column types
3. Inline hot paths - `#[inline(always)]` for type converters
4. Stack buffers for small values - Avoid heap for timestamps, UUIDs, etc.

```rust
pub struct DirectMsgPackEncoder {
    buffer: Vec<u8>,           // Reusable encoding buffer
    column_types: Vec<Type>,   // Cached column types
}

impl DirectMsgPackEncoder {
    /// Encode batch of rows directly to MessagePack
    pub fn encode_batch(&mut self, rows: &[Row]) -> Vec<u8> {
        let estimated_size = self.estimate_size(rows.len());
        self.buffer.clear();
        self.buffer.reserve(estimated_size);

        // Write array header
        rmp::encode::write_array_len(&mut self.buffer, rows.len() as u32);

        for row in rows {
            self.encode_row(row);
        }

        self.buffer.clone()
    }

    #[inline(always)]
    fn encode_row(&mut self, row: &Row) {
        rmp::encode::write_array_len(&mut self.buffer, self.column_types.len() as u32);
        for (idx, pg_type) in self.column_types.iter().enumerate() {
            self.encode_cell(row, idx, pg_type);
        }
    }

    #[inline(always)]
    fn encode_cell(&mut self, row: &Row, idx: usize, pg_type: &Type) {
        // Direct binary → msgpack encoding per type
    }
}
```

### Buffer Size Estimation

| Type | Estimated bytes |
|------|-----------------|
| BOOL | 1 |
| INT2/INT4 | 3-5 |
| INT8/FLOAT8 | 9 |
| TEXT (avg) | 32 |
| TIMESTAMP | 24 |
| UUID | 38 |
| JSONB | 128 |

### Type Encoders

Each PostgreSQL type gets a dedicated inline encoder:

```rust
#[inline(always)]
fn encode_bool(&mut self, raw: &[u8]) {
    let val = proto::bool_from_sql(raw).unwrap_or(false);
    rmp::encode::write_bool(&mut self.buffer, val).unwrap();
}

#[inline(always)]
fn encode_int4(&mut self, raw: &[u8]) {
    let val = proto::int4_from_sql(raw).unwrap_or(0);
    rmp::encode::write_i32(&mut self.buffer, val).unwrap();
}

#[inline(always)]
fn encode_text(&mut self, raw: &[u8]) {
    // Direct string encoding, no intermediate String allocation
    rmp::encode::write_str(&mut self.buffer,
        std::str::from_utf8(raw).unwrap_or("")).unwrap();
}

#[inline(always)]
fn encode_timestamp(&mut self, raw: &[u8]) {
    // Stack buffer for formatting - no heap allocation
    let mut stack_buf = [0u8; 32];
    let len = format_timestamp(raw, &mut stack_buf);
    rmp::encode::write_str(&mut self.buffer,
        std::str::from_utf8(&stack_buf[..len]).unwrap()).unwrap();
}
```

## Frontend msgpackr Decoder

### File: `src/services/streamDecode.worker.ts`

Replace `@msgpack/msgpack` with `msgpackr`:

```typescript
import { Decoder } from "msgpackr";

// Reusable decoder instance
const decoder = new Decoder({
  useRecords: false,      // Return plain arrays
  mapsAsObjects: true,
  int64AsNumber: true,
});

self.onmessage = (event: MessageEvent<StreamWorkerRequest>) => {
  if (message.type === "decode") {
    const rows = decoder.decode(new Uint8Array(message.buffer));
    respond({ id: message.id, type: "decoded", rows });
  }
};
```

### Performance Comparison

| Decoder | Decode time (10K rows) |
|---------|------------------------|
| @msgpack/msgpack | ~15-20ms |
| msgpackr | ~5-8ms |

## Micro-Batch Streaming Strategy

### Batch Progression

```
Time →
├─ 0-5ms ──┼─ 5-15ms ─┼─ 15-30ms ─┼─ 30ms+ ────────┤
│          │          │           │                │
│ Batch 1  │ Batch 2  │ Batch 3   │ Batch 4+       │
│ 16 rows  │ 64 rows  │ 256 rows  │ 1024 rows      │
│ INSTANT  │ FAST     │ SMOOTH    │ BULK           │
```

### Rust Implementation

```rust
const BATCH_SIZES: &[usize] = &[16, 64, 256, 1024, 2048];

let mut batch_idx = 0;
let mut current_batch = Vec::with_capacity(BATCH_SIZES[0]);
let mut encoder = DirectMsgPackEncoder::new(&column_types);

while let Some(row) = stream.next().await {
    current_batch.push(row);

    let batch_size = BATCH_SIZES[batch_idx.min(BATCH_SIZES.len() - 1)];

    if current_batch.len() >= batch_size {
        let msgpack = encoder.encode_batch(&current_batch);
        data_channel.send(Response::new(msgpack));

        current_batch.clear();
        batch_idx += 1;
    }
}

// Send remaining
if !current_batch.is_empty() {
    let msgpack = encoder.encode_batch(&current_batch);
    data_channel.send(Response::new(msgpack));
}
```

## File Changes

### Create

- `src-tauri/src/adapters/postgres/direct_msgpack.rs` - DirectMsgPackEncoder

### Modify

- `src-tauri/src/adapters/postgres/mod.rs` - Add direct_msgpack module
- `src-tauri/src/adapters/postgres/query_fast.rs` - Use DirectMsgPackEncoder
- `src-tauri/src/commands.rs` - Update batch sizes, integrate encoder
- `src/services/streamDecode.worker.ts` - Replace with msgpackr
- `package.json` - Replace @msgpack/msgpack with msgpackr

## Expected Performance

| Metric | v0.9.0 | Target |
|--------|--------|--------|
| First rows visible | ~30ms | <10ms |
| Total time (10K rows) | ~88ms | <30ms |
| Conversion time | ~20ms | <8ms |
| Memory allocations | High | Minimal |

## Verification

1. Run `cargo test` - Rust unit tests
2. Run `pnpm test:unit` - Frontend tests
3. Manual test with 10K+ row query
4. Compare Performance Breakdown metrics before/after
