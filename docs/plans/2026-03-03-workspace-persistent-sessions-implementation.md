# Workspace-First Persistent Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full-fidelity session restore — layout, tabs, queries, scroll, cursor — persisted to IndexedDB, with workspace-first mental model where every connection auto-creates a workspace.

**Architecture:** Consolidate all session persistence from localStorage to a single Dexie IndexedDB database (`query-pilot-sessions`). Remove `isTemporary` from workspaces — every connection open creates/reopens an auto-workspace. Add configurable startup behavior (restore previous session vs start at home screen).

**Tech Stack:** Dexie.js (IndexedDB), Zustand, React 19, Tauri 2, TypeScript

**Design doc:** `docs/plans/2026-03-03-workspace-persistent-sessions-design.md`

**Key reference docs:**
- `docs/llm-context/frontend-patterns.md` — Zustand patterns, store conventions
- `docs/llm-context/testing.md` — test setup, vitest conventions
- `docs/llm-context/architecture-overview.md` — system architecture

---

## Phase 1: Foundation — New Database & Types

### Task 1: Create Session Database

**Files:**
- Create: `src/lib/db/sessionDb.ts`
- Test: `src/lib/db/__tests__/sessionDb.test.ts`

**Step 1: Write the failing test**

Create `src/lib/db/__tests__/sessionDb.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";

// Will fail until sessionDb.ts exists
import {
  getSessionDatabase,
  type PersistedWorkspaceLayout,
  type PersistedAppState,
} from "../sessionDb";

describe("SessionDatabase", () => {
  beforeEach(async () => {
    // Clean up before each test
    await Dexie.delete("query-pilot-sessions");
  });

  afterEach(async () => {
    await Dexie.delete("query-pilot-sessions");
  });

  it("should create database with three tables", async () => {
    const db = getSessionDatabase();
    expect(db.workspaceLayouts).toBeDefined();
    expect(db.tabStates).toBeDefined();
    expect(db.appState).toBeDefined();
  });

  it("should persist and load workspace layout", async () => {
    const db = getSessionDatabase();
    const layout: PersistedWorkspaceLayout = {
      workspaceId: "ws-1",
      layoutTree: { id: "panel-1", type: "leaf" },
      panelContents: [["panel-1", { id: "panel-1", type: "editor", tabIds: ["tab-1"], activeTabId: "tab-1", metadata: {} }]],
      savedAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    await db.workspaceLayouts.put(layout);
    const loaded = await db.workspaceLayouts.get("ws-1");
    expect(loaded).toEqual(layout);
  });

  it("should persist and load app state", async () => {
    const db = getSessionDatabase();
    const appState: PersistedAppState = {
      key: "singleton",
      lastActiveWorkspaceIds: ["ws-1", "ws-2"],
      windowStates: [
        { workspaceId: "ws-1", windowBounds: { x: 0, y: 0, width: 1200, height: 800 } },
      ],
      migrationVersion: 1,
    };

    await db.appState.put(appState);
    const loaded = await db.appState.get("singleton");
    expect(loaded).toEqual(appState);
  });

  it("should return same instance on multiple calls", () => {
    const db1 = getSessionDatabase();
    const db2 = getSessionDatabase();
    expect(db1).toBe(db2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/db/__tests__/sessionDb.test.ts`
Expected: FAIL — cannot find module `../sessionDb`

**Step 3: Write the implementation**

Create `src/lib/db/sessionDb.ts`:

```ts
import Dexie, { type Table } from "dexie";
import type { GridNode, PanelContent } from "@/types/workbench";

export interface PersistedWorkspaceLayout {
  workspaceId: string;
  layoutTree: GridNode;
  panelContents: Array<[string, PanelContent]>;
  savedAt: number;
  lastActiveAt: number;
}

export interface PersistedAppState {
  key: string; // always "singleton"
  lastActiveWorkspaceIds: string[];
  windowStates: Array<{
    workspaceId: string;
    windowBounds?: { x: number; y: number; width: number; height: number };
  }>;
  migrationVersion: number;
}

class SessionDatabase extends Dexie {
  workspaceLayouts!: Table<PersistedWorkspaceLayout, string>;
  tabStates!: Table<import("./tabState").PersistedTabState, string>;
  appState!: Table<PersistedAppState, string>;

  constructor() {
    super("query-pilot-sessions");
    this.version(1).stores({
      workspaceLayouts: "&workspaceId",
      tabStates: "&tabId",
      appState: "&key",
    });
  }
}

const isClient = typeof window !== "undefined";
let dbInstance: SessionDatabase | null = null;

export function getSessionDatabase(): SessionDatabase {
  if (!isClient) {
    throw new Error("SessionDatabase can only be used in browser environment");
  }
  if (!dbInstance) {
    dbInstance = new SessionDatabase();
  }
  return dbInstance;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/db/__tests__/sessionDb.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/db/sessionDb.ts src/lib/db/__tests__/sessionDb.test.ts
git commit -m "feat(session): create IndexedDB session database with Dexie"
```

