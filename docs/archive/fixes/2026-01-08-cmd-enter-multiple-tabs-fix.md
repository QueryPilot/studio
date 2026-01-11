# Fix: Cmd+Enter Triggering Multiple Tabs

## Problem
When multiple query editor tabs are open, pressing `Cmd+Enter` would trigger query execution in multiple tabs instead of just the currently focused tab.

## Root Cause
The issue was caused by the **event bus broadcast pattern**:

1. **Global Keybinding**: `Cmd+Enter` triggers the global command `editor.action.executeQuery` (defined in `defaultCommands.ts`)
2. **Event Bus Broadcast**: This command emits `query-editor:execute` event to ALL listeners
3. **All Editors Listen**: Every `SqlEditor` component subscribes to this event (line 467 in SqlEditor.tsx)
4. **No Focus Check**: The event handlers didn't check if the editor had focus, so ALL editors would execute their queries

The flow was:
```
Cmd+Enter → editor.action.executeQuery → eventBus.emit("query-editor:execute") → ALL SqlEditors execute
```

## Solution
Added a **focus check** in the `SqlEditor` event handler to ensure only the focused editor executes.

### Changes Made

**File: `src/components/CodeEditor/SqlEditor.tsx`**

Added a focus check in the event bus handler to ensure only the focused editor executes:

```typescript
// Handle external execute events (e.g. from Command Palette)
useEffect(() => {
  const handleExecute = () => {
    if (!viewRef.current || !onExecuteRef.current) return;
    const view = viewRef.current;

    // CRITICAL: Only execute if THIS editor has focus
    // This prevents the event bus from triggering all editors when Cmd+Enter is pressed
    if (!view.hasFocus) {
      return;
    }

    // ... rest of execution logic
  };

  eventBus.on("query-editor:execute", handleExecute);
  eventBus.on("query-editor:execute-background", handleExecute);
  return () => {
    eventBus.off("query-editor:execute", handleExecute);
    eventBus.off("query-editor:execute-background", handleExecute);
  };
}, [executeQuery]);
```

## How It Works Now

When `Cmd+Enter` is pressed:

1. **Global keybinding** triggers `editor.action.executeQuery` command
2. **Command handler** emits `query-editor:execute` event to the event bus
3. **All SqlEditors** receive the event
4. **Focus check** ensures only the editor with `view.hasFocus === true` executes

Additionally, each `SqlEditor` still has its own **local CodeMirror keymap** that handles `Mod-Enter` with `Prec.highest()` priority. This provides a fallback and ensures the editor works even if the global command system fails.

The two execution paths are:
- **Local Keymap**: `Cmd+Enter` → CodeMirror keymap → execute (scoped to that editor)
- **Global Command**: `Cmd+Enter` → command → event bus → ALL editors check focus → only focused one executes

## Testing
1. Open multiple query tabs
2. Type different queries in each tab
3. Focus on Tab 1 and press `Cmd+Enter` → Only Tab 1 executes
4. Focus on Tab 2 and press `Cmd+Enter` → Only Tab 2 executes

## Future Considerations
If we need to support executing queries from the Command Palette (which operates globally), we should:
- Create an editor registry to track focused editor instances
- Dispatch events that only the focused editor listens to
- Or use a different command ID per editor instance (e.g., `editor.action.executeQuery.${editorId}`)
