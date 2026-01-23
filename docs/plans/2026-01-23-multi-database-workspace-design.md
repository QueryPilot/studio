# Multi-Database Workspace & Tab State Persistence

**Date**: 2026-01-23
**Status**: Implemented
**Author**: Claude + Hieu

## Problem Statement

Currently, Query Pilot has several UX issues when working with multiple databases:

1. **Tab state lost on switch**: Query text and execution state disappear when switching between tabs
2. **Database switching is destructive**: "Switch Database" mutates the connection, breaking existing tabs
3. **No visual tab grouping**: Can't tell which tabs belong to which database
4. **Context loss**: Switching databases requires mental context switching; can't compare data across DBs easily

## Solution Overview

Leverage the existing multi-connection workspace architecture where **each database = separate connection profile**. Tabs are permanently bound to their connection and never "drift".

### Mental Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WORKSPACE                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ ConnectionActivityBar (left edge)                                │    │
│  │  [todoapp]  ← focused (highlighted)                              │    │
│  │  [analytics]                                                     │    │
│  │  [staging]                                                       │    │
│  │  [+] Add                                                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────┐  ┌────────────────────────────────────────────────┐    │
│  │  Sidebar    │  │  Workbench Tabs                                 │    │
│  │  (todoapp)  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │             │  │  │🟢 Query 1│ │🟢 users  │ │🔵 events │        │    │
│  │  Tables     │  │  └──────────┘ └──────────┘ └──────────┘        │    │
│  │  ├─ users   │  │       ↑            ↑            ↑              │    │
│  │  ├─ posts   │  │   todoapp      todoapp     analytics           │    │
│  │  └─ ...     │  │                                                 │    │
│  └─────────────┘  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Behaviors

1. **Activity bar** shows all database connections in workspace
2. **Clicking activity bar icon** → focuses that connection → sidebar shows its objects
3. **Clicking a tab** → if tab's `connectionId` differs from focused → auto-switch focus
4. **Tab badge/color** indicates which connection it belongs to
5. **Tab state persists** → switching tabs preserves query text

## Detailed Design

### 1. Tab State Persistence

**Location**: `src/stores/tabStateStore.ts`

**What to persist** (lightweight - no large result sets):

```typescript
interface PersistedTabState {
  tabId: string;
  query: string;                    // SQL text - always save
  lastExecutedQuery: string;        // For refresh capability
  viewMode: "table" | "json" | "explain" | "raw" | "stats";
  selectedDialect?: SqlDialect;
  // NOT persisted: result, isExecuting, isStreaming (runtime only)
}

// Storage key pattern
localStorage.setItem(`tab-state-${tabId}`, JSON.stringify(state));
```

**Lifecycle**:

| Event | Action |
|-------|--------|
| Tab created | Load persisted state if exists, else initialize empty |
| Query text changes | Debounced save (500ms) to localStorage |
| Tab closed | Remove from localStorage via `clearTabCache()` |
| App restart | `workbenchStore` restores layout → each tab loads its persisted state |

**What we DON'T persist**:
- Query results (too large, stale anyway)
- Execution state (isExecuting, isStreaming)
- Background queries

**Re-execution on restore**:
- Tab shows empty results with "Run query to see results" prompt
- Optional future enhancement: auto-execute `lastExecutedQuery` on tab focus

### 2. Database Switching UX

**Location**: `src/components/CommandPalette/NestedDatabaseList.tsx`

**Current flow (broken)**:
```
User: Cmd+K → selects "analytics" database
  ↓
switch_database(connectionId, "analytics")
  ↓
Disconnects → Reconnects same connectionId to new DB
  ↓
All existing tabs now point to wrong database ❌
```

**New flow**:
```
User: Cmd+K → selects "analytics" database
  ↓
getOrCreateDatabaseConnection(connectionId, "analytics")
  ↓
Returns existing or creates NEW connectionId for analytics
  ↓
addConnectionToWorkspace(newConnectionId)
  ↓
setFocusedConnection(newConnectionId)
  ↓
Sidebar updates, existing tabs untouched ✅
```

**Code changes to `NestedDatabaseList.tsx`**:

