# Keyboard Shortcut System Specification

## Overview
A comprehensive, VSCode-like keyboard shortcut system for DevDB Studio that provides global keyboard management, context-aware shortcuts, and full customization capabilities.

## Current State Analysis

### Existing Implementations Found
1. **QueryPanel** - 3 shortcuts using window.addEventListener
   - `Cmd/Ctrl+Enter`: Execute query
   - `Alt+F`: Beautify SQL
   - `Alt+H`: Toggle history

2. **WorkbenchLayout** - 10+ shortcuts with direct event handling
   - `Cmd+\`: Split panel right
   - `Cmd+Shift+\`: Split panel down
   - `Cmd+Alt+Arrow`: Split in direction
   - `Cmd+Z/Y`: Undo/Redo
   - `Cmd+Arrow`: Focus navigation

3. **TableView/DataGrid** - Built-in Glide Data Grid shortcuts
   - `Enter/F2`: Edit cell
   - `Escape`: Cancel edit
   - `Tab/Shift+Tab`: Navigate cells
   - `Arrow Keys`: Move between cells
   - `Cmd/Ctrl+C`: Copy cell (context menu)
   - `Cmd/Ctrl+F`: Search in table

4. **Input Components** - Various Enter key handlers in SavedQueries, QueryHistory, AISidebar

### Critical Issues
- **No Central Management**: Each component manages its own shortcuts
- **Context Blindness**: Shortcuts fire even when panel not focused
- **Memory Leak Risk**: Manual cleanup required, often forgotten
- **No Discovery**: Users can't see available shortcuts
- **Platform Duplication**: Each component detects OS separately
- **Conflict Prone**: No way to prevent overlapping shortcuts

### DX Pain Points
- Developers must remember cleanup patterns
- No TypeScript autocomplete for shortcuts
- No standard pattern to follow
- Can't test shortcuts easily
- Hard to document shortcuts

## DX-First Design Principles

### 1. Zero-Config Smart Defaults
```typescript
// BEFORE: Manual everything
useEffect(() => {
  const handler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [executeQuery]);

// AFTER: One line, everything handled
useShortcut('cmd+enter', executeQuery);
```

### 2. Progressive Complexity
```typescript
// Simple: Just works
useShortcut('cmd+s', save);

// Advanced: When needed
useShortcut('cmd+s', save, {
  when: 'editorFocus && isDirty',
  preventDefault: true,
  description: 'Save current file'
});
```

### 3. Type-Safe with IntelliSense
```typescript
// Full autocomplete for command IDs, contexts, and keybindings
useCommand({
  id: 'query.execute',  // Autocomplete from registry
  handler: executeQuery,
  shortcut: 'cmd+enter',  // Validated at compile time
  when: 'queryEditor.focus'  // Context autocomplete
});
```

### 4. Automatic Context Cascading
```typescript
// Parent defines context
<QueryPanel context="queryEditor">
  <Editor />  // Inherits queryEditor context
  <Results /> // Also inherits context
</QueryPanel>

// Child components automatically scoped
function Editor() {
  // Only fires when queryEditor is focused
  useShortcut('cmd+enter', execute);
}
```

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────┐
│                 KeyboardProvider                     │
│  (React Context wrapping entire application)         │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                              │
┌───────▼────────┐           ┌────────▼────────┐
│ KeyboardManager│           │  CommandRegistry │
│   (Singleton)  │◄──────────┤   (Commands)     │
└───────┬────────┘           └─────────────────┘
        │
┌───────▼────────────────────────────────────┐
│            Context System                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │Evaluator │  │  Store   │  │Variables │ │
│  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────┘
```

### File Structure

```
src/services/keyboard/
├── KeyboardManager.ts       # Main singleton manager
├── CommandRegistry.ts       # Command registration & execution
├── KeyNormalizer.ts         # Platform key abstraction
├── ContextEvaluator.ts      # When clause evaluation
├── types.ts                 # TypeScript interfaces
└── defaults/
    ├── keybindings.json     # Default keybindings
    └── commands.ts          # Built-in commands

src/hooks/
├── useCommand.ts            # Register & execute commands
├── useShortcut.ts           # Component-level shortcuts
└── useKeybindingHint.ts     # Tooltip integration

src/stores/
└── keyboardStore.ts         # Zustand store for context

src/components/
└── KeyboardProvider.tsx     # React context provider
```

## Type Definitions

### Core Interfaces

```typescript
interface Command {
  id: string;                           // Unique identifier (e.g., "editor.execute")
  title: string;                        // Display name
  category?: CommandCategory;           // Grouping for command palette
  handler: CommandHandler;              // Execution function
  when?: string;                        // Context expression
  keybinding?: Keybinding;              // Default shortcut
  icon?: string;                        // Optional icon
}

interface Keybinding {
  key: string;                          // Key combination (e.g., "cmd+k")
  when?: string;                        // Context override
  priority?: number;                    // Conflict resolution (higher wins)
  args?: any;                           // Optional arguments
}

interface KeyboardContext {
  activeView: ViewType;                 // Current focused view
  focusedElement: string;               // DOM element identifier
  hasSelection: boolean;                // Text/item selection state
  isEditing: boolean;                   // Input/editor focus
  platform: Platform;                   // OS detection
  modifierKeys: ModifierState;          // Current modifier key state
  [key: string]: any;                   // Extensible context
}

type ViewType = 'editor' | 'results' | 'schema' | 'terminal' | 'dialog';
type Platform = 'mac' | 'windows' | 'linux';
type CommandCategory = 'file' | 'edit' | 'view' | 'database' | 'navigation' | 'help';
type CommandHandler = (args?: any) => void | Promise<void>;

interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}
```

## Implementation Blueprint

### Quick Start for Developers

```typescript
// 1. Wrap your app (once)
<KeyboardProvider>
  <App />
</KeyboardProvider>

// 2. Use shortcuts in any component
function MyComponent() {
  // Simple shortcut
  useShortcut('cmd+s', handleSave);

  // With context
  useShortcut('cmd+enter', handleExecute, {
    when: 'editorFocus && !isExecuting'
  });

  // Register command
  useCommand({
    id: 'my.command',
    title: 'My Command',
    handler: doSomething,
    shortcut: 'cmd+k'
  });
}

// 3. That's it! Everything else is handled
```

## Implementation Details

### 1. KeyboardManager (Singleton)

```typescript
class KeyboardManager {
  private static instance: KeyboardManager;
  private registry: CommandRegistry;
  private normalizer: KeyNormalizer;
  private contextEvaluator: ContextEvaluator;
  private activeBindings: Map<string, Command[]>;

  // Global event listener
  initialize(): void;

  // Command management
  registerCommand(command: Command): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: any): Promise<void>;

  // Keybinding management
  setKeybinding(commandId: string, keybinding: Keybinding): void;
  removeKeybinding(commandId: string): void;
  getKeybinding(commandId: string): Keybinding | undefined;

  // Context management
  updateContext(partial: Partial<KeyboardContext>): void;
  evaluateWhen(expression: string): boolean;

  // Conflict detection
  findConflicts(keybinding: Keybinding): Command[];
  resolveConflict(commands: Command[]): Command;
}
```

### 2. Key Normalization

```typescript
class KeyNormalizer {
  // Convert platform-specific keys to normalized format
  normalize(event: KeyboardEvent): string;

  // Parse string representation to components
  parse(keyString: string): ParsedKey;

  // Platform abstraction
  toPlatform(normalized: string, platform: Platform): string;

  // Validation
  isValid(keyString: string): boolean;
}

interface ParsedKey {
  key: string;
  modifiers: ModifierState;
  sequence?: string[];  // For chord sequences
}
```

### 3. Context Evaluation

```typescript
class ContextEvaluator {
  // Evaluate "when" clause expressions
  evaluate(expression: string, context: KeyboardContext): boolean;

  // Parse expression to AST
  parse(expression: string): Expression;

  // Supported operators
  // && (AND), || (OR), ! (NOT), == (EQUALS), != (NOT_EQUALS)
  // Examples:
  // "editorFocus && !inputFocus"
  // "platform == 'mac' && hasSelection"
  // "activeView == 'editor' || activeView == 'terminal'"
}
```

### 4. React Integration

```typescript
// Provider component
function KeyboardProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    KeyboardManager.getInstance().initialize();
  }, []);

  return (
    <KeyboardContext.Provider value={manager}>
      {children}
    </KeyboardContext.Provider>
  );
}

// Command registration hook
function useCommand(command: Command): {
  execute: (args?: any) => Promise<void>;
  isEnabled: boolean;
  keybinding?: string;
} {
  useEffect(() => {
    manager.registerCommand(command);
    return () => manager.unregisterCommand(command.id);
  }, [command]);

  return {
    execute: (args) => manager.executeCommand(command.id, args),
    isEnabled: manager.evaluateWhen(command.when),
    keybinding: manager.getKeybinding(command.id)?.key
  };
}

// Local shortcut hook
function useShortcut(
  key: string,
  handler: () => void,
  options?: { when?: string; preventDefault?: boolean }
): void {
  useEffect(() => {
    const command: Command = {
      id: `local-${uniqueId()}`,
      title: 'Local shortcut',
      handler,
      when: options?.when,
      keybinding: { key }
    };

    manager.registerCommand(command);
    return () => manager.unregisterCommand(command.id);
  }, [key, handler, options]);
}
```

## Default Commands

### Essential Shortcuts (Priority 1)

| Command | Mac | Windows/Linux | Context |
|---------|-----|---------------|---------|
| Execute Query | `Cmd+Enter` | `Ctrl+Enter` | `editorFocus` |
| Save Query | `Cmd+S` | `Ctrl+S` | `editorFocus` |
| Command Palette | `Cmd+K` | `Ctrl+K` | - |
| Quick Table Search | `Cmd+P` | `Ctrl+P` | - |
| Toggle Comment | `Cmd+/` | `Ctrl+/` | `editorFocus` |
| Undo | `Cmd+Z` | `Ctrl+Z` | `editorFocus` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Y` | `editorFocus` |
| Autocomplete | `Tab` | `Tab` | `editorFocus && !hasAutocomplete` |
| Cancel/Close | `Escape` | `Escape` | - |

### Database Operations

| Command | Mac | Windows/Linux | Context |
|---------|-----|---------------|---------|
| Format SQL | `Shift+Alt+F` | `Shift+Alt+F` | `editorFocus` |
| Execute Current | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` | `editorFocus` |
| New Query Tab | `Cmd+T` | `Ctrl+T` | - |
| Close Tab | `Cmd+W` | `Ctrl+W` | - |
| Next Tab | `Cmd+Alt+Right` | `Ctrl+Alt+Right` | - |
| Previous Tab | `Cmd+Alt+Left` | `Ctrl+Alt+Left` | - |
| Refresh Schema | `Cmd+R` | `Ctrl+R` | `schemaView` |
| Export Results | `Cmd+E` | `Ctrl+E` | `resultsView` |

### Data Editing (Table View)

| Command | Mac | Windows/Linux | Context | Description |
|---------|-----|---------------|---------|-------------|
| Edit Cell | `Enter` / `F2` | `Enter` / `F2` | `tableView && cellSelected` | Start editing selected cell |
| Save Edit | `Cmd+S` | `Ctrl+S` | `tableView && isEditing` | Commit current edit to database |
| Cancel Edit | `Escape` | `Escape` | `tableView && isEditing` | Cancel current edit |
| Undo Edit | `Cmd+Z` | `Ctrl+Z` | `tableView && hasChanges` | Undo last cell edit |
| Redo Edit | `Cmd+Shift+Z` | `Ctrl+Y` | `tableView && hasUndo` | Redo last undone edit |
| Delete Row | `Cmd+Delete` | `Ctrl+Delete` | `tableView && rowSelected` | Delete selected row(s) |
| Insert Row | `Cmd+I` | `Ctrl+I` | `tableView` | Insert new row |
| Copy Cell | `Cmd+C` | `Ctrl+C` | `tableView && cellSelected` | Copy cell value |
| Paste Cell | `Cmd+V` | `Ctrl+V` | `tableView && cellSelected` | Paste into cell |
| Select All | `Cmd+A` | `Ctrl+A` | `tableView` | Select all rows |
| Find in Table | `Cmd+F` | `Ctrl+F` | `tableView` | Search in table data |
| Next Cell | `Tab` | `Tab` | `tableView` | Move to next cell |
| Previous Cell | `Shift+Tab` | `Shift+Tab` | `tableView` | Move to previous cell |
| Navigate | `Arrow Keys` | `Arrow Keys` | `tableView` | Move between cells |

### Navigation

| Command | Mac | Windows/Linux | Context |
|---------|-----|---------------|---------|
| Go to Line | `Ctrl+G` | `Ctrl+G` | `editorFocus` |
| Find | `Cmd+F` | `Ctrl+F` | - |
| Find & Replace | `Cmd+H` | `Ctrl+H` | `editorFocus` |
| Focus Editor | `Cmd+1` | `Ctrl+1` | - |
| Focus Results | `Cmd+2` | `Ctrl+2` | - |
| Focus Schema | `Cmd+3` | `Ctrl+3` | - |
| Toggle Sidebar | `Cmd+B` | `Ctrl+B` | - |

## Context System

### View-Specific Contexts

```typescript
type ViewContext =
  | 'queryEditor'      // SQL editor panel
  | 'tableView'        // Data grid panel
  | 'schemaView'       // Database tree panel
  | 'resultView'       // Query results panel
  | 'functionView'     // Stored procedures panel
  | 'erdView'          // ERD diagram panel
  | 'workbench'        // Panel management
  | 'sidebar.database' // Left sidebar
  | 'sidebar.ai'       // Right AI sidebar
  | 'global';          // Always active

// Automatic context from focusedPanelId in workbenchStore
const context = deriveContext(focusedPanelId);
```

### Built-in Variables

```typescript
{
  // View focus (from workbenchStore.focusedPanelId)
  activeView: ViewContext,
  queryEditorFocus: boolean,
  tableViewFocus: boolean,
  schemaViewFocus: boolean,
  resultViewFocus: boolean,

  // Panel state (from panelStore)
  hasSelection: boolean,
  hasMultipleSelections: boolean,
  isEditing: boolean,
  isDirty: boolean,

  // UI state (from workspaceScreenStore)
  leftSidebarVisible: boolean,
  rightSidebarVisible: boolean,
  dialogOpen: boolean,
  commandPaletteOpen: boolean,

  // Database state (from connectionStore)
  isConnected: boolean,
  queryRunning: boolean,
  hasResults: boolean,

  // Platform (auto-detected)
  platform: 'mac' | 'windows' | 'linux',
  isMac: boolean,
  isWindows: boolean,
  isLinux: boolean
}
```

## Customization

### User Settings Storage

```typescript
interface UserKeybindings {
  version: string;
  overrides: KeybindingOverride[];
  disabled: string[];  // Command IDs to disable
}

interface KeybindingOverride {
  commandId: string;
  keybinding: Keybinding;
  timestamp: number;
}

// Storage in IndexedDB via Dexie
class KeybindingStorage {
  async load(): Promise<UserKeybindings>;
  async save(keybindings: UserKeybindings): Promise<void>;
  async reset(): Promise<void>;
  async export(): Promise<string>;  // JSON export
  async import(json: string): Promise<void>;
}
```

### Keybinding Editor UI

```typescript
interface KeybindingEditorProps {
  onSave: (overrides: KeybindingOverride[]) => void;
  onReset: () => void;
}

// Features:
// - Search/filter commands
// - Visual key recorder
// - Conflict detection & resolution
// - Platform preview
// - Import/export functionality
```

## Performance Optimizations

### Debouncing
- Rapid keystrokes debounced at 16ms (60fps)
- Command execution queue with priority

### Lazy Loading
```typescript
// Commands can define async handlers
interface LazyCommand extends Command {
  handler: () => Promise<CommandHandler>;
}

// Load heavy handlers on demand
const command: LazyCommand = {
  id: 'heavy.operation',
  title: 'Heavy Operation',
  handler: async () => {
    const module = await import('./heavyOperation');
    return module.execute;
  }
};
```

### Memoization
```typescript
class ContextEvaluator {
  private cache = new Map<string, WeakMap<KeyboardContext, boolean>>();

  evaluate(expression: string, context: KeyboardContext): boolean {
    if (!this.cache.has(expression)) {
      this.cache.set(expression, new WeakMap());
    }

    const contextCache = this.cache.get(expression)!;
    if (contextCache.has(context)) {
      return contextCache.get(context)!;
    }

    const result = this.evaluateExpression(expression, context);
    contextCache.set(context, result);
    return result;
  }
}
```

## Testing Strategy

### Unit Tests
```typescript
// KeyNormalizer tests
describe('KeyNormalizer', () => {
  test('normalizes platform keys', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true  // Mac
    });
    expect(normalizer.normalize(event)).toBe('cmd+k');
  });

  test('handles key sequences', () => {
    expect(normalizer.parse('cmd+k cmd+s')).toEqual({
      sequence: ['cmd+k', 'cmd+s']
    });
  });
});

// ContextEvaluator tests
describe('ContextEvaluator', () => {
  test('evaluates complex expressions', () => {
    const context = { editorFocus: true, hasSelection: false };
    expect(evaluator.evaluate('editorFocus && !hasSelection', context))
      .toBe(true);
  });
});
```

### Integration Tests
```typescript
// React hook tests
describe('useCommand', () => {
  test('registers and executes command', async () => {
    const handler = jest.fn();
    const { result } = renderHook(() =>
      useCommand({
        id: 'test.command',
        title: 'Test',
        handler
      })
    );

    await result.current.execute({ arg: 'value' });
    expect(handler).toHaveBeenCalledWith({ arg: 'value' });
  });
});
```

### E2E Tests
```typescript
// Playwright tests
test('keyboard shortcuts work in editor', async ({ page }) => {
  await page.goto('/workspace');
  await page.click('[data-testid="sql-editor"]');

  // Execute query
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('[data-testid="results"]')).toBeVisible();

  // Open command palette
  await page.keyboard.press('Meta+K');
  await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
});
```

## Migration Strategy (Zero Breaking Changes)

### Phase 1: Foundation (Week 1)
**Goal**: Build core system alongside existing code

1. **Create Core Infrastructure**
   ```typescript
   // New files, no changes to existing code
   src/services/keyboard/
   ├── KeyboardManager.ts
   ├── KeyNormalizer.ts
   ├── CommandRegistry.ts
   └── types.ts
   ```

2. **Add Provider to App**
   ```typescript
   // App.tsx - Single line addition
   <KeyboardProvider>
     {/* existing app */}
   </KeyboardProvider>
   ```

3. **Create Compatibility Layer**
   ```typescript
   // Wrap existing patterns for gradual migration
   export function useLegacyShortcut(handler: () => void) {
     // Maps old pattern to new system
   }
   ```

### Phase 2: Progressive Migration (Week 2)
**Goal**: Migrate components one at a time

1. **Start with QueryPanel**
   ```typescript
   // BEFORE: 30+ lines of useEffect
   // AFTER: 3 lines
   useShortcut('cmd+enter', handleExecute);
   useShortcut('alt+f', handleBeautify);
   useShortcut('alt+h', () => setShowHistory(prev => !prev));
   ```

2. **Add Context to Panels**
   ```typescript
   // Just add context prop to existing components
   <QueryPanel context="queryEditor" />
   <TableViewPanel context="tableView" />
   ```

3. **Provide Migration Warnings**
   ```typescript
   // Helpful deprecation notices
   console.warn(
     'Direct window.addEventListener for shortcuts is deprecated.\n' +
     'Use useShortcut("cmd+enter", handler) instead.\n' +
     'See: docs/shortcut.spec.md#migration'
   );
   ```

### Phase 3: Enhanced Features (Week 3)
**Goal**: Add new capabilities

1. **Command Palette** - Show all available commands
2. **Shortcut Hints** - Tooltips with shortcuts
3. **Customization UI** - Let users change shortcuts
4. **Conflict Detection** - Prevent duplicate bindings

### Migration Checklist

#### QueryPanel Migration
- [ ] Replace window.addEventListener with useShortcut
- [ ] Add context="queryEditor" to component
- [ ] Remove manual cleanup code
- [ ] Add shortcut hints to buttons

#### WorkbenchLayout Migration
- [ ] Convert split shortcuts to commands
- [ ] Convert navigation shortcuts
- [ ] Add context="workbench"
- [ ] Update focus management

#### TableView/DataGrid Migration
- [ ] Integrate with Glide Data Grid's keyboard handling
- [ ] Add save/cancel edit commands
- [ ] Implement undo/redo for cell edits
- [ ] Add row manipulation shortcuts (insert/delete)
- [ ] Ensure context isolation when editing

#### Quick Wins (Do First)
- [ ] Create `usePlatformKey()` hook
- [ ] Add shortcut tooltips to all buttons
- [ ] Document shortcuts in README

### Manual Migration Guide

#### Step 1: Replace Event Listeners
```typescript
// BEFORE: QueryPanel.tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isExecuting && query.trim()) {
        void handleExecute();
      }
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [query, isExecuting, handleExecute]);

// AFTER: QueryPanel.tsx
useShortcut('cmd+enter', handleExecute, {
  when: 'queryEditor.focus && !isExecuting && hasQuery',
  preventDefault: true
});
```

#### Step 2: Update Component Props
```typescript
// Add context prop to panel components
<QueryPanel
  context="queryEditor"
  connectionId={connectionId}
  // ... other props
/>
```

#### Step 3: Register Commands
```typescript
// Create command definitions
const queryCommands = [
  {
    id: 'query.execute',
    title: 'Execute Query',
    handler: handleExecute,
    shortcut: 'cmd+enter',
    when: 'queryEditor.focus'
  },
  {
    id: 'query.beautify',
    title: 'Format SQL',
    handler: handleBeautify,
    shortcut: 'alt+f',
    when: 'queryEditor.focus'
  }
];

// Register in component
queryCommands.forEach(cmd => useCommand(cmd));
```

## Success Metrics

- ✅ All existing shortcuts continue working
- ✅ Command execution time < 50ms
- ✅ Zero conflicting shortcuts in defaults
- ✅ 90% of common actions have shortcuts
- ✅ Command palette displays all shortcuts
- ✅ Platform-specific shortcuts work correctly
- ✅ Custom keybindings persist across sessions
- ✅ Conflict resolution UI prevents issues

## API Examples

### Registering a Command
```typescript
// In component
const saveCommand = useCommand({
  id: 'file.save',
  title: 'Save File',
  category: 'file',
  handler: async () => {
    await saveCurrentFile();
    toast.success('File saved');
  },
  when: 'editorFocus && isDirty',
  keybinding: {
    key: 'cmd+s',
    priority: 100
  }
});

// Execute programmatically
<Button onClick={() => saveCommand.execute()}>
  Save {saveCommand.keybinding}
</Button>
```

### Component-Level Shortcut
```typescript
function MyComponent() {
  const [open, setOpen] = useState(false);

  useShortcut('cmd+o', () => setOpen(true), {
    when: '!dialogOpen'
  });

  return <Dialog open={open} />;
}
```

### Context-Aware Commands
```typescript
// Different behavior based on context
const deleteCommand = useCommand({
  id: 'edit.delete',
  title: 'Delete',
  handler: async () => {
    const context = keyboardStore.getState();

    if (context.activeView === 'schema') {
      await deleteSelectedTable();
    } else if (context.activeView === 'editor') {
      await deleteSelectedText();
    } else if (context.activeView === 'results') {
      await deleteSelectedRows();
    }
  },
  when: 'hasSelection',
  keybinding: { key: 'delete' }
});
```

### Custom Keybinding Override
```typescript
// User customization
async function updateKeybinding(commandId: string, newKey: string) {
  const storage = new KeybindingStorage();
  const current = await storage.load();

  current.overrides.push({
    commandId,
    keybinding: { key: newKey },
    timestamp: Date.now()
  });

  await storage.save(current);
  KeyboardManager.getInstance().reload();
}
```

## Implementation Priority Order

### Week 1: Core Foundation
1. **Day 1-2: Basic Infrastructure**
   - [ ] KeyboardManager.ts - Singleton with single global listener
   - [ ] KeyNormalizer.ts - Platform abstraction (cmd/ctrl)
   - [ ] types.ts - TypeScript interfaces

2. **Day 3-4: Command System**
   - [ ] CommandRegistry.ts - Command registration & execution
   - [ ] ContextEvaluator.ts - Simple when clause evaluation
   - [ ] Default commands configuration

3. **Day 5: React Integration**
   - [ ] KeyboardProvider component
   - [ ] useShortcut hook (simple version)
   - [ ] Basic context from focusedPanelId

### Week 2: Enhanced Features
1. **Day 1-2: Advanced Hooks**
   - [ ] useCommand hook with full features
   - [ ] useKeybindingHint for tooltips
   - [ ] Context cascading from parent components

2. **Day 3-4: Store Integration**
   - [ ] Connect to workbenchStore (focusedPanelId)
   - [ ] Connect to workspaceScreenStore (sidebars)
   - [ ] Connect to panelStore (panel states)

3. **Day 5: Migration**
   - [ ] Migrate QueryPanel shortcuts
   - [ ] Migrate WorkbenchLayout shortcuts
   - [ ] Add backward compatibility layer

### Week 3: Polish & Advanced
1. **Command Palette Integration**
2. **Customization UI**
3. **Conflict Detection**
4. **Performance Optimization**

## Testing Plan

### Unit Tests Required
```typescript
// KeyNormalizer.test.ts
- Platform detection
- Key combination parsing
- Modifier key normalization

// ContextEvaluator.test.ts
- Expression parsing
- Boolean logic evaluation
- Context variable resolution

// CommandRegistry.test.ts
- Command registration/unregistration
- Duplicate command handling
- Command execution
```

### Integration Tests Required
```typescript
// useShortcut.test.tsx
- Hook lifecycle
- Context awareness
- Cleanup on unmount

// KeyboardProvider.test.tsx
- Context propagation
- Event bubbling
- Multiple providers
```

### E2E Tests Required
- Execute query with Cmd+Enter
- Navigate panels with arrows
- Split panels with shortcuts
- Edit table cells with keyboard

## Common Pitfalls to Avoid

1. **Memory Leaks**
   - Always cleanup event listeners
   - Use WeakMap for component references
   - Unregister commands on unmount

2. **Context Issues**
   - Ensure context updates on focus change
   - Handle nested contexts correctly
   - Prevent shortcuts in modals/dialogs

3. **Performance**
   - Debounce rapid keystrokes
   - Use event delegation
   - Memoize context evaluations

4. **Platform Differences**
   - Test on Mac, Windows, Linux
   - Handle IME input correctly
   - Consider international keyboards

## Future Enhancements

1. **Macro Recording**: Record and replay key sequences
2. **Keybinding Profiles**: Switch between different layouts
3. **Touch Bar Support**: Mac Touch Bar integration
4. **Gesture Support**: Trackpad gestures as shortcuts
5. **Voice Commands**: Accessibility enhancement
6. **AI Suggestions**: Suggest shortcuts based on usage
7. **Cloud Sync**: Sync customizations across devices
8. **Extension API**: Allow plugins to register commands