---

### Task 2: Update Type Definitions

**Files:**
- Modify: `src/types/workspace.ts`

**Step 1: Add `autoCreated` to `WorkspaceConfig`**

In `src/types/workspace.ts`, add `autoCreated` field to `WorkspaceConfig`:

```ts
autoCreated?: boolean;
```

Add it near the other config fields (after `tags`).

**Step 2: Remove `isTemporary` from `ActiveWorkspace`**

In `src/types/workspace.ts`, remove `isTemporary: boolean` from the `ActiveWorkspace` interface.

**Step 3: Remove `tabLayout` from `WorkspaceConfig`**

Remove the top-level `tabLayout` field from `WorkspaceConfig`. Also remove `tabLayout` from the `connectionStates` value type.

Note: Do NOT remove these yet if doing so causes cascading type errors in other files. Instead, mark them as `@deprecated` with `TODO: remove in next task` comments. The store changes in Phase 2 will clean up the usages.

Actually, the safest approach: make `tabLayout` optional (it likely already is with `?`), and mark as deprecated. Remove usages in Task 5 (workspaceBundleStore). Then come back and remove the type fields after all usages are gone.

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (or existing pre-existing errors only — no new errors from our changes)

**Step 5: Commit**

```bash
git add src/types/workspace.ts
git commit -m "feat(workspace): add autoCreated flag, deprecate tabLayout and isTemporary"
```

---

## Phase 2: Store Changes

### Task 3: Add Startup Behavior Preference

**Files:**
- Modify: `src/stores/preferencesStore.ts`

**Step 1: Add `startupBehavior` to the preferences store**

In `src/stores/preferencesStore.ts`:

1. Add to the state interface:
```ts
startupBehavior: "restore" | "home";
setStartupBehavior: (behavior: "restore" | "home") => void;
```

2. Add to the initial state:
```ts
startupBehavior: "restore",
setStartupBehavior: (behavior) => set({ startupBehavior: behavior }),
```

3. Add to the `partialize` function so it persists:
```ts
partialize: (state) => ({
  telemetry: state.telemetry,
  queryTimeoutSecs: state.queryTimeoutSecs,
  startupBehavior: state.startupBehavior,
}),
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/stores/preferencesStore.ts
git commit -m "feat(preferences): add startupBehavior setting (restore/home)"
```

---

### Task 4: Rewrite workbenchStore Persistence

**Files:**
- Modify: `src/stores/workbenchStore.ts`
- Test: `src/stores/__tests__/workbenchStore.test.ts`

This is the largest task. It replaces localStorage-based `saveConnectionLayout`/`restoreConnectionLayout` with IndexedDB-based `persistLayout`/`loadLayout`.

**Step 1: Write failing tests for new persistence methods**

Add to `src/stores/__tests__/workbenchStore.test.ts`:

```ts
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { getSessionDatabase } from "@/lib/db/sessionDb";

// Add to describe block or create new describe("workbenchStore persistence", ...)

describe("workbenchStore IndexedDB persistence", () => {
  beforeEach(async () => {
    await Dexie.delete("query-pilot-sessions");
    const store = useWorkbenchStore.getState();
    store.initializeLayout();
  });

  afterEach(async () => {
    await Dexie.delete("query-pilot-sessions");
  });

  it("persistLayout should save layout to IndexedDB", async () => {
    const store = useWorkbenchStore.getState();
    // Initialize a layout with a tab
    store.initializeLayout();
    const panelId = store.layoutTree!.id;
    store.addTab(panelId, "tab-1", { title: "Test", type: "query" });

    await store.persistLayout("ws-test");

    const db = getSessionDatabase();
    const saved = await db.workspaceLayouts.get("ws-test");
    expect(saved).toBeDefined();
    expect(saved!.layoutTree).toBeDefined();
    expect(saved!.panelContents.length).toBeGreaterThan(0);
  });

  it("loadLayout should restore layout from IndexedDB", async () => {
    const store = useWorkbenchStore.getState();
    store.initializeLayout();
    const panelId = store.layoutTree!.id;
    store.addTab(panelId, "tab-1", { title: "Test", type: "query" });

    await store.persistLayout("ws-test");

    // Reset state
    store.initializeLayout();
    expect(store.panelContents.get(panelId)?.tabIds).not.toContain("tab-1");

    // Restore
    const restored = await store.loadLayout("ws-test");
    expect(restored).toBe(true);
    expect(store.layoutTree).toBeDefined();
    // Check that tab-1 is back
    const contents = Array.from(store.panelContents.values());
    const allTabIds = contents.flatMap((c) => c.tabIds);
    expect(allTabIds).toContain("tab-1");
  });

  it("loadLayout should return false when no saved layout exists", async () => {
    const store = useWorkbenchStore.getState();
    const restored = await store.loadLayout("nonexistent");
    expect(restored).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/stores/__tests__/workbenchStore.test.ts`
