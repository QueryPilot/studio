# Preferences Dialog Specification

## Overview

Settings dialog following macOS/Windows native preferences patterns. Uses sidebar navigation with categorized settings panels. Opens with `Cmd+,` (macOS) or `Ctrl+,` (Windows).

## Architecture Pattern

### Dialog Structure
```
┌─────────────────────────────────────────────┐
│ ┌─────────┬─────────────────────────────┐   │
│ │ Sidebar │     Content Panel           │   │
│ │         │                             │   │
│ │ General │  [Active Category Settings] │   │
│ │ Editor  │                             │   │
│ │ AI      │                             │   │
│ │ Keys    │                             │   │
│ └─────────┴─────────────────────────────┘   │
│                                             │
│ [Reset to Defaults]    [Cancel]    [Save]  │
└─────────────────────────────────────────────┘
```

## Keyboard Shortcut Registration

```typescript
// Register in KeyboardManager or App initialization
manager.registerCommand({
  id: 'workbench.action.openPreferences',
  title: 'Open Preferences',
  handler: () => {
    usePreferencesStore.getState().open();
  },
  keybinding: {
    key: 'cmd+,',  // Will be normalized to ctrl+, on Windows/Linux
    when: ''
  }
});
```

## Categories & Settings

### 1. General
- **Theme**
  - Light / Dark / System (uses existing appStore)
- **Appearance**
  - Font size: 12-20px slider
  - Sidebar collapsed: On/Off (uses existing appStore)

### 2. Editor
- **General**
  - Font size: 10-24px (uses existing appStore preferences)
  - Tab size: 2/4/8 spaces (uses existing appStore preferences)


### 4. Keyboard Shortcuts
- **Search & Filter**
  - Search box for finding commands
  - Modified only toggle
- **Shortcut List**
  - Command name | Current binding | Default binding | Actions
  - Inline editing with conflict detection
  - Reset individual shortcuts
- **Preset Shortcuts**
  - Open Preferences: `Cmd+,` (default, non-modifiable)

## State Management

### Store Structure
```typescript
interface PreferencesState {
  isOpen: boolean;
  activeCategory: PreferenceCategory;
  unsavedChanges: boolean;
  preferences: PreferencesConfig;
  defaultPreferences: PreferencesConfig;
  errors: ValidationError[];
}

interface PreferencesConfig {
  general: GeneralPreferences;
  editor: EditorPreferences;
  dataGrid: DataGridPreferences;
  ai: AIPreferences;
  shortcuts: KeyboardShortcuts;
  connections: ConnectionPreferences;
  advanced: AdvancedPreferences;
}
```

### Persistence Strategy
1. Use Zustand with persist middleware
2. Store in localStorage with versioning
3. Sync with Tauri's secure storage for sensitive data
4. Export/import as JSON for backup

## UI Components

### Dialog Component
```typescript
// Main dialog container
<Dialog open={isOpen} onOpenChange={handleOpenChange}>
  <DialogContent className="max-w-4xl h-[600px]">
    <PreferencesSidebar />
    <PreferencesContent />
    <PreferencesFooter />
  </DialogContent>
</Dialog>
```

### Sidebar Navigation
```typescript
// Using shadcn/ui Sidebar pattern
<Sidebar>
  <SidebarContent>
    <SidebarGroup>
      <SidebarMenu>
        {categories.map((category) => (
          <SidebarMenuItem key={category.id}>
            <SidebarMenuButton
              isActive={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              <category.icon />
              <span>{category.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  </SidebarContent>
</Sidebar>
```

### Form Controls
- Use shadcn/ui form components
- Implement validation with react-hook-form
- Show inline errors and warnings
- Support undo/redo for changes

## Keyboard Shortcut Management

### Implementation
```typescript
interface KeyboardShortcut {
  id: string;
  command: string;
  defaultKeys: string[];
  currentKeys: string[];
  category: string;
  when?: string; // Context expression
}

// Conflict detection
function detectConflicts(
  shortcut: KeyboardShortcut,
  allShortcuts: KeyboardShortcut[]
): KeyboardShortcut[] {
  return allShortcuts.filter(
    s => s.id !== shortcut.id &&
    arraysIntersect(s.currentKeys, shortcut.currentKeys)
  );
}
```

### Recording New Shortcuts
1. Click on shortcut field
2. Enter recording mode (visual indicator)
3. Capture key combination
4. Validate for conflicts
5. Show conflict resolution dialog if needed

## Search & Filter

