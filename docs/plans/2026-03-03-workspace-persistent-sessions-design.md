# Workspace-First Persistent Sessions Design

## Problem

Session state is lost or partially lost across app restarts:
- **Tabs lost on restart** — layout restores but tabs are empty or gone
- **Tab content not restored** — query text, scroll positions, cursor positions, column widths lost
- **Cross-connection tab loss** — switching connections or workspaces wipes the other's tabs
- **No seamless restore** — user always lands on home screen, must manually reopen

## Design: "Everything is a Workspace"

### Core Mental Model

Every connection open creates or reopens a **workspace**. There are two types:

| Type | Created When | Visible on Home Screen | Auto-saves |
|------|-------------|----------------------|------------|
| **Auto-workspace** | User clicks a connection | No — invisible persistence mechanism | Yes |
| **Named workspace** | User explicitly names/saves | Yes — in Workspaces section | Yes |

Auto-workspaces have `autoCreated: true` on `WorkspaceConfig`. Users don't know they exist — they just click a connection and tabs are magically restored from last session.

**Promotion:** An auto-workspace becomes a named workspace (`autoCreated = false`) when the user:
- Renames it
- Adds a second connection
- Explicitly "Save as Workspace"

Within a workspace, tabs from all connections coexist (workspace-scoped unified layout). Only switching workspaces swaps the layout.

### Startup Behavior

Configurable in General Preferences:

| Setting | Behavior |
|---------|----------|
| **"Restore previous session"** (default) | Auto-opens last workspace window(s). No home screen detour. |
| **"Start at home screen"** | Shows home screen. Session data fully preserved in IndexedDB for when user opens a workspace. |

Both settings preserve all data. The preference only controls what shows on launch.

**Startup flow:**
```
App launch → VaultLoadingScreen → Check startupBehavior preference
  ├── "restore" → Read lastActiveWorkspaceIds from IndexedDB
  │     ├── Has workspaces → Open workspace window(s) directly
  │     └── No saved state → Fall through to home screen
  └── "home" → Show HomeScreen
```

### Multi-Window Restore

Each workspace window's state is tracked in `appState.windowStates[]`. On restore, all windows reopen with their positions/sizes.

## Persistence Layer

### Consolidate to IndexedDB (Dexie)

**Single Dexie database:** `query-pilot-sessions`

| Table | Key | Content |
|-------|-----|---------|
| `workspaceLayouts` | `workspaceId` | `{ layoutTree, panelContents[], savedAt, lastActiveAt }` |
| `tabStates` | `tabId` | Extended `PersistedTabState` (migrated from existing DB) |
| `appState` | `"singleton"` | `{ lastActiveWorkspaceIds, startupBehavior, windowStates[], migrationVersion }` |

### Extended Tab State

New fields added to `PersistedTabState`:

| Field | Type | Purpose |
|-------|------|---------|
| `scrollPosition` | `{ top: number, left: number }` | Grid/editor scroll position |
| `editorCursorPosition` | `{ line: number, ch: number }` | CodeMirror cursor position |
| `gridColumnWidths` | `Record<string, number>` | User-resized column widths |
| `pinnedResultQuery` | `string \| null` | Query that produced pinned result |

**Not persisted:** `result`, `pinnedResult` (large, re-fetchable), `isExecuting`, `isStreaming`, `inTransaction` (ephemeral).

### Auto-Save Strategy

| Change Type | Debounce | Target Table |
|-------------|----------|-------------|
| Layout (split, resize, tab add/remove) | 500ms | `workspaceLayouts` |
| Tab state (query text, cursor) | 500ms | `tabStates` |
| Scroll position, column widths | 1000ms | `tabStates` |
| Window close / app exit | Synchronous flush | All pending |

### Migration

On first launch with new schema:
1. Read `workbench-connection-*` from localStorage → write to `workspaceLayouts`
2. Read from `query-pilot-tab-state` IndexedDB → write to `tabStates` in `query-pilot-sessions`
3. Create auto-workspace configs for connections that had saved layouts
4. Mark `migrationVersion` in `appState`
5. Old localStorage keys kept for one version cycle, then cleaned up

## Store Architecture Changes

### `workbenchStore`