Expected: FAIL — `persistLayout` and `loadLayout` do not exist

**Step 3: Implement `persistLayout` and `loadLayout`**

In `src/stores/workbenchStore.ts`:

1. Import the session database:
```ts
import { getSessionDatabase } from "@/lib/db/sessionDb";
```

2. Add to the `WorkbenchStore` interface:
```ts
persistLayout: (workspaceId: string) => Promise<void>;
loadLayout: (workspaceId: string) => Promise<boolean>;
flushLayout: (workspaceId: string) => void; // sync flush for unmount
```

3. Add internal debounce state (outside the store, module-level):
```ts
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWorkspaceId: string | null = null;
```

4. Implement in the store:
```ts
persistLayout: async (workspaceId) => {
  const { layoutTree, panelContents } = get();
  if (!layoutTree) return;

  try {
    const db = getSessionDatabase();
    await db.workspaceLayouts.put({
      workspaceId,
      layoutTree,
      panelContents: Array.from(panelContents.entries()),
      savedAt: Date.now(),
      lastActiveAt: Date.now(),
    });
  } catch (error) {
    console.error("[workbenchStore] Failed to persist layout:", error);
  }
},

loadLayout: async (workspaceId) => {
  try {
    const db = getSessionDatabase();
    const saved = await db.workspaceLayouts.get(workspaceId);
    if (!saved?.layoutTree) return false;

    const panelContentsMap = new Map(saved.panelContents);

    // Validate panel IDs match between tree and map
    const leafIds = new Set<string>();
    const collectLeafIds = (node: GridNode) => {
      if (node.type === "leaf") leafIds.add(node.id);
      else node.children?.forEach(collectLeafIds);
    };
    collectLeafIds(saved.layoutTree);

    // Only restore if at least some panels match
    if (leafIds.size === 0) return false;

    set({
      layoutTree: saved.layoutTree,
      panelContents: panelContentsMap,
      layoutHistory: [saved.layoutTree],
      historyIndex: 0,
    });

    // Focus first panel
    const firstPanelId = Array.from(panelContentsMap.keys())[0];
    if (firstPanelId) {
      usePanelFocusStore.getState().focusPanel(firstPanelId);
    }

    return true;
  } catch (error) {
    console.error("[workbenchStore] Failed to load layout:", error);
    return false;
  }
},

flushLayout: (workspaceId) => {
  // Cancel pending debounce and persist synchronously via fire-and-forget
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  // Fire and forget — best effort on unmount
  get().persistLayout(workspaceId);
},
```

**Step 4: Keep old methods temporarily**

Do NOT remove `saveConnectionLayout`/`restoreConnectionLayout` yet. They'll be removed in Phase 3 when `WorkbenchLayout.tsx` switches to the new methods. This prevents breaking the app during incremental changes.

**Step 5: Run tests**

Run: `pnpm vitest run src/stores/__tests__/workbenchStore.test.ts`
Expected: PASS

**Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 7: Commit**

```bash
git add src/stores/workbenchStore.ts src/stores/__tests__/workbenchStore.test.ts
git commit -m "feat(workbench): add IndexedDB-based persistLayout and loadLayout"
```

---

### Task 5: Rewrite workspaceBundleStore — Auto-Workspace & Remove isTemporary

**Files:**
- Modify: `src/stores/workspaceBundleStore.ts`
- Modify: `src/types/workspace.ts` (final cleanup)

This task has several sub-changes. Do them incrementally.

**Step 1: Add `getOrCreateWorkspaceForConnection`**

In `src/stores/workspaceBundleStore.ts`, add a new method:

```ts
getOrCreateWorkspaceForConnection: async (connectionId: string): Promise<WorkspaceConfig> => {
  const { savedWorkspaces } = get();

  // Check for existing auto-workspace for this connection
  const existing = savedWorkspaces.find(
    (ws) => ws.autoCreated && ws.connectionIds.length === 1 && ws.connectionIds[0] === connectionId
  );
  if (existing) return existing;

  // Create new auto-workspace
  const profile = useConnectionStoreNew.getState().getConnection(connectionId);
  const now = new Date().toISOString();
  const config: WorkspaceConfig = {
    id: crypto.randomUUID(),
    name: profile?.name ?? "Untitled",
    autoCreated: true,
    connectionIds: [connectionId],
    connectionStates: {},
    createdAt: now,
    updatedAt: now,
  };

  // Persist to vault
  await vaultStorage.saveWorkspace(config);
  set((state) => ({
    savedWorkspaces: [...state.savedWorkspaces, config],
  }));

  return config;
},
```

