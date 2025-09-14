# Command Palette Specification

## ⚠️ CURRENT STATUS: KEYBOARD SHORTCUTS NOT WORKING
**Known Issue**: Keyboard shortcuts are currently non-functional due to context evaluation problems. Investigation completed - root cause identified as mismatch between `when` clauses and available context values. Move to other tasks for now.

## Overview
VSCode-like command palette for DevDB Studio providing quick access to all commands, files, and actions.

## Activation Shortcuts
- **Command Palette**: `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows/Linux)
- **Quick Open**: `Cmd+P` (Mac) / `Ctrl+P` (Windows/Linux)
- **Go to Symbol**: `Cmd+Shift+O` (Mac) / `Ctrl+Shift+O` (Windows/Linux)
- **Go to Line**: `Cmd+G` (Mac) / `Ctrl+G` (Windows/Linux)

## Features

### 1. Command Search
- Fuzzy search through all available commands
- Shows command name, keybinding, and description
- Context-aware filtering (only shows valid commands)
- Most recently used (MRU) ordering

### 2. Quick Open Modes
```
>  Command mode (default)
@  Go to symbol (tables, views, functions)
:  Go to line (in query editor)
?  Help and documentation
#  Global search
!  Run SQL snippets
$  Variable/parameter search
```

### 3. UI Design
```
┌──────────────────────────────────────────┐
│ > Search commands...                   ⌘⇧P│
├──────────────────────────────────────────┤
│ ▸ Execute Query                    Cmd+Enter│
│ ▸ Format SQL                         Alt+F│
│ ▸ Toggle Panel                       Cmd+B│
│ ▸ New Query Tab                      Cmd+T│
│ ▸ Close Tab                          Cmd+W│
│ ▸ Save Query                         Cmd+S│
├──────────────────────────────────────────┤
│ Recently Used                             │
│ ▸ Execute Query                           │
│ ▸ Format SQL                              │
└──────────────────────────────────────────┘
```

### 4. Command Categories
- **Query**: Execute, format, save, export
- **Navigation**: Go to table, view, function
- **Edit**: Find, replace, multi-cursor
- **View**: Toggle panels, zoom, themes
- **Database**: Connect, disconnect, refresh
- **Help**: Documentation, shortcuts, about

### 5. Advanced Features

#### Smart Suggestions
```typescript
interface CommandSuggestion {
  id: string;
  label: string;
  detail?: string;
  keybinding?: string;
  icon?: string;
  category?: string;
  score: number; // Relevance score
}
```

#### Context Actions
- Table selected → Show table operations
- Query editor focused → Show query commands
- Connection active → Show database commands

#### Quick Actions
- `> format` → Format current SQL
- `@ users` → Go to users table
- `: 42` → Go to line 42
- `? shortcuts` → Show keyboard shortcuts

## Implementation Architecture

### 1. Core Components

```typescript
// Command provider interface
interface CommandProvider {
  getCommands(context: CommandContext): Command[];
  executeCommand(id: string, ...args: any[]): Promise<void>;
}

// Palette state
interface PaletteState {
  isOpen: boolean;
  mode: PaletteMode;
  query: string;
  results: CommandSuggestion[];
  selectedIndex: number;
}
```

### 2. Integration Points

#### With Keyboard Manager
```typescript
// Register palette shortcuts
keyboard.registerCommand('workbench.action.showCommands', {
  handler: () => palette.open('>'),
  keybinding: 'cmd+shift+p',
  when: 'editorFocus'
});
```

#### With Schema Store
```typescript
// Provide database objects for @ mode
class SchemaCommandProvider implements CommandProvider {
  getCommands(context) {
    const tables = schemaStore.getTables();
    return tables.map(table => ({
      id: `goto.table.${table.name}`,
      label: table.name,
      category: 'Tables',
      icon: 'table'
    }));
  }
}
```

### 3. Search Algorithm

```typescript
// Fuzzy matching with scoring
function fuzzyMatch(query: string, target: string): number {
  // Prioritize:
  // 1. Exact matches (score: 1000)
  // 2. Prefix matches (score: 500)
  // 3. Word boundary matches (score: 200)
  // 4. Fuzzy matches (score: 1-100)
}

// Sort by:
// 1. Context relevance
// 2. Usage frequency
// 3. Fuzzy match score
```

### 4. Performance Optimizations

- Virtual scrolling for large result sets
- Debounced search (150ms)
- Cached command list
- Incremental filtering
- Web Worker for heavy computations

## User Experience

### Keyboard Navigation
- `↑/↓` - Navigate results
- `Enter` - Execute selected command
- `Tab` - Accept autocomplete
- `Esc` - Close palette
- `Cmd+↑/↓` - Jump to category

### Visual Feedback
- Highlight matching characters
- Show keybinding hints
- Preview on hover
- Loading states for async commands

### Accessibility
- ARIA labels and roles
- Screen reader announcements
- High contrast theme support
- Keyboard-only navigation

## Migration Path

### Phase 1: Basic Implementation
1. Create palette UI component
2. Integrate with existing commands
3. Add basic search

### Phase 2: Enhanced Features
1. Add fuzzy search
2. Implement quick open modes
3. Add MRU tracking

### Phase 3: Advanced Integration
1. Schema object navigation
2. SQL snippet execution
3. Context-aware suggestions

## API Examples

### Registering Commands
```typescript
// In component
useCommand({
  id: 'query.execute',
  label: 'Execute Query',
  keybinding: 'cmd+enter',
  handler: async () => {
    await executeQuery();
  },
  when: 'editorFocus && !executing'
});
```

### Opening Palette
```typescript
// Programmatically
commandPalette.open({
  mode: '>',
  placeholder: 'Type a command...',
  commands: await getContextCommands()
});

// With preset query
commandPalette.open({
  mode: '@',
  query: 'users',
  autoExecute: true // Execute if single match
});
```

### Custom Providers
```typescript
// Register SQL snippet provider
commandPalette.registerProvider({
  mode: '!',
  getCommands: async () => {
    const snippets = await loadSnippets();
    return snippets.map(s => ({
      id: `snippet.${s.id}`,
      label: s.name,
      detail: s.description,
      handler: () => insertSnippet(s.code)
    }));
  }
});
```

## Success Metrics

- Command execution time < 100ms
- Search response time < 50ms
- 90% of commands accessible in < 3 keystrokes
- Zero mouse usage for power users
- Discoverability: Users find 80% of features

## Next Steps

1. **Immediate**: Build basic palette with command search
2. **Week 1**: Add fuzzy search and keyboard navigation
3. **Week 2**: Implement quick open modes
4. **Week 3**: Add context awareness and MRU
5. **Future**: SQL snippets, themes, extensions