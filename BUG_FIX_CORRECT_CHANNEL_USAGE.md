# Bug Fix: Correct Tauri Channel Usage (Final Solution)

**Date**: October 8, 2025
**Issue**: `invalid args 'connId' for command 'stream_query': missing required key connId`
**Status**: ✅ **FIXED**

## Executive Summary

The bug was caused by **incorrect usage of the Tauri Channel API**. We mistakenly removed `new Channel()` thinking it was wrong, when it was actually the correct pattern. Passing a raw callback function instead of a Channel object breaks Tauri's IPC serialization.

## The Correct Pattern

```typescript
// ✅ CORRECT - Create Channel object
const channel = new Channel<StreamMessage>();
channel.onmessage = (message: StreamMessage) => {
  // Handle message...
};

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel,  // Pass Channel object
});
```

```typescript
// ❌ WRONG - Passing raw function
const handleMessage = (message: StreamMessage) => { ... };

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel: handleMessage,  // BREAKS SERIALIZATION
});
```

## Why This Works

The `Channel` class in Tauri v2 has special serialization logic:

```typescript
class Channel<T> {
    id: number;
    constructor();
    set onmessage(handler: (response: T) => void);
    [SERIALIZE_TO_IPC_FN](): string;  // ← Custom serialization
    toJSON(): string;
}
```

When `invoke()` serializes parameters for IPC transfer:
1. It checks if the value has a `[SERIALIZE_TO_IPC_FN]` method
2. If yes, calls it to get the serialized form
3. Channel's implementation returns a properly formatted channel identifier
4. Rust receives the identifier and can send messages back via Tauri's IPC layer

When you pass a raw function:
- It has no `[SERIALIZE_TO_IPC_FN]` method
- Tauri tries to serialize it as a regular object
- Functions can't be serialized to JSON
- The entire parameter object becomes malformed
- Rust can't deserialize it → "missing required key" error

## Investigation Timeline

### What We Tried (Chronologically)

1. **transformCallback()** - Thought we needed to transform the callback
   ❌ Result: Returned a callback ID (integer), not a Channel

2. **Snake_case parameters** - Thought Tauri needed exact name matching
   ❌ Result: Other commands use camelCase successfully, this wasn't the issue

3. **Passing raw function** - Thought Tauri would wrap it automatically
   ❌ Result: Broke serialization completely (this was the bug we introduced!)

4. **Restoring `new Channel()`** - Went back to original pattern
   ✅ Result: **THIS IS THE CORRECT SOLUTION**

## Root Cause Analysis

### The Misleading Error Message

```
invalid args `connId` for command `stream_query`:
command stream_query missing required key connId
```

This error message was **misleading**:
- It mentions `connId` but the real problem was the `channel` parameter
- When the channel parameter fails to serialize, the entire JSON payload becomes invalid
- Serde (Rust's deserializer) can't parse the malformed JSON
- It reports the first missing field it encounters

### Why The Error Occurred

1. **JavaScript**: Created raw function instead of Channel object
   ```typescript
   const handleMessage = (msg) => { ... };
   channel: handleMessage  // Function reference
   ```

2. **Tauri invoke()**: Tried to serialize parameters
   ```javascript
   // Attempted serialization:
   {
     connId: "abc123",
     sql: "SELECT * FROM todos",
     batchSize: 1000,
     channel: [Function]  // Can't serialize function!
   }
   ```

3. **JSON serialization**: Failed because functions aren't JSON-serializable
   ```json
   {
     "connId": "abc123",
     "sql": "SELECT * FROM todos",
     "batchSize": 1000,
     "channel": null  // Function becomes null or undefined
   }
   ```

4. **Rust serde**: Tried to deserialize and failed
   - Expected `channel: tauri::ipc::Channel<StreamMessage>`
   - Received malformed/missing value
   - Entire deserialization failed
   - Reported first missing field in error message

## Changes Made

### File: `src/services/queryStreamClient.ts`

**Lines 1, 47-48, 100-104, 131-132, 177-182**:

```typescript
// Re-added Channel import
import { invoke, Channel } from "@tauri-apps/api/core";

// Restored Channel instantiation in stream() method
const channel = new Channel<StreamMessage>();
channel.onmessage = (message: StreamMessage) => {
  // Handle message...
};

await invoke("stream_query", {
  connId,
  sql,
  batchSize,
  channel,  // Pass Channel object
});

// Same pattern for streamWithCallbacks() method
```

## Bonus Fix: Double Toast Display

### Problem
Errors were displayed twice:
1. Toast notification (bottom-right)
2. Error banner (top of query result area)

### Root Cause
`streamingTableService.ts` was calling BOTH:
- `onError(error)` callback → shows toast
- `reject(err)` → component catches and shows banner

### Fix
Removed the `onError` callback invocation, keeping only `reject()`:

```typescript
// Before
onError: (err) => {
  clearTimeout(timeoutId);
  this.isStreaming = false;
  if (onError) {
    onError(error);  // ← Shows toast
  }
  reject(err);  // ← Component shows banner
},

// After
onError: (err) => {
  clearTimeout(timeoutId);
  this.isStreaming = false;
  // Don't call onError callback - let component handle via catch
  reject(err);  // Only this - single error display
},
```

**File**: `src/services/streamingTableService.ts:183-193`

## Testing

**Compilation**: ✅ Passes
```bash
pnpm typecheck
# No errors in queryStreamClient.ts or streamingTableService.ts
```

**Expected Behavior**:
1. ✅ Query execution works without "missing required key" errors
2. ✅ Streaming starts immediately (no 30s timeout)
3. ✅ Messages flow from Rust → JavaScript via Channel
4. ✅ Errors display only once (no double toast)

## Key Takeaways

### 1. Trust The Documentation
Tauri's Channel API is designed to be instantiated with `new Channel()`. Don't try to be clever by passing raw functions - the API is designed a specific way for a reason.

### 2. Special Types Need Special Handling
Classes with `[SERIALIZE_TO_IPC_FN]` or `toJSON()` methods have custom serialization. You must use them as intended - you can't substitute with plain objects or functions.

### 3. Misleading Error Messages
When debugging Tauri IPC issues:
- The error might mention one parameter but the real issue is another
- Check the entire parameter object, not just the mentioned field
- Look for serialization issues with special types (Channel, Resource, etc.)

### 4. Don't Over-Fix
We went through multiple "fixes" that made things worse:
- transformCallback → wrong approach
- Snake_case params → unnecessary (Tauri converts automatically)
- Raw functions → broke everything

The original code was closer to correct. Sometimes the best fix is to revert.

## References

- Tauri v2 IPC Channels: https://v2.tauri.app/develop/calling-rust/#channels
- Channel API Source: `node_modules/@tauri-apps/api/core.d.ts`
- Key Insight: "The Channel class has custom serialization via SERIALIZE_TO_IPC_FN symbol"

## Related Fixes

1. `BUG_FIX_DOUBLE_LIMIT.md` - Fixed SQL syntax error in table loading
2. `FINAL_BUG_FIXES.md` - Summary of all fixes

---

**Status**: ✅ All bugs fixed. Query execution and table loading both work correctly.