**Step 2: Rewrite `openSingleConnection` to use auto-workspaces**

Replace the temp workspace creation logic. Instead of:
```ts
const config: WorkspaceConfig = { id: `temp-${connectionId}`, ... };
```
Change to:
```ts
const config = await get().getOrCreateWorkspaceForConnection(connectionId);
```

Remove `isTemporary: true` from the `ActiveWorkspace` creation. Remove the `isTemporary` field entirely.

The rest of the method (connecting, setting focusedConnectionId) stays the same.

For layout restore, replace `restoreConnectionLayout(config.id)` with:
```ts
const workbenchState = useWorkbenchStore.getState();
await workbenchState.loadLayout(config.id);
```

**Step 3: Remove `tabLayout` from `saveCurrentWorkspace` and `saveAsNewWorkspace`**

In `saveCurrentWorkspace`: remove the lines that capture `workbenchStore.layoutTree` into `config.tabLayout`. The layout auto-persists to IndexedDB now — the vault config only needs name, connections, connectionStates.

In `saveAsNewWorkspace`: same removal. Also set `autoCreated: false` since this is an explicit save.

**Step 4: Remove `tabLayout` fallback from `openWorkspace`**

In the `openWorkspace` method, replace the layout restore logic:
```ts
// OLD:
const restoredScopedLayout = workbenchState.restoreConnectionLayout(config.id);
if (!restoredScopedLayout && config.tabLayout) { ... }

// NEW:
const restored = await workbenchState.loadLayout(config.id);
if (!restored) {
  workbenchState.initializeLayout();
}
```

**Step 5: Remove `isTemporary` from everywhere**

Search for `isTemporary` across the codebase and remove all usages:
- `workspaceBundleStore.ts`: remove from `openSingleConnection`, `addConnectionToWorkspace` guard, `saveCurrentWorkspace` guard
- `workspace.ts`: remove from `ActiveWorkspace` interface (already done in Task 2 if not deferred)

For `addConnectionToWorkspace`: remove the `!isTemporary` guard — auto-save should work for all workspaces. When a second connection is added to an auto-workspace, also set `autoCreated: false` (promoting it to a named workspace).

For `saveCurrentWorkspace`: remove the early return on `isTemporary`. All workspaces can be saved now.

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: There will be errors from files still referencing `isTemporary` — fix each one:
- `WorkspaceTitleBar.tsx` — replace `isTemporary` checks with `autoCreated` checks or remove the branching (Task 9 in Phase 3 will handle this, so for now use `activeWorkspace?.config.autoCreated` as a drop-in replacement)
- Any other files that reference `isTemporary`

**Step 7: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 8: Commit**

```bash
git add src/stores/workspaceBundleStore.ts src/types/workspace.ts
git commit -m "feat(workspace): auto-workspace creation, remove isTemporary, IndexedDB layout restore"
```

---

### Task 6: Extend Tab State Persistence

**Files:**
- Modify: `src/lib/db/tabState.ts`
- Modify: `src/stores/tabStateStore.ts`

**Step 1: Extend `PersistedTabState` in `tabState.ts`**

Add new optional fields to the `PersistedTabState` interface:

```ts
export interface PersistedTabState {
  tabId: string;
  query: string;
  lastExecutedQuery: string;
  viewMode: ViewMode;
  selectedDialect?: SqlDialect | "auto";
  tableViewType?: string;
  // New fields for full-fidelity restore
  scrollPosition?: { top: number; left: number };
  editorCursorPosition?: { line: number; ch: number };
  gridColumnWidths?: Record<string, number>;
  pinnedResultQuery?: string | null;
}
```

**Step 2: Add new fields to persistable fields list in `tabStateStore.ts`**

In `setQueryState`, find the `persistableFields` array and add the new fields:

```ts
const persistableFields: (keyof PersistedTabState)[] = [
  "query", "lastExecutedQuery", "viewMode", "selectedDialect", "tableViewType",
  "scrollPosition", "editorCursorPosition", "gridColumnWidths", "pinnedResultQuery",
];
```

**Step 3: Add the new fields to `QueryState` interface if not already present**

In `tabStateStore.ts`, ensure `QueryState` has the new fields so they can be set via `setQueryState`:

```ts
// Add to QueryState interface if missing:
scrollPosition?: { top: number; left: number };
editorCursorPosition?: { line: number; ch: number };
gridColumnWidths?: Record<string, number>;
```

Note: `pinnedResultQuery` likely already exists in `QueryState`.

