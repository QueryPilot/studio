# Central Table Editing Store Spec

## Background
- Each editing surface keeps its own local mutable state: structure columns `src/components/TableStructure/index.tsx:65`, indexes `src/components/TableIndexes/index.tsx:50`, triggers `src/components/TableTriggers/index.tsx:53`, and the table data grid `src/components/DataGridV2/adapters/TableDataGridV2.tsx:495`.
- Independent maps make it hard to present a unified “pending changes” count, force duplicated diff logic, and prevent cross-surface undo or discard.
- Switching tabs or connections wipes editing context because state is local to components, so users cannot stage a column change and a row insert together for later review.
- Workspace-level UX (status bar, AI helpers, future multi-window sync) cannot observe current edits because there is no central source of truth.

## Goals
- Maintain a single store that tracks all pending table edits keyed by connection, database, schema, and table.
- Provide O(1) lookups for UI panels to render staged data and compute diffs without reprocessing backend payloads.
- Enable a workspace status bar control that opens a global preview of staged work across all tables in the active connection.
- Support per-domain undo, discard, and commit preparation hooks while minimizing React re-renders through selector-based subscriptions.
- Expose derived metadata (dirty counts, last edited timestamps, SQL preview hints) so other features can build on the store.

## Non-Goals
- Rewriting backend mutation services (apply, rollback) beyond adapting their inputs to consume store payloads.
- Designing final visual treatments for the preview drawer; this spec anchors structure and data flows.
- Solving concurrent editing conflicts across multiple machines; we only reconcile within a single workspace session.

## Terminology
- Editing scope: `{ connectionId; database; schema; table }` uniquely identifies a table context.
- Domain: logical area inside a scope such as `structure`, `data`, `indexes`, `triggers`, and future `constraints`.
- Change record: normalized representation of an insert, update, delete, or toggle applied to a domain entity.

## Architecture Overview
### Store Module
Create `src/stores/tableEditStore.ts` exporting a Zustand store built with `immer` and `subscribeWithSelector` for fine-grained subscriptions. Use lazy initialization so scopes are only materialized when a panel starts editing.

