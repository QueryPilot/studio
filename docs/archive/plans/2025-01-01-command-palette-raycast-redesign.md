# Command Palette Raycast-Style Redesign

## Overview

Redesign the CommandPalette to provide a unified, Raycast-style search experience with frecency-based ranking and polished visual design.

## Goals

1. **Unified search** - Merge commands and database objects into one searchable view
2. **Frecency ranking** - Rank items by frequency + recency of use
3. **Stable layout** - Fixed list height to prevent input shifting
4. **Raycast polish** - Action hints, better spacing, navigation footer

## Design Decisions

### Unified Data Model

All searchable items become a single `UnifiedItem` type:

```typescript
interface UnifiedItem {
  id: string;
  type: "table" | "view" | "materializedView" | "function" | "command";
  name: string;
  subtitle: string;        // row count, keybinding, or schema
  icon: React.ReactNode;
  keywords: string[];      // additional search terms
  // Type-specific payload
  table?: TableMeta;
  func?: FunctionMeta;
  command?: CategorizedCommand;
}
```

### Frecency Storage

New Zustand store with localStorage persistence:

```typescript
// src/stores/ui/commandPaletteFrecencyStore.ts
interface FrecencyEntry {
  lastAccessed: number;    // timestamp
  accessCount: number;
}

interface FrecencyState {
  items: Record<string, FrecencyEntry>;
  recordAccess: (itemId: string) => void;
  getFrecencyScore: (itemId: string) => number;
}
```

### Frecency Algorithm

```
Score = accessCount * recencyWeight

recencyWeight:
  - Used today (< 24h): 1.0
  - Used this week (< 7d): 0.7
  - Used this month (< 30d): 0.5
  - Older: 0.3
```

Items with no history get score 0 and fall back to alphabetical within their category.

### Layout Structure

```
┌──────────────────────────────────────────────┐
│  Search tables, commands, and more...        │  ← Input (pinned)
├──────────────────────────────────────────────┤
│  Recently Used                               │  ← Frecency section
│  ┌────────────────────────────────────────┐  │
│  │  users              public   ~500 rows │  │  ← Selected state
│  └────────────────────────────────────────┘  │
│     orders             public   ~1.2k rows   │
│     Toggle Sidebar                      ⌘B   │
│  ─────────────────────────────────────────── │  ← Separator
│  Tables                                      │
│     activity_logs      public     ~1 rows    │
│  Commands                                    │
│     New Query Tab                       ⌘T   │
├──────────────────────────────────────────────┤
│  ↑↓ Navigate   ⏎ Open   ⌘⏎ Open in Split    │  ← Footer (pinned)
└──────────────────────────────────────────────┘
```

### Dimensions

- Dialog width: `540px`
- List height: fixed `360px` (min-h-90 = max-h-90)
- Row padding: `py-2 px-3`

### Search Behavior

**Empty query:**
- "Recently Used" section: top 12 items by frecency score
- Category sections below with remaining items sorted by frecency within each

**With query:**
- Fuzzy search all items
- Combined score: `(fuzzyScore * 0.6) + (frecencyScore * 0.4)`
- "Recently Used" section: top 8 frecency matches that also match query
- Category sections with remaining matches

### Keyboard Interactions

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate items |
| `⏎` | Open selected item |
| `⌘⏎` / `Ctrl⏎` | Open in split right panel |
| `Esc` | Close palette |

### Removed Features

- **Mode switching with ">"** - No longer needed; commands are unified with objects
- **`mode` and `origin` state** - Removed from `commandPaletteStore`

## File Changes

### Modified Files

1. **`src/components/CommandPalette/CommandPalette.tsx`**
   - Refactor to unified search model
   - Add footer component
   - Remove mode switching logic
   - Integrate frecency sorting

2. **`src/components/CommandPalette/useCommandPaletteQueries.ts`**
   - Create `useUnifiedItems()` hook combining all item types
   - Add frecency-aware sorting

3. **`src/components/ui/command.tsx`**
   - Add `CommandFooter` component
   - Set fixed min-height on `CommandList`
   - Adjust dialog width

4. **`src/stores/ui/commandPaletteStore.ts`**
   - Remove `mode`, `origin`, `setMode`
   - Simplify to `isOpen`, `query`, `openPalette`, `closePalette`

### New Files

1. **`src/stores/ui/commandPaletteFrecencyStore.ts`**
   - Frecency tracking store
   - localStorage persistence
   - `recordAccess()` and `getFrecencyScore()` methods

2. **`src/components/CommandPalette/useFrecency.ts`**
   - Hook wrapping frecency store
   - Frecency score calculation logic

## Component Structure

```
CommandPalette
├── CommandInput
├── CommandList (fixed height: 360px)
│   ├── RecentlyUsedSection
│   │   └── UnifiedItemRow[]
│   ├── TablesSection
│   │   └── UnifiedItemRow[]
│   ├── ViewsSection
│   │   └── UnifiedItemRow[]
│   ├── FunctionsSection
│   │   └── UnifiedItemRow[]
│   └── CommandsSection
│       └── UnifiedItemRow[]
└── CommandFooter
```

## Visual Design

### Item Row

- **Left**: Type icon (color-coded)
  - Table: orange `IconTable`
  - View: green `IconEye`
  - Materialized View: blue `IconEye`
  - Function: purple `IconMathFunction`
  - Command: gray `IconTerminal2` or `IconCommand`
- **Center**: Name + schema/category (muted)
- **Right**: Metadata (row count or keybinding)

### Footer

- Muted background
- Shows: `↑↓ Navigate   ⏎ Open   ⌘⏎ Open in Split`
- Platform-aware: shows `Ctrl` on Windows/Linux

### Section Headers

- Muted text, smaller font
- Subtle separator line between sections

## Testing Considerations

- Frecency persistence across sessions
- Score decay over time
- Combined search ranking accuracy
- Keyboard navigation across sections
- Platform-specific keybinding display
