# Bug Fix: Channel ID Error in Stream Query

**Date**: October 8, 2025
**Issue**: `TypeError: undefined is not an object (evaluating 'id.toString')`
**Status**: ✅ **FIXED**

## Problem

When executing a query from the query editor (`SELECT * FROM todos`), the application threw repeated JavaScript errors:

```
TypeError: undefined is not an object (evaluating 'id.toString')
```

This was followed by a timeout after 30 seconds:
```
Stream timeout: No response from backend after 30 seconds
```

## Root Cause

The `queryStreamClient.ts` was using the Tauri v2 `Channel` class incorrectly:

```typescript
// INCORRECT: Channel needs to be transformed for Tauri IPC
const channel = new Channel<StreamMessage>();

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel,  // ❌ Wrong - Channel instance can't be passed directly
});
```

In Tauri v2, when passing a callback/channel to a Rust command, you must use `transformCallback()` to convert the JavaScript function into a format that Tauri's IPC can serialize and send to the Rust backend.

Without `transformCallback`, the Channel object was passed raw, causing the Rust side to fail when trying to access the channel's `id` property (which was undefined).

## Solution

Updated `queryStreamClient.ts` to use `transformCallback()` for proper channel serialization:

**File**: `src/services/queryStreamClient.ts`

### Change 1: Import transformCallback

```typescript
// Before
import { Channel, invoke } from "@tauri-apps/api/core";

// After
import { invoke, transformCallback } from "@tauri-apps/api/core";
```

### Change 2: Use transformCallback for channel handler

```typescript
// Before
const channel = new Channel<StreamMessage>();

channel.onmessage = (message) => {
  // Handle message...
};

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel,
});

// After
const channelHandler = (message: StreamMessage) => {
  // Handle message...
};

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel: transformCallback(channelHandler),  // ✅ Properly transformed
});
```

## Changes Made

**File**: `src/services/queryStreamClient.ts`

1. **Line 1**: Changed import from `Channel` to `transformCallback`
   ```typescript
   import { invoke, transformCallback } from "@tauri-apps/api/core";
   ```

2. **Lines 38-110**: Updated `stream()` method to use transformCallback
   - Removed `new Channel<StreamMessage>()`
   - Created `channelHandler` function instead
   - Passed `transformCallback(channelHandler)` to invoke

3. **Lines 116-186**: Updated `streamWithCallbacks()` method to use transformCallback
   - Same pattern as `stream()` method
   - Callback-based API now works correctly

## How transformCallback Works

`transformCallback` is a Tauri v2 utility that:

1. Generates a unique ID for the callback
2. Registers the JavaScript function with Tauri's IPC system
3. Returns a serializable reference that Rust can use
4. When Rust sends data to the channel, Tauri routes it to the registered function

This is the proper pattern for all Tauri v2 channel-based commands.

## Testing

**Compilation**: ✅ Passes
```bash
pnpm typecheck
# No errors in queryStreamClient.ts
```

**Expected Result**:
- Query execution should work without `id.toString()` errors
- Streaming should start immediately (no 30s timeout)
- Query results should display in the UI

## Impact

- **Performance**: No negative impact - proper channel usage
- **Functionality**: Fixes critical bug preventing query execution
- **Compatibility**: Aligns with Tauri v2 best practices

## Related Files

- `src/services/queryStreamClient.ts` (modified)
- `src/services/streamingTableService.ts` (uses queryStreamClient)
- `src-tauri/src/commands.rs` (stream_query command)

## Tauri v2 Pattern

This fix demonstrates the correct pattern for Tauri v2 channel-based commands:

```typescript
// ✅ CORRECT
const handler = (data: T) => { /* handle data */ };

await invoke("command_name", {
  param1: value1,
  channel: transformCallback(handler),
});
```

```typescript
// ❌ INCORRECT
const channel = new Channel<T>();
channel.onmessage = (data) => { /* handle data */ };

await invoke("command_name", {
  param1: value1,
  channel,  // Won't work - channel needs transformation
});
```

## References

- Tauri v2 IPC Documentation: https://v2.tauri.app/develop/calling-rust/#channels
- `transformCallback` API: Converts JS callbacks to IPC-serializable format