````markdown
interface EditingScopeKey {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

type DomainKind = "structure" | "data" | "indexes" | "triggers" | "constraints";

type ScopeKeyString = `${string}::${string}::${string}::${string}`;

interface TableEditStoreState {
  scopes: Map<ScopeKeyString, ScopeState>;
  ensureScope: (key: EditingScopeKey) => ScopeState;
  setScopeMeta: (key: EditingScopeKey, meta: Partial<ScopeMeta>) => void;
  upsertChange: (args: UpsertChangeArgs) => void;
  removeChange: (args: RemoveChangeArgs) => void;
  discardDomain: (key: EditingScopeKey, domain: DomainKind) => void;
  discardScope: (key: EditingScopeKey) => void;
  discardAll: (connectionId: string) => void;
  getScopeSummary: (key: EditingScopeKey) => ScopeSummary;
  getConnectionSummary: (connectionId: string) => ConnectionSummary;
}
````

Use a helper `createScopeKey(editingScope)` that lowercases schema/table for consistent hashing. All store mutations operate on copies of `Map` objects to keep state immutable-friendly while still O(1).

### Scope State Layout
````markdown
interface ScopeState {
  meta: ScopeMeta;
  domains: {
    structure: StructureDomainState;
    data: DataDomainState;
    indexes: IndexDomainState;
    triggers: TriggerDomainState;
    constraints: ConstraintDomainState;
  };
  summary: ScopeSummary;
  lastTouchedAt: number;
}

interface ScopeMeta {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  displayName: string;
  primaryKey: string[];
  fetchedAt?: number;
}
````

`summary` keeps precomputed aggregates (`totalChanges`, `pendingInserts`, `pendingDrops`, per-domain dirty flags) updated inside store mutations so selectors can read without recomputing.

### Domain State Shapes
**Structure**
````markdown
interface StructureDomainState {
  editedColumns: Map<string, ColumnDraft>;
  newColumns: Map<string, ColumnDraft>;
  deletedColumns: Set<string>;
  orderDraft?: string[];
  hasDirtyComment: boolean;
}
````

`ColumnDraft` stores both original and draft values to support quick diffing and SQL emission. `orderDraft` tracks reordered columns for engines that support `ALTER TABLE ... ALTER COLUMN ... POSITION`.

**Data**
````markdown
interface DataDomainState {
  rowDrafts: Map<string, RowDraft>;
  optimisticPrimaryKeySeed: number;
  pendingUploadAttachments: Map<string, FileHandle>;
}
````

`RowDraft` keeps `action` (insert/update/delete), `originalRow`, `draftRow`, `cellDiffs`, and `touchedAt`. The store should reuse the existing diff helpers from the data grid by moving them into a shared util module and storing results instead of recomputing per render.

**Indexes**
````markdown
interface IndexDomainState {
  editedIndexes: Map<string, IndexDraft>;
  newIndexes: Map<string, IndexDraft>;
  deletedIndexes: Set<string>;
}
````

`IndexDraft` adds meta for generated names, operator class selections, and partial filter definitions so UI can surface warnings.

**Triggers**
````markdown
interface TriggerDomainState {
  editedTriggers: Map<string, TriggerDraft>;
  newTriggers: Map<string, TriggerDraft>;
  deletedTriggers: Set<string>;
  nextNameCounter: number;
}
````

Keep `nextNameCounter` as part of the scope to retain sequential naming when users bounce between tabs.

**Constraints (future)**
Stub structure to house check constraints, foreign keys, and policies once those panels migrate. This keeps the store extensible without API churn.

### Change Records
Introduce a normalized change payload to make summaries and SQL generation consistent.

````markdown
interface ChangeRecord<TDraft, TOriginal> {
  id: string;
  domain: DomainKind;
  kind: "insert" | "update" | "delete" | "toggle";
  draft: TDraft | null;
  original: TOriginal | null;
  diffKeys: string[];
  touchedBy: "structure" | "data" | "indexes" | "triggers" | "system";
  touchedAt: number;
}
````

Each domain maintains its own map of `ChangeRecord` IDs. Aggregations collate those records.

### Derived Selectors & Hooks
Provide selector helpers so components only re-render on relevant slices.

````markdown
export const useTableEditScope = (
  scope: EditingScopeKey,
  selector: (state: ScopeState) => Result,
  equalityFn?: (a: Result, b: Result) => boolean,
) => { ... };
````

Offer convenience hooks:

- `useTableEditStructure(scope)` returning `{ drafts, addDraft, removeDraft, generateDiff }`.
- `useTableEditData(scope)` bridging to the grid adapter, including `lockRow`, `enqueueBulkPaste`, `undo`.
- `useTableEditSummary(scope)` returning `ScopeSummary`.

Expose utilities for non-react code (services) to read the store.

### Undo & Redo Architecture
- Maintain per-scope `undoStack` and `redoStack` arrays storing immutable snapshots of `ChangeRecord` deltas rather than whole scope copies.
- Each stack entry captures `{ domain, changeId, previousDraft, nextDraft, appliedAt }` so we can replay or rollback granularly without recomputing diffs.
- Mutating APIs (`upsertChange`, `removeChange`, `discardDomain`, `setScopeMeta`) push entries onto the undo stack inside a transaction wrapper; when batching multiple mutations (e.g., bulk paste), consolidate into a single entry for better UX.
- Provide `performUndo(scope)` and `performRedo(scope)` helpers that adjust stacks and re-run summary recomputation; selectors receive debounced notifications to avoid flicker.
- Expose optional `beginMacro(scope)` / `endMacro(scope)` for UI flows (wizard edits) to group actions, mirroring command pattern semantics.
- Track `lastUndoableAt` timestamps to let UI disable undo if more than N minutes have elapsed (configurable).

### SQL Preview & Diff Experience
- Generate SQL statements per domain lazily using cached builders; cache keys include scope key, domain, changeId, and `diffKeys`.
- Store preview metadata alongside each `ChangeRecord` (`preview: { sql: string; generatedAt: number; warnings?: string[] }`) and invalidate when draft/original pairs change.
- Provide `getScopeSqlPreview(scope, { domains?, changes? })` returning aggregated SQL bundles sorted by dependency order (structure -> indexes -> triggers -> data).
- Implement text diff helpers using unified diff format (`@@`) so UI can render light/dark aware diffs; only compute diff when users open the preview to preserve performance.
- Integrate with `PendingEditsDrawer` to show domain tabs with side-by-side comparison (original value vs draft) and inline SQL snippet preview toggles.
- Surface warnings for destructive operations (e.g., dropping columns) directly in the diff view using severity badges.

### Optimistic Validation & Server Dry-Runs
- Define an optional `validateScope(scope)` pipeline that packages staged SQL into a transaction-wrapped dry-run (`BEGIN; ...; ROLLBACK;`) using the backend validator endpoint when available.
- Validation runs async with cancel support; the store records results under `ScopeState.summary.validation` as `{ status: 'pending' | 'passed' | 'failed', checkedAt, diagnostics[] }`.
- UI surfaces validation status in the preview drawer and status bar; failures link to detailed diagnostics, successes gatekeep the final apply CTA.
- Skip automatic validation for large data batches to avoid latency; instead, allow users to trigger it manually via `Validate Changes` button.
- All SQL previews remain available even without validation to preserve responsiveness.

### Performance Considerations
- Use Maps and Sets inside the store to keep updates O(1); selectors should convert to arrays lazily when needed by UI (e.g., virtualization).
- Avoid serializing big row drafts by storing references to base dataset IDs instead of entire row copies whenever possible.
- Memoize diff computations and cache generated SQL strings per change; invalidate only when draft/original pairs change.
- Throttle summary recomputation by batching multiple mutations inside `set((state) => { ... })` calls.

### Persistence & Hydration
- Persist store per scope in `localforage` or Tauri secure storage only when a user requests “Keep staged edits between restarts.” Default behaviour is in-memory.
- Maintain staged edits while the workspace window remains open, even if the connection temporarily disconnects; prompt users for confirmation before discarding via close or logout actions.
- Hydrate scope meta from `useWorkspaceScreenStore` active connection to ensure we discard edits when a connection closes.
- Emit `beforeunload` warnings if `totalChanges > 0`, offering `Discard & Leave` vs `Stay` options aligned with the confirmation UX.


### Metadata Change Reconciliation
- Subscribe to schema refresh events; when new metadata arrives, diff it against `ScopeState.meta` and current drafts.
- If the base object for a draft no longer exists (e.g., column dropped remotely), automatically purge related `ChangeRecord`s, log an audit entry, and notify users via toast/banner.
- When types or constraints change upstream, mark affected drafts as conflicted and request user review before applying; provide quick actions to accept new server state or restage edits.
- Update `ScopeMeta.fetchedAt` and store-level summaries after reconciliation so other components consume the fresh baseline.


## Workspace Preview & Status Bar
- Add a `PendingEditsIndicator` inside the future workspace status bar (see `workspace_screen.spec.md`) that subscribes to `getConnectionSummary(activeConnectionId)`.
- Indicator shows a badge with total pending changes, e.g., `● 7 edits`.
- Clicking opens `PendingEditsDrawer` (new component in `src/screens/workspace/components`) displaying tabs per domain with sortable tables of change records.
- Drawer actions: `Apply Selected`, `Discard Selected`, `Copy SQL`, and `Export Summary`.
- Provide keyboard shortcut (e.g., `Ctrl+Shift+P`) to open the drawer for power users.

## Migration Plan
- Phase 1: implement store and unit tests; add adapters for each domain while keeping existing local state as source of truth.
- Phase 2: migrate `TableDataGridV2` to write through store using a compatibility hook that mirrors updates into the old local state until we delete it.
- Phase 3: migrate `TableStructure`, `TableIndexes`, and `TableTriggers` by replacing their `useState` declarations with store selectors and by reading `drafts` for rendering.
- Phase 4: remove legacy state, enabling store-backed undo/discard actions, and connect workspace status bar preview.
- Phase 5: expand to other schema assets (constraints, policies) and integrate with apply services.

## Testing Strategy
- Add Vitest unit tests for `tableEditStore` covering ensureScope, upsertChange, summary recomputation, and discard pathways.
- Build integration tests for the data grid adapter verifying that typing a cell produces a `ChangeRecord` and that undo clears it.
- Use storybook or visual regression harness to validate the PendingEditsDrawer filters and counters.
- Add E2E coverage (Playwright) for the workflow: edit column + insert row + open preview + discard.

## Additional Opportunities
- Publish change events on an internal emitter so AI assistants, validation engines, or future collaboration features can react.
- Track dirty severity (low, medium, high) to surface potentially dangerous operations like dropping a column with data.
- Explore collaborative editing safeguards (lock notifications) for multi-window scenarios once single-user flow stabilizes.
- Investigate lightweight snapshots for cross-connection undo histories when users clone tables across databases.

## Open Questions
- How should we paginate and virtualize diff previews for tables with 10k+ row edits without overwhelming the UI?
- Do we need to batch undo/redo history across multiple tables when users perform global actions (e.g., rollback all staged changes)?
- What telemetry do we capture to measure the effectiveness of validation and diff workflows while respecting privacy?
