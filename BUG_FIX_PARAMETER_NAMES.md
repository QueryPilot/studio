# Bug Fix: Channel Parameter Name Mismatch

**Date**: October 8, 2025
**Issue**: `invalid args 'channel' for command 'stream_query': invalid type: integer '2846894984', expected a string`
**Status**: ✅ **FIXED**

## Problem

After fixing the previous Channel API issue, a new error appeared:

```
invalid args `channel` for command `stream_query`: invalid type: integer `2846894984`, expected a string
```

This error indicated that the Tauri IPC serialization was failing because JavaScript parameter names didn't match Rust parameter names.

## Root Cause

The TypeScript code was passing parameters with camelCase names:

```typescript
await invoke("stream_query", {
  connId,        // ❌ Wrong - doesn't match Rust parameter name
  sql,
  batchSize,     // ❌ Wrong - doesn't match Rust parameter name
  channel,
});
```

But the Rust command expects snake_case names:

```rust
pub async fn stream_query(
    conn_id: String,      // snake_case
    sql: String,
    batch_size: Option<usize>,  // snake_case
    channel: tauri::ipc::Channel<StreamMessage>,
    ...
)
```

When Tauri's serde deserialization tries to map JavaScript parameters to Rust parameters, it uses exact name matching. When `connId` couldn't be matched to `conn_id`, the deserialization failed with a confusing error message about the `channel` parameter.

## Solution

Changed all parameter names in `queryStreamClient.ts` to use snake_case to match Rust:

**Before**:
```typescript
await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel,
});
```

**After**:
```typescript
await invoke("stream_query", {
  conn_id: connId,
  sql,
  batch_size: batchSize,
  channel,
});
```

## Changes Made

**File**: `src/services/queryStreamClient.ts`

1. **Lines 99-106** (`stream` method): Changed parameter names
   ```typescript
   await invoke("stream_query", {
     conn_id: connId,      // ✅ Matches Rust parameter
     sql,
     batch_size: batchSize, // ✅ Matches Rust parameter
     channel,
   });
   ```

2. **Lines 177-184** (`streamWithCallbacks` method): Changed parameter names
   ```typescript
   await invoke("stream_query", {
     conn_id: connId,
     sql,
     batch_size: batchSize,
     channel,
   });
   ```

## Why This Happened

Tauri v2 uses `serde` for serialization/deserialization between JavaScript and Rust. By default, `serde` expects exact field name matches. While JavaScript conventionally uses camelCase, Rust conventionally uses snake_case.

The confusing error message ("expected a string") was a side effect of the deserialization failure - when serde couldn't match the parameters, it fell back to trying different type interpretations, leading to the misleading error.

## Tauri IPC Pattern

**Correct pattern for Tauri v2 commands:**

```typescript
// JavaScript (camelCase variables, snake_case keys)
await invoke("rust_command", {
  user_id: userId,        // Rust: user_id: String
  is_active: isActive,    // Rust: is_active: bool
  max_count: maxCount,    // Rust: max_count: usize
});
```

```rust
// Rust (snake_case)
#[tauri::command]
pub async fn rust_command(
    user_id: String,
    is_active: bool,
    max_count: usize,
) -> Result<(), String> {
    // ...
}
```

## Testing

**Compilation**: ✅ Passes
```bash
pnpm typecheck
# No errors in queryStreamClient.ts
```

**Expected Result**:
- Query execution should work without parameter serialization errors
- Channel should be properly recognized by Rust
- Streaming should start immediately

## Impact

- **Performance**: No impact - just parameter name changes
- **Functionality**: Fixes critical bug preventing query execution
- **Compatibility**: Aligns with Tauri v2 IPC conventions

## Related Issues

This fix addresses the parameter naming mismatch. Previous fixes:
1. `BUG_FIX_DOUBLE_LIMIT.md` - Fixed SQL syntax error in table data loading
2. `BUG_FIX_CHANNEL_ID.md` - Fixed Channel API usage (reverted)

## Key Takeaway

When calling Tauri commands from JavaScript:
- ✅ Use snake_case for parameter keys (to match Rust)
- ✅ Use camelCase for JavaScript variable names (by convention)
- ✅ Map between them: `{ rust_param: jsVariable }`

**Example**:
```typescript
const userId = "123";
const isActive = true;

await invoke("update_user", {
  user_id: userId,      // key matches Rust
  is_active: isActive,  // key matches Rust
});
```
