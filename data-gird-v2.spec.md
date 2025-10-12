# Data Grid v2 Refactor Plan

## Background
The current `src/components/DataGrid` implementation grew organically around two entry points (`GlideTableDataGrid` and `GlideQueryDataGrid`). Each wrapper composes a monolithic `EnhancedGlideWrapper` that mixes rendering, data fetching concerns, hover affordances, formatting, copy/paste handlers, selection tracking, and ad-hoc persistence. This coupling makes the grid hard to reuse outside the current table/query views, blocks cell editing workflows, and complicates new UX requests such as pinned rows, paste-to-add, or scroll state persistence.

## Pain Points Observed in v1
- **Impure component contract**: `GlideTableDataGrid` reads from hooks (`useTableDataQuery`) and mutates state internally, so parents cannot control rows, selection, or scroll offsets.
- **Leaky responsibilities**: `EnhancedGlideWrapper` owns theming, hover toolbars, editing overlays, column state, copy/paste, and infinite scroll side effects in one 900+ line file, increasing regression risk.
- **Editing disabled**: All generated cells are `readonly`, custom editors exist but are not wired. `onCellEdited` never fires, so upstream cannot be notified of changes.
- **Row add/remove not supported**: No trailing row configuration or append callbacks; paste-based inserts are not handled. New-row UX cannot be implemented without large rewrites.
- **Column personalization missing**: Resize, hide, reorder logic logs to console only. No persistence layer keeps user preferences.
- **State resets on navigation**: Selection, scroll offset, column widths/order are recalculated whenever parents re-render or route changes.
- **Loading UX fragmented**: Infinite scroll logic lives in `GlideTableDataGrid` while query grid lacks streaming awareness. Skeleton vs. spinner usage is inconsistent.
- **Hover actions tightly coupled**: Copy-on-hover logic is entangled with editor overlays, making it hard to keep while simplifying the component composition.

## Goals and Requirements
- Deliver a **pure, reusable data grid component** that accepts props for columns, rows, counts, and callbacks, enabling use in both Table view and Query results.
- **Respect existing type contracts** (`ColumnMeta`, `TableDataRow`, `CellValue`) while allowing lightweight column definitions for ad-hoc queries.
- **Cell editing support** with editors from Glide examples, emitting `onCellEditStart`, `onCellEditCommit`, and `onCellEditCancel` events and providing optimistic update hooks.
- **Row add/remove** flows: add-on-top button, paste-to-create, deletion via callbacks (`onRowAppend`, `onRowInsert`, `onRowDelete`).
- Maintain **accurate rendering** for all supported database cell types and existing custom renderers.
- Preserve **hover action buttons** (copy, open, etc.) with easier extensibility.
- Support **infinite loading**, skeleton placeholders while fetching additional pages, and a deterministic strategy for `estimatedTotal`.
- Enforce **auto width fill** behavior when total column width is smaller than the viewport while keeping per-column resizing.
- Allow **pinning up to 5 columns** and **up to 10 rows**, exposing controlled props and persistence hooks.
- **Persist scroll offsets, selection, and edit-in-progress state** across tab switches (controlled scroll + selection state).
- **Copy modes**: default Cmd/Ctrl+C copies visible selection; Cmd/Ctrl+Shift+C copies selected rows as JSON.
- **Clipboard paste** adds or updates cells/rows following Glide paste demo patterns.
- Provide **column hide/show, reorder, resize** UI with persisted preferences keyed by context (e.g., table signature or query hash).
- Highlight **row hover** consistently with existing theme while keeping selection intact.
- Offer **infinite streaming compatibility** with the unified `useTableDataQuery` hook without locking the grid to that implementation.
- Remain **pure and composable** so multiple grids can render side-by-side (split panes) without state collisions.

## Proposed Architecture

### Layered Component Structure
1. **`DataGridBase`** (pure, headless view): Thin wrapper around `DataEditor` providing controlled props for
   - `columns: GridColumnV2[]`
   - `rows: number`
   - `getCellContent`, `onCellEdited`, `onRowAppended`, `onPaste`, `onVisibleRegionChanged`, `onSelectionChange`, etc.
   - Controlled state for selection (`selection`, `onSelectionChange`), scroll (`scrollState`, `onScroll`), pinned columns/rows, trailing row options, and undo stacks.
