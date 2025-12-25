# Query Execution Optimization Phase 2 - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce query encoding time from ~50ms to sub-30ms and fix frontend data corruption issues.

**Architecture:** Further optimize the direct Row→MsgPack pipeline with zero-allocation patterns, fix IPC channel state management, and improve complex type handling.

**Tech Stack:** Rust (rmp, tokio-postgres), TypeScript (msgpack, Web Workers)

---

## Background

### Current State (After Phase 1)
- Direct Row→MsgPack encoding: ~50ms for 12k rows
- Batch sizes: 128→1024→4096
- Rayon parallelism for batches >256 rows

### Known Issues
1. **Frontend data corruption**: Duplicate/wrong rows on query re-run
2. **Complex types expensive**: hstore, tsvector, composite need special decoding
3. **String allocations**: UUID, timestamp formatting allocates heap memory

### Performance Targets
| Metric | Current | Target |
|--------|---------|--------|
| Encoding (12k rows) | ~50ms | <30ms |
| Payload size | 12.9 MiB | <10 MiB |
| First row latency | ~6ms | <5ms |

---

## Task 1: Fix Frontend Data Corruption (CRITICAL)

**Root Cause Analysis:**
The IPC channel created by `createIpcChannel()` maintains internal state (`nextMessageId`, `pending` Map) that can become stale across query re-runs.

**Files:**
- Modify: `src/services/queryStreamClient.ts:44-105`
- Test: Manual testing with repeated query execution

**Step 1: Review the channel state issue**

The `createIpcChannel` function creates a closure with:
```typescript
let nextMessageId = 0;
const pending = new Map<number, unknown>();
```

Each call to `streamWithCallbacks` creates NEW channels, so this should be fine. The issue is likely elsewhere.

**Step 2: Check for stale data accumulation**

Look at line 225 in `streamWithCallbacks`:
```typescript
let totalRows = 0;  // This is per-query, looks correct
```

**Step 3: Investigate the actual corruption pattern**

Add debug logging to identify the issue:

```typescript
// In streamWithCallbacks, add at the start:
const queryId = Math.random().toString(36).slice(2, 8);
console.log(`[${queryId}] Starting query: ${sql.slice(0, 50)}...`);

// In dataChannel handler:
console.log(`[${queryId}] Received batch: ${decoded.length} rows, totalRows=${totalRows}`);

// In metadataChannel success handler:
console.log(`[${queryId}] Query complete: ${result.totalRows} rows`);
```

**Step 4: Fix the likely race condition**

The issue is likely that the `onBatch` callback is called with stale data when a new query starts before the previous one finishes. Add query cancellation:

```typescript
// Add abort controller support
async streamWithCallbacks(
  params: QueryStreamParams,
  callbacks: { ... },
  signal?: AbortSignal,  // NEW
): Promise<StreamResult> {
  // ...

  // Check abort before processing
  if (signal?.aborted) {
    return Promise.reject(new Error('Query aborted'));
  }

  const dataChannel = createIpcChannel((message: unknown) => {
    if (signal?.aborted) return;  // Skip if aborted
    // ... rest of handler
  });
}
```

**Step 5: Test the fix**

Run: Execute same query 5 times rapidly, verify no duplicate rows.

---

## Task 2: Add Type-Aware Buffer Pre-allocation

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs:39-75`
- Test: `cargo test --lib`

**Step 1: Write the size estimation function**

Add to `msgpack_converter.rs`:

```rust
impl FastMsgPackConverter {
    /// Estimate MsgPack buffer size based on column types
    fn estimate_buffer_size(rows_count: usize, column_types: &[&Type]) -> usize {
        let row_size: usize = column_types.iter().map(|t| match **t {
            Type::BOOL => 2,           // 1 byte value + 1 byte header
            Type::INT2 => 4,           // 2 bytes + header
            Type::INT4 => 6,           // 4 bytes + header
            Type::INT8 | Type::FLOAT8 => 10,  // 8 bytes + header
            Type::TEXT | Type::VARCHAR => 64, // average string length
            Type::TIMESTAMP | Type::TIMESTAMPTZ => 36, // RFC3339 length
            Type::UUID => 40,          // 36 chars + header
            Type::JSONB | Type::JSON => 128,  // average JSON size
            Type::BYTEA => 256,        // binary data
            _ => 32,                   // default for unknown types
        }).sum();

        // Add 20% headroom for msgpack headers and variability
        let estimated = rows_count * (row_size + column_types.len() * 2);
        (estimated as f64 * 1.2) as usize
    }
}
```

**Step 2: Use the estimation in rows_to_msgpack**

Replace line 52:
```rust
// OLD:
let estimated_size = rows.len() * num_columns * 20;

