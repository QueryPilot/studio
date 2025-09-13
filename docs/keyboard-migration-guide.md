# Keyboard Shortcut System Migration Guide

## Quick Start

The new keyboard shortcut system is now available! It provides better DX, context awareness, and customization.

### Step 1: App Setup (Already Done ✅)

The `KeyboardProvider` has been added to `App.tsx`:

```tsx
import { KeyboardProvider } from "./services/keyboard";

function App() {
  return (
    <KeyboardProvider>
      {/* your app */}
    </KeyboardProvider>
  );
}
```

### Step 2: Migrate a Component

Here's how to migrate from the old pattern to the new system:

## Migration Example: QueryPanel

### Before (Old Pattern)
```tsx
// ❌ Old way - manual event listeners
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isExecuting && query.trim()) {
        void handleExecute();
      }
    }
    // Alt+F for beautify
    else if (e.altKey && e.key === "f") {
      e.preventDefault();
      if (query.trim()) {
        handleBeautify();
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}, [query, isExecuting, handleExecute, handleBeautify]);
```

### After (New Pattern)
```tsx
// ✅ New way - simple hooks
import { useShortcut, KeyboardScope } from "@/services/keyboard";

// Register shortcuts
useShortcut('cmd+enter', handleExecute, {
  when: 'queryEditor.focus && !isExecuting && query',
  preventDefault: true
});

useShortcut('alt+f', handleBeautify, {
  when: 'queryEditor.focus && query',
  preventDefault: true
});

// Wrap component to set context
return (
  <KeyboardScope context="queryEditor">
    {/* your component */}
  </KeyboardScope>
);
```

## Common Migration Patterns

### 1. Simple Shortcut
```tsx
// Before
useEffect(() => {
  const handler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);

// After
useShortcut('escape', closeModal);
```

### 2. Platform-Specific Shortcut
```tsx
// Before
const isMac = navigator.userAgent.includes('Mac');
const modKey = isMac ? e.metaKey : e.ctrlKey;
if (modKey && e.key === 's') {
  save();
}

// After
useShortcut('cmd+s', save); // Automatically handles Cmd/Ctrl
```

### 3. Contextual Shortcut
```tsx
// Before
if (activePanel === 'editor' && e.key === 'Enter') {
  execute();
}

// After
useShortcut('enter', execute, {
  when: 'editorFocus'
});
```

### 4. Adding Keybinding Hints
```tsx
import { useKeybindingHint } from "@/services/keyboard";

const saveHint = useKeybindingHint('file.save');

<Button title={`Save ${saveHint ? `(${saveHint})` : ''}`}>
  Save
</Button>
```

## Available Contexts

The following contexts are available for the `when` clause:

- `queryEditor` - SQL query editor
- `tableView` - Data grid/table view
- `schemaView` - Database schema tree
- `resultView` - Query results
- `workbench` - Panel management
- `global` - Always active

## Context Variables

Use these in `when` clauses:

```tsx
// Focus states
'queryEditorFocus'    // Query editor has focus
'tableViewFocus'       // Table view has focus
'schemaViewFocus'      // Schema view has focus

// Editor states
'hasSelection'         // Text is selected
'isDirty'             // Has unsaved changes
'isEditing'           // Currently editing

// Query states
'isExecuting'         // Query is running
'hasResults'          // Results are available
'query'               // Query is not empty

// UI states
'leftSidebarVisible'  // Left sidebar is open
'rightSidebarVisible' // Right sidebar is open
'dialogOpen'          // A dialog is open
```

## Complex Conditions

Combine conditions with boolean operators:

```tsx
useShortcut('cmd+enter', execute, {
  when: 'queryEditorFocus && !isExecuting && query'
});

useShortcut('cmd+s', save, {
  when: 'editorFocus && isDirty && !dialogOpen'
});
```

## Migration Checklist

For each component:

- [ ] Remove `window.addEventListener('keydown', ...)`
- [ ] Remove `window.removeEventListener('keydown', ...)`
- [ ] Import keyboard hooks: `import { useShortcut } from '@/services/keyboard'`
- [ ] Replace event handlers with `useShortcut` calls
- [ ] Add `KeyboardScope` wrapper if needed
- [ ] Add keybinding hints to buttons/tooltips
- [ ] Test shortcuts work correctly
- [ ] Check for conflicts with other shortcuts

## Components to Migrate

### Priority 1 (Core Functionality)
- [x] QueryPanel - Example created in `QueryPanelWithShortcuts.tsx`
- [ ] WorkbenchLayout - Panel splitting shortcuts
- [ ] TableDataGrid - Cell editing shortcuts

### Priority 2 (Enhanced UX)
- [ ] DatabaseSidebar - Navigation shortcuts
- [ ] SavedQueries - Save/load shortcuts
- [ ] QueryHistory - History navigation

### Priority 3 (Nice to Have)
- [ ] AISidebar - AI command shortcuts
- [ ] ResultViewer - Export shortcuts
- [ ] Schema panels - Refresh shortcuts

## Testing

After migration, test these scenarios:

1. **Basic Execution**: Cmd/Ctrl+Enter executes query
2. **Context Awareness**: Shortcuts only work in correct panel
3. **No Conflicts**: Multiple panels don't interfere
4. **Platform Support**: Works on Mac/Windows/Linux
5. **Input Fields**: Shortcuts don't fire when typing
6. **Tooltips**: Keybinding hints appear correctly

## Troubleshooting

### Shortcut Not Working
- Check the `when` condition is correct
- Verify context is set with `KeyboardScope`
- Look for conflicts with `manager.findConflicts()`

### Wrong Context
- Ensure `KeyboardScope` wraps the component
- Check focus management in parent components
- Verify store integration is working

### Memory Leaks
- Hooks automatically clean up - no manual cleanup needed
- Don't store command references outside components

## Benefits of Migration

1. **Better DX**: One-line shortcut registration
2. **Type Safety**: Full TypeScript support
3. **No Memory Leaks**: Automatic cleanup
4. **Context Aware**: Shortcuts only fire when appropriate
5. **Customizable**: Users can override shortcuts
6. **Discoverable**: Command palette shows all shortcuts
7. **Testable**: Easy to unit test shortcuts

## Next Steps

1. Start with `QueryPanel` using the example
2. Migrate high-traffic components first
3. Add keybinding hints to all buttons
4. Document component-specific shortcuts
5. Consider adding command palette UI