2. **`DataGridBehaviors` utilities**: Hooks for
   - Hover affordances (`useHoverActions`)
   - Clipboard bridge (`useClipboardBridge`) with copy-mode differentiation
   - Paste parsing (`usePasteHandler`) that can emit unlimited rows
   - Column sizing/persistence (`useColumnSizing`, `useColumnPinning`, `useColumnVisibility`)
   - Scroll/selection persistence (`useGridViewState`)
   - Undo/redo management (`useGridHistory`)
3. **`DataGridView`** (UI composition): Composes `DataGridBase` with skeleton loaders, status bar, hover overlays, pinned indicators, and empty/error states. Receives data + behavior hooks from parents.
4. **Adapters**:
   - `TableDataGridV2`: Adapts `TableDataRow[]` and `ColumnMeta[]` via `useInfiniteTableData` while keeping the grid pure by passing rows, columns, and callbacks via props. Uses primary key fingerprints where available.
   - `QueryDataGridV2`: Adapts ad-hoc query results with minimal metadata, synthesizing stable row ids and column definitions. Shares the same base component.

### Type Model Alignment
- Define `GridColumnV2` aligned with Glide `GridColumn` plus metadata pointer back to `ColumnMeta`, sizing constraints, and persistence identifiers.
- Introduce a shared `GridRowModel` describing `Record<string, CellValue>` rows. Query adapters map raw arrays into this model, attaching synthetic row keys.
- Provide selectors for metadata-driven editors (enum, foreign key, json, etc.) using existing custom renderers.

### Event & Callback Contract
Expose callbacks through props so parent layers/stores coordinate persistence:
- `onColumnsChange({ order, hidden, widths, pinned })`
- `onEditStart`, `onEditCommit`, `onEditCancel`, `onUndo`, `onRedo`
- `onRowAppend(position, draftRow)`, `onRowInsert(index, rows)`, `onRowDelete(rowIds)`
- `onRequestMore(range)` for infinite scroll (parent decides when to fetch)
- `onCopy`, `onPaste`, `onSelectionChange`
- `onViewportPersist({ scrollTop, scrollLeft })`
- `onPinnedChange({ columns, rows })`

### State Persistence Strategy
- Use a `useDataGridPreferencesStore` built with Zustand + IndexedDB persistence (via `idb-keyval` or similar) keyed by `gridId` (connectionId+database+schema+table or query hash). IndexedDB offers safer storage for larger payloads than `localStorage` and avoids synchronous main-thread blocking when multiple grids persist concurrently.
- Keep per-grid namespaces so multiple tabs or split panes can render simultaneously without clobbering each other. Store snapshot includes column order, widths, hidden set, pinned sets, scroll offsets, selection, and undo stacks. Grid instances subscribe to their own `gridId` slice.
- Implement hydration guards so a grid waits for its persisted slice before applying layout-sensitive state (column widths, scroll).

### Hover & Action UI
- Extract hover action rendering into a lightweight overlay fed by `useHoverActions` (positioning + actions). Keep existing icons (copy, open, etc.) and allow custom actions per grid context.
- Ensure hover overlay respects pinned columns/rows by clamping to viewport bounds and offsetting for frozen areas.

## Feature Implementation Plans

### Editing & Row Operations
- Enable editors via Glide `provideEditor` using existing custom editor components and the “small editable grid” example as reference.
- Implement optimistic editing by updating local row models before firing `onEditCommit`. Parents can accept, reject, or enqueue undo stack entries.
- Configure `trailingRowOptions` with `rowAppSrc: "top"` so the “Add Row” affordance inserts at the top. Callbacks surface draft rows to parent/state.
- Support paste-driven inserts with no artificial limits. When pasted content extends beyond existing rows, emit `onRowInsert` with the full payload; parent decides how many to persist.
- Add row deletion via Delete/Backspace keybindings and contextual action menu. Feed both paths through the same callback for consistency.
- Provide built-in undo/redo stacks for edits and row operations, exposed through keyboard shortcuts and menu actions.