### Global Search
```typescript
interface SearchableItem {
  category: string;
  label: string;
  path: string[];
  keywords: string[];
  value: any;
}

// Fuzzy search implementation
function searchPreferences(
  query: string,
  items: SearchableItem[]
): SearchResult[] {
  return items
    .map(item => ({
      item,
      score: fuzzyMatch(query, item)
    }))
    .filter(r => r.score > threshold)
    .sort((a, b) => b.score - a.score);
}
```

## Validation

### Real-time Validation
```typescript
const validationRules = {
  fontSize: (value: number) =>
    value >= 10 && value <= 24 || "Font size must be between 10-24",
  apiKey: (value: string) =>
    value.length > 0 || "API key is required",
  timeout: (value: number) =>
    value > 0 && value <= 600 || "Timeout must be 1-600 seconds"
};
```

### Save Validation
1. Validate all fields before save
2. Show error summary if validation fails
3. Navigate to first error field
4. Highlight invalid fields

## Import/Export

### Format
```json
{
  "version": "1.0.0",
  "exportDate": "2024-01-01T00:00:00Z",
  "application": "devdb-studio",
  "preferences": {
    "general": { ... },
    "editor": { ... },
    "shortcuts": { ... }
  }
}
```

### Migration Strategy
```typescript
function migratePreferences(
  data: any,
  fromVersion: string
): PreferencesConfig {
  const migrations = {
    "0.9.0": migrate_0_9_0_to_1_0_0,
    "0.8.0": migrate_0_8_0_to_0_9_0
  };

  let current = data;
  for (const [version, migrate] of migrations) {
    if (compareVersions(fromVersion, version) <= 0) {
      current = migrate(current);
    }
  }
  return current;
}
```

## Accessibility

### Keyboard Navigation
- Tab through all controls
- Arrow keys for sidebar navigation
- Enter/Space to activate buttons
- Escape to cancel/close

### Screen Reader Support
- ARIA labels for all controls
- Role attributes for custom components
- Live regions for status updates
- Descriptive button text

## Performance

### Optimizations
1. Lazy load category panels
2. Debounce search input (300ms)
3. Memoize expensive computations
4. Virtual scroll for long lists
5. Use React.memo for static components

### Code Splitting
```typescript
const categoryPanels = {
  general: lazy(() => import('./panels/GeneralPanel')),
  editor: lazy(() => import('./panels/EditorPanel')),
  dataGrid: lazy(() => import('./panels/DataGridPanel')),
  ai: lazy(() => import('./panels/AIPanel')),
  shortcuts: lazy(() => import('./panels/ShortcutsPanel')),
  connections: lazy(() => import('./panels/ConnectionsPanel')),
  advanced: lazy(() => import('./panels/AdvancedPanel'))
};
```

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create preferences store with Zustand
2. Implement base dialog component
3. Setup sidebar navigation
4. Add routing between categories

### Phase 2: Basic Settings
1. General preferences panel
2. Editor preferences panel
3. Form validation framework
4. Save/cancel/reset functionality

### Phase 3: Advanced Features
1. Keyboard shortcuts panel
2. Search functionality
3. Import/export system
4. AI configuration panel

### Phase 4: Polish
1. Animations and transitions
2. Accessibility improvements
3. Performance optimization
4. User documentation

## Testing Strategy

### Unit Tests
- Store actions and reducers
- Validation functions
- Search and filter logic
- Migration functions

### Integration Tests
- Panel navigation
- Form submission
- Keyboard shortcut recording
- Import/export flow

### E2E Tests
- Complete preferences workflow
- Persistence across sessions
- Conflict resolution
- Reset functionality

## File Structure
```
src/
├── components/
│   ├── Preferences/
│   │   ├── PreferencesDialog.tsx
│   │   ├── PreferencesSidebar.tsx
│   │   ├── PreferencesContent.tsx
│   │   ├── PreferencesFooter.tsx
│   │   ├── panels/
│   │   │   ├── GeneralPanel.tsx
│   │   │   ├── EditorPanel.tsx
│   │   │   ├── DataGridPanel.tsx
│   │   │   ├── AIPanel.tsx
│   │   │   ├── ShortcutsPanel.tsx
│   │   │   ├── ConnectionsPanel.tsx
│   │   │   └── AdvancedPanel.tsx
│   │   ├── components/
│   │   │   ├── PreferenceSection.tsx
│   │   │   ├── PreferenceItem.tsx
│   │   │   ├── ShortcutRecorder.tsx
│   │   │   └── SearchBar.tsx
│   │   └── hooks/
│   │       ├── usePreferences.ts
│   │       ├── useShortcuts.ts
│   │       └── useValidation.ts
├── stores/
│   └── preferencesStore.ts
├── services/
│   ├── preferencesService.ts
│   └── shortcutsService.ts
└── types/
    └── preferences.ts
```