```typescript
// Before (in onSelect handler)
const handleDatabaseSelect = async (dbName: string) => {
  await databaseService.switchDatabase(connectionId, dbName);
  // ... updates selection store
};

// After
const handleDatabaseSelect = async (dbName: string) => {
  // Check if already in workspace
  const existingConnId = findConnectionInWorkspace(dbName);
  if (existingConnId) {
    setFocusedConnection(existingConnId);
    return;
  }

  // Get or create connection for this database
  const newConnId = await getOrCreateDatabaseConnection(connectionId, dbName);

  // Add to workspace and focus
  await addConnectionToWorkspace(newConnId);
  setFocusedConnection(newConnId);
};
```

**UI Changes**:

| Action | Current | New |
|--------|---------|-----|
| Click database | Calls `switch_database` | Adds to workspace + focuses |
| Already in workspace | N/A | Just focuses that connection |
| Shift+Click | N/A | Open in new window |
| Hover [+] button | Add to workspace | Remove (click now does this) |
| Hover [↗] button | Open new window | Keep as-is |

### 3. Tab Visual Grouping

**Location**: Tab component in workbench (likely `src/components/Workbench/`)

**Design**: Colored dot indicator + hover tooltip

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟢 Query 1  │ 🟢 users  │ 🔵 events  │ 🔵 Query 2  │           │
└─────────────────────────────────────────────────────────────────┘
     todoapp      todoapp    analytics    analytics
     (hover)      (hover)    (hover)      (hover)
```

**Color assignment**:

```typescript
const CONNECTION_COLORS = [
  "bg-green-500",   // 1st connection
  "bg-blue-500",    // 2nd connection
  "bg-purple-500",  // 3rd connection
  "bg-orange-500",  // 4th connection
  "bg-pink-500",    // 5th+
];

function getConnectionColor(connectionId: string, workspaceConnections: string[]): string {
  const index = workspaceConnections.indexOf(connectionId);
  return CONNECTION_COLORS[index % CONNECTION_COLORS.length];
}
```

**Visibility rules**:
- Show indicators when workspace has 2+ connections
- Hide when single connection (no ambiguity)
- Same color appears on activity bar icon for consistency

### 4. Deprecate `switch_database` for Navigation

**Location**: `src-tauri/src/commands/sql.rs`, `src/services/databaseService.ts`

The Rust `switch_database` command can remain for edge cases (e.g., reconnecting after disconnect), but frontend stops using it for normal database navigation.

**Changes**:
- Remove `switchDatabase` calls from `NestedDatabaseList.tsx`
- Remove from `WorkspaceTitleBar.tsx` database dropdown
- Keep the backend command available but undocumented for UI

## File Changes Summary

| File | Changes |
|------|---------|
| `src/stores/tabStateStore.ts` | Add persistence functions, debounced save |
| `src/lib/cacheManager.ts` | Add localStorage cleanup for tab state |
| `src/components/CommandPalette/NestedDatabaseList.tsx` | Change onSelect to add-to-workspace flow |
| `src/screens/workspace/components/WorkspaceTitleBar.tsx` | Update database dropdown behavior |
| `src/components/Workbench/WorkbenchTabs.tsx` (or similar) | Add connection color indicators |
| `src/components/Workbench/Tab.tsx` (or similar) | Add colored dot + tooltip |

## Edge Cases

1. **Database already in workspace**: Just call `setFocusedConnection()`, don't add duplicate
2. **Single-connection temporary workspace**: Auto-promote to multi-connection on second DB add
3. **Connection loses connectivity**: Tab shows error state but retains `connectionId` for reconnect
4. **Tab from removed connection**: Show "Connection removed" state, offer to close or reassign
5. **localStorage full**: Graceful degradation - log warning, skip persistence

## Migration

No data migration needed. Existing users will:
- Keep their current workbench layouts (already persisted in `workbenchStore`)
- Start with empty tab state (query text) - acceptable since results weren't persisted anyway
- See new behavior immediately on next database switch

## Testing Plan

1. **Tab persistence**: Create query tab → write SQL → switch to another tab → switch back → verify SQL preserved
2. **Database add flow**: Open Cmd+K → select new database → verify added to activity bar without breaking existing tabs
3. **Tab grouping**: Open tabs from 2+ databases → verify color indicators appear and match activity bar
4. **Focus sync**: Click tab from different connection → verify sidebar switches to that database
5. **Restart persistence**: Write queries → restart app → verify query text restored (not results)

## Future Enhancements

- Auto-execute last query on tab focus (user preference)
- Persist small result sets (< 100 rows) for instant restore
- Tab grouping UI (collapsible groups by connection)
- Drag tabs between connections (reassign `connectionId`)
