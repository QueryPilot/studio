# Workspace Creation Form Design

**Date**: 2026-01-16  
**Status**: Approved  
**Author**: AI Assistant

## Overview

A new full-page workspace creation form for the HomeScreen that allows users to create workspaces with:
- Title (name)
- Icon (emoji via Notion-style picker)
- Tags (free-form input)
- Connection profiles (searchable multi-select)

## Requirements

### User Stories
1. As a user, I want to create a new workspace with a custom name
2. As a user, I want to pick an emoji icon using a Notion-style picker
3. As a user, I want to add free-form tags to organize my workspace
4. As a user, I want to search and select multiple connections to add to my workspace

### Design Decisions
- **Full-page form**: Matches existing `ConnectionForm` pattern for consistency
- **Notion-style icon picker**: Rich emoji picker with tabs, search, categories, and bottom navigation
- **Free-form tags**: Type and press Enter to add (no predefined list)
- **Searchable multi-select**: For connections with checkbox list and removable selected items

## UI Design

### Full Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [←] New Workspace                                           │
│     Create a workspace to group multiple connections        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Workspace Name                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ e.g., Production Stack, Backend Services              │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  🚀  ← Icon (clickable, opens Notion-style picker)          │
│                                                             │
│  Tags                                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ [backend ×] [api ×]  Type to add...                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Connections                                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 🔍 Search connections...                          ▼   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 🐘 Production DB     postgres:5432/main           [×] │  │
│  │ 🐬 Staging MySQL     mysql:3306/staging           [×] │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Create Workspace]   │
└─────────────────────────────────────────────────────────────┘
```

### Icon Picker (Notion-style)

**Trigger**: Just the emoji icon itself (clickable, hover shows subtle highlight)

**Popup**:
```
┌─────────────────────────────────────────────────────────────┐
│  Emoji     Icons     Upload                        Remove   │  ← Tabs + Remove
├─────────────────────────────────────────────────────────────┤
│  🔍 Filter...                              [🔀]       🖐️    │  ← Search + Random + Preview
├─────────────────────────────────────────────────────────────┤
│  Recent                                                     │
│  🚀 💼 🏢                                                   │
├─────────────────────────────────────────────────────────────┤
│  People                                                     │
│  😀 🤩 😎 🥳 😅 🤣 😂 😊 🙂 😏 😉                           │
│  🤗 🤭 🥰 😍 🤤 😋 😛 😜 🤪 😝 🤑                           │
├─────────────────────────────────────────────────────────────┤
│  🕐 😀 💬 🐾 🍕 ⚽ 🚗 💡 ✅ 🚩 🔲 ➕                         │  ← Category nav
└─────────────────────────────────────────────────────────────┘
```

**Features**:
- Tabs: Emoji (default) | Icons | Upload (future)
- Search: Filter emojis by name
- Random: Shuffle button for quick selection
- Preview: Shows currently hovered emoji
- Categories: Recent, People, Nature, Food, Activity, Travel, Objects, Symbols, Flags
- Bottom nav: Quick jump to categories

### Tags Input (Free-form)

```
┌─────────────────────────────────────────────────────────────┐
│  [backend ×] [api ×] [v2 ×]  Type to add...                 │
└─────────────────────────────────────────────────────────────┘
```

**Behavior**:
- Type text → Press Enter → Tag added as a pill
- Click × on pill → Tag removed
- Backspace on empty input → Removes last tag
- Tags are simple strings (no predefined list)

### Connection Multi-Select (Searchable)

**Trigger**:
```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Search connections...                               ▼   │
└─────────────────────────────────────────────────────────────┘
```

**Dropdown**:
```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Search connections...                                   │
├─────────────────────────────────────────────────────────────┤
│  ☑ 🐘 Production DB          postgres:5432/main             │
│  ☑ 🐬 Staging MySQL          mysql:3306/staging             │
│  ☐ 🐘 Dev PostgreSQL         localhost:5432/dev             │
│  ☐ 🍃 MongoDB Atlas          cluster0.mongodb.net           │
└─────────────────────────────────────────────────────────────┘
```

**Selected connections** (displayed below trigger):
```
┌─────────────────────────────────────────────────────────────┐
│  🐘 Production DB       postgres:5432/main              [×] │
│  🐬 Staging MySQL       mysql:3306/staging              [×] │
└─────────────────────────────────────────────────────────────┘
```

## Technical Design

### New Components

| Component | Path | Description |
|-----------|------|-------------|
| `IconPicker` | `src/components/IconPicker/IconPicker.tsx` | Notion-style emoji picker with tabs, search, categories |
| `TagInput` | `src/components/TagInput/TagInput.tsx` | Free-form tag input with pills |
| `ConnectionMultiSelect` | `src/screens/home/components/shared/ConnectionMultiSelect.tsx` | Searchable multi-select for connections |
| `WorkspaceCreationForm` | `src/screens/home/components/MainContent/WorkspaceCreationForm.tsx` | Main form component |

### Store Updates

**homeScreenStore.ts**:
- Add new `contentMode`: `"workspace-creation-form"`
- Add action: `openWorkspaceCreationForm()`
- Add action: `closeWorkspaceCreationForm()`

**types.ts**:
- Add `"workspace-creation-form"` to `ContentMode` union type

### MainContent Updates

Add conditional render for new mode:
```tsx
if (contentMode === "workspace-creation-form") {
  return <WorkspaceCreationForm />;
}
```

### Data Flow

1. User clicks "Create Workspace" button → `openWorkspaceCreationForm()`
2. Form renders with empty state
3. User fills form fields (name, icon, tags, connections)
4. User clicks "Create Workspace" → `workspaceBundleStore.createWorkspace()`
5. On success → `closeWorkspaceCreationForm()` → Navigate back

### Emoji Data

Use a static emoji dataset organized by category:
```typescript
const EMOJI_CATEGORIES = {
  recent: [], // Persisted in localStorage
  people: ['😀', '😃', '😄', ...],
  nature: ['🌸', '🌺', '🌹', ...],
  food: ['🍎', '🍊', '🍋', ...],
  activity: ['⚽', '🏀', '🏈', ...],
  travel: ['🚗', '🚕', '🚙', ...],
  objects: ['💼', '📁', '📂', ...],
  symbols: ['❤️', '💛', '💚', ...],
  flags: ['🏳️', '🏴', '🚩', ...],
};
```

## Implementation Plan

1. **Phase 1: Core Components**
   - Create `IconPicker` component
   - Create `TagInput` component
   - Create `ConnectionMultiSelect` component

2. **Phase 2: Form Integration**
   - Create `WorkspaceCreationForm` component
   - Update `homeScreenStore` with new mode
   - Update `MainContent` to render new form

3. **Phase 3: Polish**
   - Add keyboard navigation to IconPicker
   - Persist recent emojis to localStorage
   - Add validation and error handling

## Dependencies

- Existing shadcn/ui components: `Popover`, `Command`, `Input`, `Button`, `Label`
- Existing stores: `useWorkspaceBundleStore`, `useConnectionStore`, `useHomeScreenStore`
- Tabler icons: `@tabler/icons-react`

## Validation Rules

- **Name**: Required, non-empty string
- **Icon**: Optional, defaults to 🚀
- **Tags**: Optional, array of strings
- **Connections**: Optional, array of connection IDs (can create empty workspace)

## Future Enhancements

- Icons tab: Lucide/Tabler icon selection
- Upload tab: Custom image upload for workspace icon
- Color picker: Background color for workspace card