**Step 4: Consider separate debounce for scroll/column fields**

The design calls for 1000ms debounce for scroll and column widths (vs 500ms for query text). If the current debounce mechanism is per-tab (single timer per tabId), the simplest approach is to keep a single 500ms timer. The 1000ms optimization can be deferred — it's a performance refinement, not correctness.

For now, leave the existing 500ms debounce. Add a `TODO` comment:
```ts
// TODO: Consider separate 1000ms debounce for scrollPosition and gridColumnWidths
```

**Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/db/tabState.ts src/stores/tabStateStore.ts
git commit -m "feat(tabState): extend persisted state with scroll, cursor, column widths"
```

---

## Phase 3: UI Updates

### Task 7: Update WorkbenchLayout.tsx — Switch to IndexedDB Persistence

**Files:**
- Modify: `src/components/Workbench/WorkbenchLayout.tsx`

**Step 1: Replace store selectors**

Change imports from `saveConnectionLayout`/`restoreConnectionLayout` to `persistLayout`/`loadLayout`/`flushLayout`:

```ts
const persistLayout = useWorkbenchStore((s) => s.persistLayout);
const loadLayout = useWorkbenchStore((s) => s.loadLayout);
const flushLayout = useWorkbenchStore((s) => s.flushLayout);
```

**Step 2: Replace layout initialization effect**

Replace the `restoreConnectionLayout` call with async `loadLayout`:

```ts
useEffect(() => {
  if (!layoutScopeId) {
    if (layoutTree) {
      set({ layoutTree: null, panelContents: new Map() }); // or just return
    }
    return;
  }
  if (initializedScopeRef.current === layoutScopeId) return;

  initializedScopeRef.current = layoutScopeId;

  // Async load from IndexedDB
  loadLayout(layoutScopeId).then((restored) => {
    if (!restored) {
      initializeLayout();
    }
  });
}, [layoutScopeId, loadLayout, initializeLayout]);
```

**Step 3: Replace debounced auto-save**

Replace `saveConnectionLayout` with `persistLayout` and increase debounce to 500ms:

```ts
useEffect(() => {
  if (!layoutScopeId || !layoutTree) return;

  if (saveDebounceTimerRef.current) {
    clearTimeout(saveDebounceTimerRef.current);
  }

  saveDebounceTimerRef.current = setTimeout(() => {
    persistLayout(layoutScopeId);
  }, 500);

  return () => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }
  };
}, [layoutScopeId, layoutTree, panelContents, persistLayout]);
```

**Step 4: Replace unmount flush**

Replace the sync `saveConnectionLayout` on unmount with `flushLayout`:

```ts
useEffect(() => {
  return () => {
    const scopeId = latestScopeRef.current;
    if (scopeId && hasLayoutRef.current) {
      flushLayout(scopeId);
    }
  };
}, [flushLayout]);
```

**Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/Workbench/WorkbenchLayout.tsx
git commit -m "feat(workbench): switch layout persistence from localStorage to IndexedDB"
```

---

### Task 8: Update WorkspaceScreen.tsx

**Files:**
- Modify: `src/screens/workspace/WorkspaceScreen.tsx`

**Step 1: Update `persistWorkbenchLayout` callback**

Find the `persistWorkbenchLayout` function (or equivalent save-on-close logic) and replace `saveConnectionLayout` with `persistLayout`:

```ts
// Replace localStorage persistence with IndexedDB
const workbenchState = useWorkbenchStore.getState();
await workbenchState.persistLayout(persistenceScopeId);
```

**Step 2: Remove any `isTemporary` references**

Search for `isTemporary` in this file and replace with appropriate logic:
- If used for display: replace with `activeWorkspace?.config.autoCreated`
- If used as a persistence gate: remove the gate (all workspaces persist now)

**Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/screens/workspace/WorkspaceScreen.tsx
git commit -m "feat(workspace): update WorkspaceScreen to use IndexedDB persistence"
```

---

### Task 9: Update WorkspaceTitleBar.tsx — Remove isTemporary Branching

**Files:**
- Modify: `src/screens/workspace/components/WorkspaceTitleBar.tsx`

**Step 1: Find and replace all `isTemporary` references**

This file has several `isTemporary` checks for display logic. Replace them:

1. **Document title** — replace `isTemporary` check with `autoCreated`:
   - Named workspace: show workspace name in title
   - Auto-created workspace: show connection/database name (same behavior as old temp)

2. **Title bar center section** — same replacement:
   - `isTemporary` → `activeWorkspace?.config.autoCreated`

3. **Font styling** — same replacement for `font-medium` vs `text-muted-foreground`

4. **`handleGoHome`** — replace `saveConnectionLayout` with `persistLayout`:
```ts
await useWorkbenchStore.getState().persistLayout(persistenceScopeId);
```

**Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add src/screens/workspace/components/WorkspaceTitleBar.tsx
git commit -m "refactor(titlebar): replace isTemporary with autoCreated"
```