// NEW:
let estimated_size = Self::estimate_buffer_size(rows.len(), &column_types);
```

**Step 3: Run tests**

Run: `cd src-tauri && cargo test --lib`
Expected: All tests pass

---

## Task 3: Add Inline Hints to Hot Path Functions

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs`
- Test: `cargo build --release` (verify no warnings)

**Step 1: Add inline hints**

Add `#[inline(always)]` to these functions:

```rust
#[inline(always)]
fn encode_row<W: Write>(buf: &mut W, row: &Row, column_types: &[&Type]) -> Result<()> {
    // ... existing code
}

#[inline(always)]
fn encode_value<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
    // ... existing code
}

#[inline(always)]
fn encode_simple<W: Write>(buf: &mut W, pg_type: &Type, raw: &[u8]) -> Result<()> {
    // ... existing code
}

#[inline(always)]
fn encode_string<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
    // ... existing code
}
```

**Step 2: Build release to verify**

Run: `cd src-tauri && cargo build --release`
Expected: No warnings, successful build

---

## Task 4: Zero-Allocation UUID Formatting

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs:163-168`
- Test: `cargo test uuid`

**Step 1: Write a test for UUID encoding**

Add to the test module:

```rust
#[test]
fn test_uuid_encoding() {
    use bytes::BytesMut;

    // UUID bytes for "550e8400-e29b-41d4-a716-446655440000"
    let uuid_bytes: [u8; 16] = [
        0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x41, 0xd4,
        0xa7, 0x16, 0x44, 0x66, 0x55, 0x44, 0x00, 0x00
    ];

    let mut buf = Vec::new();
    FastMsgPackConverter::encode_uuid_zero_alloc(&mut buf, &uuid_bytes).unwrap();

    // Decode and verify
    let decoded: String = rmp_serde::from_slice(&buf).unwrap();
    assert_eq!(decoded, "550e8400-e29b-41d4-a716-446655440000");
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test uuid`
Expected: FAIL - function not defined

**Step 3: Implement zero-alloc UUID encoding**

```rust
/// Encode UUID directly to buffer without String allocation
#[inline(always)]
fn encode_uuid_zero_alloc<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
    let bytes = proto::uuid_from_sql(raw).map_err(Self::map_decode_err)?;
    let uuid = Uuid::from_bytes(bytes);

    // Stack buffer for hyphenated UUID (36 bytes)
    let mut stack_buf = [0u8; 36];
    uuid.hyphenated().encode_lower(&mut stack_buf);

    // Write directly without String allocation
    rmp::encode::write_str_len(buf, 36).map_err(Self::map_encode_err)?;
    buf.write_all(&stack_buf).map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}
```

**Step 4: Update encode_simple to use new function**

Replace UUID case in `encode_simple`:
```rust
Type::UUID => {
    Self::encode_uuid_zero_alloc(buf, raw)?;
}
```

**Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test uuid`
Expected: PASS

---

