# Dual Channel IPC Implementation

## Overview

Implemented **dual-channel streaming** to eliminate Tauri's JSON serialization overhead for query result data while maintaining structured metadata communication.

## Architecture

### Backend (Rust)

```rust
#[tauri::command]
pub async fn stream_query(
    metadata_channel: tauri::ipc::Channel<StreamMessage>,  // JSON metadata
    data_channel: tauri::ipc::Channel<tauri::ipc::Response>, // Raw binary
    // ...
)
```

**Two separate channels:**

1. **Metadata Channel** (`StreamMessage` enum):

   - `Started` - column metadata
   - `Success` - execution stats (time, rows, performance breakdown)
   - `Error` - error messages
   - `LimitApplied` - query modification info

2. **Data Channel** (`Response` type):
   - Raw MessagePack bytes (`Vec<u8>`)
   - **ZERO Tauri serialization** - sent as-is
   - Frontend receives as `ArrayBuffer`

### Frontend (TypeScript)

```typescript
// Data channel: raw ArrayBuffer → MessagePack decode
const dataChannel = createIpcChannel<ArrayBuffer>((buffer) => {
  const bytes = new Uint8Array(buffer);
  const parsedRows = decode(bytes) as CellValue[][];
  // Process batch...
});

// Metadata channel: structured JSON messages
const metadataChannel = createIpcChannel<StreamMessage>((message) => {
  switch (message.type) {
    case "started": /* ... */
    case "success": /* ... */
    case "error": /* ... */
  }
});

// Invoke with BOTH channels
invoke("stream_query", {
  connId,
  sql,
  batchSize,
  userLimitPreference,
  metadataChannel,
  dataChannel,
});
```

## Key Benefits

### 1. Eliminated Double Serialization

**Before (serde_bytes attempt):**

```
MessagePack → Vec<u8> → Tauri JSON serializes Vec<u8> → Base64 → Frontend
```

**After (Response):**

```
MessagePack → Vec<u8> → Tauri IPC (NO serialization) → ArrayBuffer → Frontend
```

### 2. Clean Separation of Concerns

- **Metadata** (columns, stats, errors): Benefits from JSON type safety
- **Data** (row batches): Benefits from raw binary transfer

### 3. Expected Performance Impact

- **IPC Send Time**: Should drop from ~53% to <10% of total time
- **Conversion Time**: Only MessagePack serialization (no base64, no JSON overhead)
- **Total Overhead**: Projected 70-80% reduction in IPC overhead

## Implementation Details

### Rust Changes

- `src-tauri/src/commands.rs`:

  - `stream_query` now accepts **two channels**: `metadata_channel` and `data_channel`
  - `execute_single_fetch_stream` uses `data_channel.send(Response::new(rows_msgpack))`
  - All metadata sent through `metadata_channel.send(StreamMessage::*)`
  - Batch data never touches the metadata channel

- `src-tauri/src/types.rs`:
  - **Removed `StreamMessage::Batch` variant** entirely
  - Only metadata messages remain: `Started`, `Success`, `Error`, `LimitApplied`, `Interrupted`
- `src-tauri/Cargo.toml`:
  - **Removed `serde_bytes`** dependency (no longer needed)
  - Kept `rmp-serde` for MessagePack encoding

### Frontend Changes

- `src/services/backend.ts`:

  - **Removed `batch` variant** from `StreamMessage` type
  - Added comment explaining dual-channel architecture

- `src/services/queryStreamClient.ts`:
  - **Two separate `createIpcChannel` calls**:
    - `dataChannel: Channel<ArrayBuffer>` - receives raw binary
    - `metadataChannel: Channel<StreamMessage>` - receives JSON
  - Data channel handles MessagePack decoding directly from ArrayBuffer
  - No more `rows_msgpack` field in metadata messages

### Dependencies

- `rmp-serde` (1.3): MessagePack serialization
- **Removed**: `serde_bytes` (Response bypasses serde entirely for data)

## Testing

To verify the performance improvement:

1. Run a query with 10K+ rows
2. Check logs for breakdown:
   ```
   ⏱ Performance breakdown:
     │  Network/DB: Xms (Y%)
     │  Conversion: Xms (Y%)
     │  IPC Send: Xms (Y%) ← Should be <10% now
   ```
3. Compare with previous "IPC Send: 53%" baseline

## References

- Tauri Docs: https://v2.tauri.app/develop/calling-rust/#returning-array-buffers
- Tauri IPC Response: Designed for raw binary transfer
- MessagePack: Efficient binary serialization format
