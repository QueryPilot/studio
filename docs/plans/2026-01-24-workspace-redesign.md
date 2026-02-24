# Workspace Redesign: Multi-Connection Sidebar & Tab Persistence

**Date**: 2026-01-24
**Status**: Draft
**Author**: Claude + Hieu

## Problem Statement

Current workspace has critical bugs:
1. **Tabs disappear** when switching between connections (layout gets wiped)
2. **State not persisting** - QuickFilter, sorting lost when switching tabs
3. **Sidebar shows one connection** - need VS Code-style multi-project view

## Solution Overview

### Mental Model

```
┌─ Workspace ──────────────────────────────────────┐
│                                                   │
│  ┌─ Sidebar ───────┐  ┌─ Workbench ────────────┐ │
│  │ ▼ PostgreSQL    │  │ [🐘 users][🐬 orders]  │ │
│  │   Schema: [pub▾]│  │ [🐘 Query1][🍃 logs]   │ │
│  │   ▼ Tables      │  │                         │ │
│  │     users       │  │  ┌─────────────────┐   │ │
│  │     posts       │  │  │  Tab Content    │   │ │
│  │   ▶ Views       │  │  │                 │   │ │
│  │ ▶ MySQL         │  │  └─────────────────┘   │ │
│  │ ▶ MongoDB       │  │                         │ │
│  └─────────────────┘  └─────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### Key Changes

1. **Remove ConnectionActivityBar** - connections move into sidebar
2. **Single global tab list** - no per-connection layout swapping
3. **Sidebar shows ALL connections** as collapsible sections
4. **Schema selector per connection** - inside each expanded section
5. **Tab ↔ Sidebar sync** - clicking tab expands its connection in sidebar
6. **Full state persistence** - QuickFilter, sorting, scroll position, etc.

## Detailed Design

### 1. Sidebar Structure

```
┌─ CONNECTIONS ──────────────────────────┐
│ [+ Add] [⟳ Refresh All]                │
├────────────────────────────────────────┤
│ ▼ 🐘 PostgreSQL - todoapp              │
│   Schema: [public      ▾]              │
│   ▼ Tables (12)                        │
│       users                            │
│       posts                            │
│   ▶ Views (3)                          │
│   ▶ Functions (5)                      │
│                                        │
│ ▼ 🐬 MySQL - analytics                 │
│   Schema: [analytics   ▾]              │
│   ▼ Tables (8)                         │
│       events                           │
│                                        │
│ ▶ 🍃 MongoDB - logs                    │
└────────────────────────────────────────┘
```

**Behavior:**
- Each connection is a collapsible section with database icon + name
- Connection status indicator (green dot = connected, red = error)
- Right-click connection header → Reconnect, Remove, Open in New Window
- Multiple connections can be expanded simultaneously
- Schema dropdown inside each expanded connection section
- Search filters across ALL expanded connections
- MongoDB/Redis don't show schema dropdown (not applicable)

### 2. Tab Behavior

**Display:**
```
[🐘 users] [🐘 Query 1] [🐬 events] [🍃 logs] [+]
```
- Each tab shows connection icon (small) + tab name
- All tabs visible regardless of which connection is expanded in sidebar

**Tab ↔ Sidebar Sync:**
- Click tab from MySQL → MySQL section auto-expands in sidebar
- Click table in sidebar → opens/focuses tab, sidebar stays as-is

### 3. State Persistence

All state persisted to IndexedDB, survives app restart:

| State | Storage | When Saved |
|-------|---------|------------|
| Query text | `tabStateStore` | Debounced 500ms |
| View mode (Data/Structure/etc) | `tabStateStore` | On change |
| QuickFilter text + mode | `gridPreferencesStore` | On submit |
| Sorting (columns + direction) | `gridPreferencesStore` | On change |
| Column widths | `gridPreferencesStore` | Debounced |
| Column visibility | `gridPreferencesStore` | On change |
| Scroll position | `gridPreferencesStore` | Debounced |

**Grid ID format:** `{connectionId}:{database}:{schema}:{table}:{tabId}`

### 4. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Connection disconnects | Tabs remain visible but show error state |
| Remove connection | Prompt to close tabs or keep orphaned |
| App restart | All tabs restored, sidebar expansions restored |
| Same table opened twice | Each tab has unique `tabId`, separate state |
| Search in sidebar | Filters across ALL expanded connections |

## File Changes

### Delete
- `src/screens/workspace/components/ConnectionActivityBar.tsx`

### Modify
| File | Change |
|------|--------|
| `DatabaseSidebar.tsx` | Rewrite to show all connections with collapsible sections |
| `WorkspaceScreen.tsx` | Remove activity bar, update layout |
| `workbenchStore.ts` | Remove per-connection layout swapping |
| `workspaceBundleStore.ts` | Remove layout save/restore from `setFocusedConnection` |
| `tabStateStore.ts` | Add `viewMode` persistence |
| `useQuickFilter.ts` | Add persistence to `gridPreferencesStore` |
| `DraggableTab.tsx` | Add connection icon to tab |
| `PanelDnd.tsx` | Remove connection filtering of tabs |

### New Files
| File | Purpose |
|------|---------|
| `ConnectionSection.tsx` | Collapsible connection section component |
| `SidebarConnectionList.tsx` | Container for all connection sections |

## Migration

- Existing workbench layouts in localStorage will be ignored (fresh start)
- Grid preferences in IndexedDB preserved (column widths, etc.)
- Tab state in IndexedDB preserved (query text)

## Testing Plan

1. Open 3 connections (PG, MySQL, MongoDB)
2. Open tables from each, verify all tabs visible
3. Type QuickFilter, apply sorting, switch tabs, come back - state preserved
4. Restart app - all tabs and state restored
5. Remove connection - tabs closed or orphaned correctly
6. Search in sidebar - filters across expanded connections