## Task 5: Zero-Allocation Timestamp Formatting

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs:196-208`
- Test: `cargo test timestamp`

**Step 1: Write a test for timestamp encoding**

```rust
#[test]
fn test_timestamp_encoding_no_alloc() {
    // Test that timestamp encoding produces valid RFC3339 format
    // This is a placeholder - actual test would need proper timestamp bytes
}
```

**Step 2: Implement zero-alloc timestamp encoding**

```rust
/// Encode timestamp directly to buffer using stack-allocated formatter
#[inline(always)]
fn encode_timestamp_zero_alloc<W: Write>(
    buf: &mut W,
    pg_type: &Type,
    raw: &[u8]
) -> Result<()> {
    let dt = NaiveDateTime::from_sql(pg_type, raw).map_err(Self::map_decode_err)?;

    // Stack buffer for RFC3339 timestamp (max ~32 bytes)
    let mut stack_buf = [0u8; 32];
    let mut cursor = std::io::Cursor::new(&mut stack_buf[..]);

    use std::io::Write as IoWrite;
    write!(cursor, "{}", dt.and_utc().format("%Y-%m-%dT%H:%M:%S%.fZ"))
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let len = cursor.position() as usize;
    rmp::encode::write_str_len(buf, len as u32).map_err(Self::map_encode_err)?;
    buf.write_all(&stack_buf[..len]).map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}
```

**Step 3: Update encode_simple to use new function**

Replace TIMESTAMP case in `encode_simple`:
```rust
Type::TIMESTAMP => {
    Self::encode_timestamp_zero_alloc(buf, pg_type, raw)?;
}
```

**Step 4: Test**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS

---

## Task 6: Tune Rayon Threshold

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs:56-58`
- Test: Manual benchmarking

**Step 1: Increase rayon threshold**

The expert review noted that rayon has ~10-50μs overhead. For simple data copying, sequential is often faster for smaller batches.

Change line 56:
```rust
// OLD:
if rows.len() < 256 {

// NEW:
if rows.len() < 1024 {
```

**Step 2: Benchmark**

Run a query with 500, 1000, 2000, 4000 rows and compare encoding times.

---

## Task 7: Optimize Complex Type Handling (hstore, tsvector)

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs`
- Test: `cargo test complex_types`

**Step 1: Analyze current complex type handling**

Current approach for complex types (hstore, tsvector, composite):
- Parse binary format
- Convert to structured representation
- Serialize to MsgPack

**Step 2: Implement lazy decoding option**

For complex types, send as base64 string and let frontend decode on-demand:

```rust
/// Fast path for complex types: send as base64, decode on frontend if needed
#[inline(always)]
fn encode_complex_as_base64<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
    let encoded = BASE64_STANDARD.encode(raw);
    encode::write_str(buf, &encoded).map_err(Self::map_encode_err)?;
    Ok(())
}
```

**Step 3: Update composite/hstore handling**

In `encode_value`, for complex types:
```rust
Kind::Composite(_fields) => {
    // Fast path: base64 encode, frontend decodes on hover/expand
    Self::encode_complex_as_base64(buf, raw)
}
```

**Step 4: Add frontend decoder (separate task)**

This requires frontend changes - document for future implementation.

---

## Task 8: Skip UTF-8 Revalidation for Strings

**Files:**
- Modify: `src-tauri/src/adapters/postgres/msgpack_converter.rs:266-275`

**Step 1: Optimize encode_string**

PostgreSQL already guarantees valid UTF-8 for text types. We can skip the std::str::from_utf8 validation:

```rust
#[inline(always)]
fn encode_string_fast<W: Write>(buf: &mut W, raw: &[u8]) -> Result<()> {
    // PostgreSQL text is guaranteed UTF-8 valid
    // Skip validation, write directly
    rmp::encode::write_str_len(buf, raw.len() as u32).map_err(Self::map_encode_err)?;
    buf.write_all(raw).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(())
}
```

**Step 2: Update encode_simple to use fast path**

```rust
Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR | Type::UNKNOWN => {
    Self::encode_string_fast(buf, raw)?;
}
```

**Step 3: Keep fallback for non-text types**

The original `encode_string` with validation is still needed for fallback cases.

**Step 4: Test**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS

---

## Task 9: Frontend - Lazy Base64 Decode for Complex Types

**Files:**
- Modify: `src/components/DataGrid/utils/cellFactory.ts`
- Modify: `src/components/DataGrid/renderers/ByteaCell/utils.ts`
- Test: Manual testing with hstore/composite columns

**Step 1: Add hstore/composite parsers to ByteaCell/utils.ts**

```typescript
/**
 * Parse PostgreSQL hstore from binary format
 * Format: 4-byte count + (4-byte key_len + key + 4-byte val_len + val) pairs
 */