---

### Task 10: Filter Auto-Workspaces from HomeScreen

**Files:**
- Modify: `src/screens/home/components/MainContent/WorkspacesSection.tsx`

**Step 1: Add filter for auto-created workspaces**

Find the workspace list rendering (where `savedWorkspaces` is sorted) and add a filter:

```ts
const sortedWorkspaces = [...savedWorkspaces]
  .filter((ws) => !ws.autoCreated)
  .sort((a, b) => { /* existing sort logic */ });
```

**Step 2: Update the "no workspaces" empty state if needed**

If the empty state message says "No workspaces created" or similar, ensure it still shows when all workspaces are auto-created (filtered out).

**Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/screens/home/components/MainContent/WorkspacesSection.tsx
git commit -m "feat(home): filter auto-created workspaces from home screen"
```

---

## Phase 4: Startup & Restore

### Task 11: App Startup Behavior Branching

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/services/windowManager.ts`

**Step 1: Add session restore logic to App.tsx**

After vault initialization completes (after `setVaultReady(true)` in the `isMainWindow` block), add startup behavior branching:

```ts
// After vault is ready, check startup behavior
const startupBehavior = usePreferencesStore.getState().startupBehavior;
if (startupBehavior === "restore") {
  try {
    const db = getSessionDatabase();
    const appState = await db.appState.get("singleton");
    if (appState?.lastActiveWorkspaceIds?.length) {
      // Load saved workspaces first
      await useWorkspaceBundleStore.getState().loadSavedWorkspaces();

      // Restore each workspace window
      for (const workspaceId of appState.lastActiveWorkspaceIds) {
        const bounds = appState.windowStates?.find(
          (w) => w.workspaceId === workspaceId
        )?.windowBounds;
        await windowManager.openNamedWorkspace(workspaceId, { bounds });
      }
      // Don't show home screen — workspace windows are opening
      return;
    }
  } catch (error) {
    console.error("[App] Failed to restore session:", error);
    // Fall through to home screen
  }
}
setVaultReady(true); // Show home screen as fallback
```

Note: The exact placement depends on the async flow in `registerWindowHandlers`. The key is: after vault is ready, before showing the home screen, check if we should restore.

**Step 2: Track active workspace IDs on window lifecycle**

In `windowManager.ts`, when a workspace window opens, update the `appState` in IndexedDB:

```ts
// After successfully creating a workspace window:
async function trackWorkspaceWindow(workspaceId: string, bounds?: WindowBounds) {
  try {
    const db = getSessionDatabase();
    const current = await db.appState.get("singleton");
    const lastActiveWorkspaceIds = current?.lastActiveWorkspaceIds ?? [];
    const windowStates = current?.windowStates ?? [];

    if (!lastActiveWorkspaceIds.includes(workspaceId)) {
      lastActiveWorkspaceIds.push(workspaceId);
    }

    // Update or add window state
    const existingIdx = windowStates.findIndex((w) => w.workspaceId === workspaceId);
    const windowState = { workspaceId, windowBounds: bounds };
    if (existingIdx >= 0) {
      windowStates[existingIdx] = windowState;
    } else {
      windowStates.push(windowState);
    }

    await db.appState.put({
      key: "singleton",
      lastActiveWorkspaceIds,
      windowStates,
      migrationVersion: current?.migrationVersion ?? 0,
    });
  } catch (error) {
    console.error("[windowManager] Failed to track workspace window:", error);
  }
}
```

**Step 3: Remove workspace from tracking on window close**

In the `destroyed` event handler for workspace windows:

```ts
async function untrackWorkspaceWindow(workspaceId: string) {
  try {
    const db = getSessionDatabase();
    const current = await db.appState.get("singleton");
    if (!current) return;

    await db.appState.put({
      ...current,
      lastActiveWorkspaceIds: current.lastActiveWorkspaceIds.filter((id) => id !== workspaceId),
      windowStates: current.windowStates.filter((w) => w.workspaceId !== workspaceId),
    });
  } catch (error) {
    console.error("[windowManager] Failed to untrack workspace window:", error);
  }
}
```

**Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx src/services/windowManager.ts
git commit -m "feat(startup): add configurable session restore on app launch"
```

---

### Task 12: Window Bounds Tracking

**Files:**
- Modify: `src/services/windowManager.ts`

**Step 1: Capture window bounds on close**

Before a workspace window closes (in the `onCloseRequested` handler or the `destroyed` handler), capture its position and size:

```ts
// In Tauri, get current window position/size:
import { currentWindow } from "@tauri-apps/api/window";