### Infinite Loading & Skeletons
- Keep `onVisibleRegionChanged` to signal parents when scroll nears the buffered end; parents (e.g., `TableDataGridV2`) call `loadMore`.
- Expose `loadingState` flags (`initializing`, `appending`, `error`, `endReached`) to drive skeleton, spinner, and status bar messaging.
- Render skeleton rows (using existing `DataGridSkeleton`) that match row height whenever `loadingState.appending` is true.

### Column Personalization
- Manage column widths/order/visibility via controlled state driven by the preferences store. Persist only diffs to reduce IndexedDB churn.
- Auto-fill width: when total width < viewport, distribute remaining width across flexible columns while respecting min/max widths and pinned columns.
- Add column header menu for hide/show and pin/unpin with a max of five pinned columns enforced in the pinning hook.

### Pinned Columns & Rows
- Provide controlled `pinnedColumns`/`pinnedRows` arrays (max lengths validated). For table data, use concatenated primary key values; for query results, use synthetic row ids (row index + query hash) to keep selections stable during refetches.
- Use Glide `freezeColumns` for pinned columns and emulate row pinning via viewport offsets if Glide lacks native support beyond trailing freeze.
- Update pinned rows when data mutates, ensuring the store reconciles with new row order (especially after inserts on top).

### Selection, Copy & Paste
- Track `gridSelection` via controlled prop so selection persists across remounts and split panes. Synchronize with undo stack when edits revert selection.
- Implement `onCopy` handler: generate TSV for standard copy. Detect Cmd/Ctrl+Shift+C to emit JSON array of selected rows (using raw `TableDataRow`/synthetic model) before writing to clipboard.
- Maintain compatibility with existing `useCopy` toast feedback but keep it optional so pure grid can run without global hooks.

### Scroll & View State Persistence
- Listen to `onScroll`/`onVisibleRegionChanged` to capture offsets, update store, and restore them via controlled props (`initialScrollOffset`, `preserveFocus`). Each grid instance isolates its scroll state by `gridId`, enabling multiple open grids to maintain unique offsets simultaneously.
- Persist active cell and inline editor metadata so returning to a tab resumes editing when safe (if parent has not replaced the row).

### Loading Modes
- Provide `DataGridView` wrapper that chooses between skeleton, empty, error, and grid states. Keep `DataGridStatusBar` but supply it with props rather than internal counters so adapters remain pure.

### Integration Strategy
1. **Scaffold**: Create `DataGridV2` folder structure, define types (`GridColumnV2`, `GridRowModel`, `DataGridViewState`, callback interfaces), and port Glide wrapper with a pure API.
2. **Behavior hooks**: Re-implement hover actions, clipboard, paste, column sizing, pinning, undo stack, and persistence as dedicated hooks with unit coverage where feasible.
3. **Editing pipeline**: Wire custom editors, `onCellEdited`, trailing-row add-on-top, bulk paste, row delete, and undo/redo. Validate against Glide “small editable grid” sample behavior.
4. **Persistence layer**: Add Zustand store with IndexedDB persistence, include hydration guards, and smoke test simultaneous grids in split view.
5. **Loading integration**: Support skeleton rows, infinite scroll trigger, streaming updates, and status bar interop. Ensure `useTableDataQuery` adapter pushes props and responds to `onRequestMore`.
6. **Query adapter & parity**: Replace `GlideQueryDataGrid` with new adapter, ensuring copy/paste, column personalization, selection persistence, and synthetic row id logic work for ad-hoc results.
7. **Rollout**: Convert Table/Query consumers to v2, keep v1 behind feature flag, run regression tests, remove dead code post-stabilization, and update docs/tests.

## Detailed Implementation Checklist