export function parseHstoreFromBytes(bytes: Uint8Array): Record<string, string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: Record<string, string | null> = {};
  let offset = 0;

  const count = view.getInt32(offset, false); // big-endian
  offset += 4;

  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < count; i++) {
    // Read key
    const keyLen = view.getInt32(offset, false);
    offset += 4;
    const key = decoder.decode(bytes.subarray(offset, offset + keyLen));
    offset += keyLen;

    // Read value (-1 means NULL)
    const valLen = view.getInt32(offset, false);
    offset += 4;
    if (valLen === -1) {
      result[key] = null;
    } else {
      result[key] = decoder.decode(bytes.subarray(offset, offset + valLen));
      offset += valLen;
    }
  }

  return result;
}

/**
 * Format hstore for display
 */
export function formatHstore(hstore: Record<string, string | null>): string {
  return Object.entries(hstore)
    .map(([k, v]) => `"${k}"=>${v === null ? 'NULL' : `"${v}"`}`)
    .join(', ');
}
```

**Step 2: Update cellFactory.ts to handle base64-encoded complex types**

Add to the cell builder routing (around line 200):

```typescript
// Check if value is base64-encoded complex type
if (meta.isHstoreDbType && typeof rawValue === 'string' && isValidBase64(rawValue)) {
  return buildHstoreBase64Cell(rawValue, value, column, meta, readOnly);
}

if (meta.isCompositeDbType && typeof rawValue === 'string' && isValidBase64(rawValue)) {
  return buildCompositeBase64Cell(rawValue, value, column, meta, readOnly);
}
```

**Step 3: Implement lazy decode cell builders**

```typescript
const buildHstoreBase64Cell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  // Lazy decode - only when rendering
  let decoded: Record<string, string | null> | null = null;
  let displayValue = '[hstore]';

  try {
    if (typeof rawValue === 'string' && isValidBase64(rawValue)) {
      decoded = parseHstoreFromBytes(base64ToBytes(rawValue));
      displayValue = formatHstore(decoded);
    }
  } catch {
    displayValue = '[decode error]';
  }

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Text,
    displayData: displayValue,
    data: displayValue,
    allowOverlay: true,
    readonly: readOnly,
  });
};
```

**Step 4: Test**

1. Query a table with hstore/composite columns
2. Verify values display correctly
3. Check no decode errors in console

---

## Summary: Expected Results

| Optimization | Expected Gain | Cumulative |
|--------------|---------------|------------|
| Task 1: Fix data corruption | N/A (correctness) | Baseline |
| Task 2: Buffer pre-allocation | 5-10% | ~45ms |
| Task 3: Inline hints | 3-5% | ~43ms |
| Task 4: Zero-alloc UUID | 5-10% (UUID-heavy) | ~40ms |
| Task 5: Zero-alloc timestamp | 10-15% (timestamp-heavy) | ~35ms |
| Task 6: Rayon threshold | Variable | ~33ms |
| Task 7: Complex types lazy (backend) | 5-10% | ~30ms |
| Task 8: Skip UTF-8 validation | 5-8% | ~28ms |
| Task 9: Frontend lazy decode | N/A (enables Task 7) | ~28ms |

**Final target: ~28-30ms encoding time for 12k rows**

---

## Rayon Parallelism Decision

Based on expert review:

> "While we can add Rayon, I would strongly advise against it for this specific serialization bottleneck... The overhead of allocating multiple buffers and joining them often outweighs the speedup for 'simple' data like database rows."

**Decision:** Keep existing rayon for large batches (>1024 rows), but focus optimization efforts on zero-copy patterns instead of more parallelism.

---

## Future Considerations (Out of Scope)

1. **Columnar encoding**: Send data column-by-column instead of row-by-row (20-30% improvement, requires frontend changes)
2. **Binary transfer for UUID/timestamps**: Send raw bytes, decode on frontend (30-40% payload reduction)
3. **SharedArrayBuffer**: Direct memory sharing between Rust and JS (complex, security restrictions)