async function captureWindowBounds(): Promise<WindowBounds | undefined> {
  try {
    const position = await currentWindow.outerPosition();
    const size = await currentWindow.outerSize();
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  } catch {
    return undefined;
  }
}
```

Call this before destroying the window and pass bounds to `untrackWorkspaceWindow` (or a separate update).

**Step 2: Apply bounds on window restore**

In `openNamedWorkspace`, if `bounds` are provided, set the window position and size:

```ts
// When creating the WebviewWindow:
const webview = new WebviewWindow(label, {
  url,
  title,
  width: bounds?.width ?? 1200,
  height: bounds?.height ?? 800,
  x: bounds?.x,
  y: bounds?.y,
  // ... other options
});
```

**Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/services/windowManager.ts
git commit -m "feat(window): track and restore window bounds across sessions"
```

---

## Phase 5: Migration & Cleanup

### Task 13: Migration from localStorage + Old IndexedDB

**Files:**
- Create: `src/lib/db/sessionMigration.ts`
- Modify: `src/main.tsx` (add migration call)

**Step 1: Create migration module**

Create `src/lib/db/sessionMigration.ts`:

```ts
import Dexie from "dexie";
import { getSessionDatabase, type PersistedWorkspaceLayout } from "./sessionDb";
import type { GridNode, PanelContent } from "@/types/workbench";

const MIGRATION_VERSION = 1;

export async function runSessionMigration(): Promise<void> {
  const db = getSessionDatabase();

  // Check if already migrated
  const appState = await db.appState.get("singleton");
  if (appState && appState.migrationVersion >= MIGRATION_VERSION) return;

  console.log("[migration] Starting session data migration v" + MIGRATION_VERSION);

  // 1. Migrate layout data from localStorage
  await migrateLayoutsFromLocalStorage(db);

  // 2. Migrate tab state from old IndexedDB
  await migrateTabStatesFromOldDb(db);

  // 3. Mark migration complete
  await db.appState.put({
    key: "singleton",
    lastActiveWorkspaceIds: appState?.lastActiveWorkspaceIds ?? [],
    windowStates: appState?.windowStates ?? [],
    migrationVersion: MIGRATION_VERSION,
  });

  console.log("[migration] Session data migration complete");
}

async function migrateLayoutsFromLocalStorage(db: ReturnType<typeof getSessionDatabase>): Promise<void> {
  const keysToMigrate: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("workbench-connection-")) {
      keysToMigrate.push(key);
    }
  }

  for (const key of keysToMigrate) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const data = JSON.parse(raw) as {
        layoutTree: GridNode;
        panelContents: Array<[string, PanelContent]>;
        savedAt?: number;
      };

      // Extract workspace/connection ID from key
      const scopeId = key.replace("workbench-connection-", "");

      const layout: PersistedWorkspaceLayout = {
        workspaceId: scopeId,
        layoutTree: data.layoutTree,
        panelContents: data.panelContents,
        savedAt: data.savedAt ?? Date.now(),
        lastActiveAt: Date.now(),
      };

      await db.workspaceLayouts.put(layout);
      console.log(`[migration] Migrated layout for scope: ${scopeId}`);
    } catch (error) {
      console.warn(`[migration] Failed to migrate layout key ${key}:`, error);
    }
  }
}

async function migrateTabStatesFromOldDb(db: ReturnType<typeof getSessionDatabase>): Promise<void> {
  try {
    // Check if old DB exists
    const oldDbExists = (await Dexie.getDatabaseNames()).includes("query-pilot-tab-state");
    if (!oldDbExists) return;

    const oldDb = new Dexie("query-pilot-tab-state");
    oldDb.version(1).stores({ tabStates: "&tabId" });
    await oldDb.open();

    const oldStates = await (oldDb.table("tabStates") as Dexie.Table).toArray();

    if (oldStates.length > 0) {
      await db.tabStates.bulkPut(oldStates);
      console.log(`[migration] Migrated ${oldStates.length} tab states from old DB`);
    }

    oldDb.close();
  } catch (error) {
    console.warn("[migration] Failed to migrate tab states from old DB:", error);
  }
}
```

**Step 2: Call migration on app startup**

In `src/main.tsx`, add the migration call after the existing `initialize()`:

```ts
import { runSessionMigration } from "@/lib/db/sessionMigration";

// After useTabStateStore.getState().initialize():
runSessionMigration().catch((error) => {
  console.error("[main] Session migration failed:", error);
});
```

**Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/db/sessionMigration.ts src/main.tsx
git commit -m "feat(migration): migrate session data from localStorage to IndexedDB"
```

---

### Task 14: Remove Old localStorage Persistence Methods

**Files:**
- Modify: `src/stores/workbenchStore.ts`

**Step 1: Remove deprecated methods**

Now that all callers use `persistLayout`/`loadLayout`, remove:
- `saveConnectionLayout` method and interface declaration
- `restoreConnectionLayout` method and interface declaration
- `saveLayout` / `restoreLayout` backup methods
- Any remaining `localStorage` references for layout persistence

**Step 2: Clean up old localStorage keys**

Add a cleanup function that removes old keys (called after successful migration):

```ts
function cleanupOldLocalStorageKeys() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("workbench-connection-") || key?.startsWith("workbench-layout-backup-")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
```

Call this from the migration module after successful migration (not immediately — wait one version cycle as noted in design doc, or call it in the migration if we're confident).

**Step 3: Run all tests**

Run: `pnpm test:unit`
Expected: PASS (fix any tests that relied on old methods)

**Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/workbenchStore.ts src/lib/db/sessionMigration.ts
git commit -m "refactor(workbench): remove deprecated localStorage persistence methods"
```

---

### Task 15: Remove `tabLayout` from WorkspaceConfig & Cleanup isTemporary References

**Files:**
- Modify: `src/types/workspace.ts`
- Modify: any remaining files referencing `tabLayout` or `isTemporary`

**Step 1: Remove `tabLayout` from `WorkspaceConfig` interface**

Remove the `tabLayout` field and the `connectionStates[].tabLayout` field entirely.

**Step 2: Search and fix remaining references**

Run: `pnpm typecheck` to find all remaining references. Fix each one.

Common places:
- `CommandPalette/NestedConnectionList.tsx` — `isTemporary` check
- `CommandPalette/NestedDatabaseList.tsx` — `isTemporary` check
- Any test files

**Step 3: Run full test suite**

Run: `pnpm test:unit`
Expected: PASS

**Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(workspace): remove deprecated tabLayout and isTemporary fields"
```

---

## Phase 6: Integration Testing

### Task 16: Manual Integration Testing Checklist

This is a manual verification task. Run the dev server and test:

**Start dev server:**
```bash
make dev
```

**Test scenarios:**

1. **New connection open**: Click a connection → workspace opens → verify a UUID-based workspace is created (not `temp-*`)
2. **Tab persistence**: Open tables, write queries → close window → reopen connection → verify all tabs restored
3. **Layout persistence**: Split panels, resize → close → reopen → verify layout matches
4. **Query text persistence**: Write SQL in editor → close → reopen → verify text is there
5. **Cross-restart persistence**: Quit the app entirely → relaunch → verify restore behavior matches preference
6. **Home screen clean**: Verify auto-workspaces don't appear in workspace list
7. **Named workspace**: Create a workspace explicitly → verify it appears on home screen
8. **Startup preference**: Toggle between "restore" and "home" → verify behavior changes
9. **Multi-connection workspace**: Add second connection to workspace → verify both connections' tabs coexist
10. **Error recovery**: Disconnect network → relaunch → verify layout restores even if connection fails

---

## Summary of All Files Changed

| File | Change Type |
|------|------------|
| `src/lib/db/sessionDb.ts` | **NEW** — Dexie database definition |
| `src/lib/db/sessionMigration.ts` | **NEW** — migration logic |
| `src/lib/db/__tests__/sessionDb.test.ts` | **NEW** — database tests |
| `src/lib/db/tabState.ts` | **MODIFY** — extend `PersistedTabState` |
| `src/types/workspace.ts` | **MODIFY** — add `autoCreated`, remove `isTemporary`, remove `tabLayout` |
| `src/stores/workbenchStore.ts` | **MODIFY** — add `persistLayout`/`loadLayout`, remove localStorage methods |
| `src/stores/__tests__/workbenchStore.test.ts` | **MODIFY** — add IndexedDB persistence tests |
| `src/stores/workspaceBundleStore.ts` | **MODIFY** — auto-workspace, remove `isTemporary`, remove `tabLayout` capture |
| `src/stores/tabStateStore.ts` | **MODIFY** — extend persistable fields |
| `src/stores/preferencesStore.ts` | **MODIFY** — add `startupBehavior` |
| `src/components/Workbench/WorkbenchLayout.tsx` | **MODIFY** — switch to IndexedDB persistence |
| `src/screens/workspace/WorkspaceScreen.tsx` | **MODIFY** — update persistence calls |
| `src/screens/workspace/components/WorkspaceTitleBar.tsx` | **MODIFY** — replace `isTemporary` with `autoCreated` |
| `src/screens/home/components/MainContent/WorkspacesSection.tsx` | **MODIFY** — filter auto-created workspaces |
| `src/App.tsx` | **MODIFY** — startup behavior branching |
| `src/services/windowManager.ts` | **MODIFY** — window bounds tracking, session restore |
| `src/main.tsx` | **MODIFY** — add migration call |