- **Remove:** `saveConnectionLayout()`, `restoreConnectionLayout()`, `saveLayout()`, `restoreLayout()` (all localStorage-based)
- **Add:** `persistLayout(workspaceId)` — debounced write to IndexedDB `workspaceLayouts`
- **Add:** `loadLayout(workspaceId)` — async read from IndexedDB, populate `layoutTree` + `panelContents`
- **Add:** Auto-persist subscription — on `layoutTree`/`panelContents` change, debounce 500ms, write to IndexedDB

### `workspaceBundleStore`

- **Remove:** `isTemporary` from `ActiveWorkspace`
- **Remove:** `tabLayout` from `WorkspaceConfig` (layout lives in IndexedDB now)
- **Remove:** `connectionStates[connId].tabLayout`
- **Change:** `openSingleConnection()` → uses `getOrCreateWorkspaceForConnection(connectionId)` to find or create an auto-workspace with a real UUID
- **Change:** `saveCurrentWorkspace()` → only saves config (name, connections) to vault. Layout auto-persists separately
- **Add:** `getOrCreateWorkspaceForConnection(connectionId)` — auto-workspace resolution
- **Add:** `autoCreated: boolean` to `WorkspaceConfig`

### `tabStateStore`

- **Extend:** `PersistedTabState` with `scrollPosition`, `editorCursorPosition`, `gridColumnWidths`, `pinnedResultQuery`
- **Migrate:** Dexie database to `query-pilot-sessions` (or version bump existing DB)

### New: App State Persistence

```ts
interface PersistedAppState {
  lastActiveWorkspaceIds: string[];
  startupBehavior: "restore" | "home";
  windowStates: Array<{
    workspaceId: string;
    windowBounds?: { x: number; y: number; width: number; height: number };
  }>;
  migrationVersion: number;
}
```

Stored in `appState` table with key `"singleton"`.

## Workspace Opening Flow (Revised)

```
User clicks connection on HomeScreen
  → getOrCreateWorkspaceForConnection(connectionId)
    ├── Found existing auto-workspace → reuse workspaceId
    └── No existing → create WorkspaceConfig (real UUID, autoCreated: true, named after connection)
  → windowManager.openWorkspace(workspaceId)
  → WorkspaceScreen mounts
  → workbenchStore.loadLayout(workspaceId) from IndexedDB
    ├── Found layout → full fidelity restore
    └── No layout → initializeLayout() (single empty panel)
  → tabStateStore loads per-tab state from IndexedDB
  → Connection established, sidebar populated
```

## Error Handling

### Connection Failure on Restore

- Layout and tabs restore regardless of connection status
- Tabs show error banner: "Connection unavailable — reconnect to interact"
- Query text, scroll, cursor all visible (read-only until reconnected)
- Reconnect action available in sidebar

### Stale Tab Data

- Table tabs: data re-fetched on reconnect (existing `dataInvalidationStore` behavior)
- Query tabs: text preserved, results not persisted (user re-runs when ready)

### Workspace Cleanup

- Auto-workspaces not opened in 90 days: shown in "Stale Workspaces" section with cleanup option
- No auto-deletion

## Home Screen Behavior

| Section | Shows |
|---------|-------|
| **Connections** | All saved connection profiles (unchanged). Clicking opens/creates auto-workspace invisibly |
| **Workspaces** | Only `autoCreated === false` workspaces — explicitly named by user |

## Files Affected

### Major Changes
- `src/stores/workbenchStore.ts` — persistence rewrite
- `src/stores/workspaceBundleStore.ts` — remove isTemporary, add auto-workspace, remove tabLayout from config
- `src/stores/tabStateStore.ts` — extend persisted state, migrate DB
- `src/components/Workbench/WorkbenchLayout.tsx` — switch from localStorage auto-save to IndexedDB
- `src/App.tsx` — startup behavior branching
- `src/types/workspace.ts` — add `autoCreated`, remove `tabLayout`, remove `isTemporary`

### Moderate Changes
- `src/screens/workspace/WorkspaceScreen.tsx` — revised init flow
- `src/screens/workspace/components/WorkspaceTitleBar.tsx` — remove isTemporary branching
- `src/screens/home/HomeScreen.tsx` — filter auto-workspaces from display
- `src/services/windowManager.ts` — save/restore window bounds
- `src/stores/preferencesStore.ts` — add startupBehavior preference

### New Files
- `src/lib/db/sessionDb.ts` — Dexie database definition for `query-pilot-sessions`
- `src/lib/db/sessionMigration.ts` — one-time migration from localStorage + old IndexedDB