### Stage 1 – Core Scaffold
- [x] Create `src/components/DataGridV2/` with index exports and folder skeleton (`base`, `hooks`, `adapters`, `stores`, `types`, `overlays`).
- [x] Define shared TypeScript types (`GridColumnV2`, `GridRowModel`, `GridCallbacks`, `GridViewState`).
- [x] Port minimal `DataGridBase` around Glide `DataEditor` with controlled props and no side effects.
- [x] Verify `GridRowModel` aligns with `TableDataRow = Record<string, CellValue>` from the Tauri stream so table data passes through without conversion.

### Stage 2 – Behavior Hooks
- [x] Implement `useHoverActions` with positioning math that respects frozen columns/rows and existing action icons.
- [x] Build `useClipboardBridge` handling standard copy plus Cmd/Ctrl+Shift+C JSON export, wired to customizable toasts.
- [x] Implement `usePasteHandler` supporting unlimited row inserts, TSV parsing, and cell updates with callback emission.
- [x] Create `useColumnSizing`, `useColumnPinning`, and `useColumnVisibility` hooks enforcing width minimums and pin caps.
- [x] Add `useGridHistory` for undo/redo stacks, integrating with edit/row operations.

### Stage 3 – Editing & Row Operations
- [x] Integrate custom editors via Glide `provideEditor`; support enum, lookup, boolean, date/time, and JSON editors.
- [x] Enable optimistic edit flow emitting `onEditStart`/`onEditCommit`/`onEditCancel` callbacks.
- [x] Configure trailing row add-on-top (`rowAppSrc: "top"`) and surface `onRowAppend` drafts to the parent.
- [x] Implement row deletion via Delete/Backspace shortcuts and contextual menu action, hooking into undo stack.
- [x] Support paste-to-create rows and cell updates with validation feedback from parent callbacks.

### Stage 4 – Persistence & Concurrency
- [x] Stand up Zustand store keyed by `gridId`, isolating state per grid instance.
- [x] Back store with IndexedDB persistence (e.g., `idb-keyval`) to handle large column-layout payloads.
- [x] Persist column order/widths/visibility, pinned columns/rows, selection, scroll offsets, and edit drafts.
- [x] Add hydration guard so grid waits for persisted state before measuring columns/scroll.
- [x] Verify multiple concurrent grids (split panes) maintain independent state slices without collisions.

### Stage 5 – Data Adapters & Loading UX
- [x] Build `TableDataGridV2` adapter that consumes `useTableDataQuery`, maps rows via primary keys, and wires infinite scroll callbacks.
- [x] Build `QueryDataGridV2` adapter that maps query arrays to synthetic row models and reuses grid behaviors.
- [x] Implement skeleton loading rows and status bar messaging driven by adapter `loadingState` props.
- [x] Surface `onRequestMore` triggers when viewport nears loaded range, respecting estimated totals.
- [x] Ensure table adapter forwards backend `CellValue` objects directly (no deep cloning) and only wraps query results when necessary.

### Stage 6 – QA & Rollout
- [ ] Create Storybook/Playroom demos covering editing, pinning, paste, hover actions, undo/redo, and infinite scrolling.
- [ ] Add unit tests for behavior hooks (clipboard, paste parsing, persistence selectors, undo stack).
- [ ] Update integration tests (React or end-to-end) to cover adding/editing rows, column personalization, and copy/paste modes.
- [x] Migrate Table and Query screens to v2, optionally guarded by feature flag for phased rollout.
- [ ] Remove legacy v1 components once parity confirmed; update docs/ADR references.

## Resolved Decisions
- **Row identifiers**: Table grids use concatenated primary key values (fallback to stable hashes when PK missing); query grids use synthetic row ids (row index + query signature).
- **Preference storage**: Persist grid preferences via Zustand+IndexedDB for resilience, async access, and large payload support.
- **Row deletion UX**: Support both keyboard shortcuts and contextual menu actions; operations feed undo/redo stacks exposed through standard shortcuts.
- **Paste limits**: No hard cap—pastes can introduce unlimited rows. Parent adapters own enforcement if needed.
- **Concurrency**: Design the Zustand store to support multiple concurrent grid instances (e.g., split panes) by isolating state per `gridId` and avoiding shared mutable singletons.
