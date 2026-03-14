# MongoDB Collection Workbench Redesign

## Problem

The MongoDB collection workbench has significant design inconsistencies with the SQL table views and falls short of industry-standard MongoDB GUIs (Compass, Studio 3T, DataGrip). Specific issues:

1. **Tab bar** — MongoDB tabs lack icons; SQL tabs have icons + labels
2. **Index management** — Card-based form limited to 2 fields vs SQL's full DataGridBase with search, context menus, inline editing
3. **Structure view** — Simple tree of divs vs SQL's DataGridBase with custom cell renderers
4. **Missing features** — No Table/Tree/JSON view toggle, no per-stage aggregation preview, no visual schema analytics
5. **Code architecture** — 1,906-line monolith vs SQL's modular directory structure (TableStructure/, TableIndexes/, TableTriggers/)

## Approach

Consistency-first with Compass-inspired enhancements, executed together. Align all MongoDB views with existing SQL patterns (DataGridBase, module extraction, icon tabs), then layer on MongoDB-specific visual analytics (type bars, per-stage preview, explain tree).

## Design

### 1. Architecture — Module Extraction

Break the monolith `MongoCollectionWorkbench.tsx` (1,906 lines) into focused modules mirroring the SQL side:

**Current → New module mapping:**

| Current (inline in monolith) | New Module |
|-----|------|
| `MongoCollectionWorkbench` (main) | `MongoCollectionWorkbench/index.tsx` |
| `MongoStructureView` + `SchemaNodeView` + `StatCard` | `MongoStructure/` |
| `MongoIndexesView` | `MongoIndexes/` |
| `MongoAggregationView` | `MongoAggregation/` |
| `MongoValidationView` | `MongoValidation/` |
| `MongoExplainView` + `renderExplainNode` | `MongoExplain/` |

```
src/components/
  MongoCollectionWorkbench/
    index.tsx              (~120 lines, shell + tab routing)
  MongoStructure/
    index.tsx              (DataGridBase + schema analytics)
    columns.ts             (column definitions)
    SchemaFieldCell.tsx     (type bar custom cell renderer)
    utils.ts               (tree building, formatting, buildSchemaTree, etc.)
  MongoIndexes/
    index.tsx              (DataGridBase, inline add row)
    columns.ts             (column definitions)
    commandFactory.ts      (CRUD command builders: buildMongoCommand, normalizeIndexOptionsForCrud, etc.)
    IndexKeyCell.tsx        (tag-chip cell renderer for keys)
    IndexPropertiesCell.tsx (toggleable badge renderer)
  MongoAggregation/
    index.tsx              (pipeline builder layout)
    StageCard.tsx           (individual stage with editor + controls)
    StagePreview.tsx        (intermediate output panel)
    PipelineCodeView.tsx    (raw JSON array editor)
    utils.ts               (parseAggregationStages, DEFAULT_STAGE_TEMPLATES, etc.)
  MongoValidation/
    index.tsx              (CodeMirror editor + status panel)
  MongoExplain/
    index.tsx              (toolbar + stats + tree)
    ExplainTree.tsx         (visual node tree component)
    utils.ts               (getExplainSummary, etc.)
```

Utility functions (`toJsonValue`, `normalizeIndexOptionsForCrud`, `buildMongoCommand`, `parseAggregationStages`, etc.) move to respective module `utils.ts` files. Shared types stay in `src/types/mongoWorkbench.ts`.

### 2. Tab Bar — Icon Consistency

Add icons from `@tabler/icons-react` (same library as SQL tabs) to all MongoDB tab triggers:

| Tab | Icon | Notes |
|-----|------|-------|
| Data | `IconTable` | Same as SQL Data tab |
| Structure | `IconAssembly` | Same as SQL Structure tab |
| Indexes | `IconBookmark` | Same as SQL Indexes tab |
| Aggregation | `IconArrowsShuffle` | MongoDB-specific (verified in @tabler/icons-react) |
| Validation | `IconShieldCheck` | MongoDB-specific (verified: used in GlobalChangesDialog) |
| Explain | `IconFilter` | MongoDB-specific (verified: used in ExplainViewer) |

Tab bar styling aligns with SQL: `<div className="flex-none pb-1 pt-1.5 bg-background">` with same padding, same `Tabs/TabsList/TabsTrigger` components, same keyboard shortcut support (`enableShortcuts={true}`, `tabGroupId`). The 6 MongoDB tabs use the same `tabIndex` numbering (0-5) as the SQL tabs — no shortcut conflicts since tab groups are scoped by `tabGroupId`.

### 3. Data View — Three View Modes

Add a segmented control toggle in the Data tab toolbar: **Table | Tree | JSON**.

**Table mode** (default): Existing `DocumentDataGrid` — no changes needed. Already works well with drill-down, filtering, CRUD, inspector.

**Tree mode**: New `DocumentTreeView` component.
- Virtualized list of expandable document cards
- Each document is a collapsible card with an ObjectId header
- Nested objects/arrays expand inline with indentation
- BSON type color coding: string (green), objectId (purple), number (yellow), object (orange), array (amber), boolean (red), null (gray)
- Collapsed documents show a preview: `{ name: "Alice", email: "alice@..." }`

**JSON mode**: New `DocumentJsonView` component.
- Read-only CodeMirror instance with JSON language mode
- Renders all loaded documents as a JSON array
- Syntax highlighting, line numbers
- Reuses existing CodeMirror setup from the query editor

**Delegation mechanism**: `DocumentDataGrid` receives a `viewMode: "table" | "tree" | "json"` prop (default `"table"`). Internally, `DocumentDataGrid` always runs `useDocumentData` to fetch documents. When `viewMode` is `"table"`, it renders the existing `BaseDataGrid` as before. When `viewMode` is `"tree"` or `"json"`, it hides the grid (`display: none` to preserve grid state) and renders `DocumentTreeView` or `DocumentJsonView` as a sibling, passing the raw `documents` array from `useDocumentData`. The filter bar, pagination, quick filter, and CRUD toolbar remain part of `DocumentDataGrid` and are always visible regardless of view mode — only the content area below switches.

The view mode toggle (segmented control) renders inside `DocumentDataGrid`'s toolbar area, next to the existing quick filter.

The view mode preference persists per-tab in `workbenchState.dataViewMode` (type: `"table" | "tree" | "json"`, default: `"table"`).

### 4. Structure View — DataGrid + Type Bars

Replace the tree-of-divs with a DataGridBase-powered schema view.

**Columns:**

| Column | Renderer | Description |
|--------|----------|-------------|
| Field | Custom: monospace name + `required` badge + expand/collapse arrow for objects | Tree-grid with indentation for nested fields |
| Type Distribution | Custom: color-segmented horizontal bar | Compass-inspired type bar showing proportion of each BSON type |
| Present % | Text | Percentage of sampled documents containing this field |
| Null % | Text | Percentage of present values that are null |
| Sample Values | Text | Up to 3 sample values, truncated |
| Validator | Text/Badge | Validator-defined bsonType for this field |

**Type colors** (consistent across the entire MongoDB workbench):
- `string`: #4ade80 (green)
- `int32`/`double`/`long`: #60a5fa (blue)
- `objectId`: #a78bfa (purple)
- `object`: #f97316 (orange)
- `array`: #fbbf24 (amber)
- `boolean`: #f87171 (red)
- `date`: #ec4899 (pink)
- `null`: #888888 (gray)

**Tree-grid behavior** (flatten-on-expand approach): The DataGridBase does not natively support tree-grid rows. Instead, the schema data is flattened into a row array. Object/array fields include an expand/collapse arrow rendered in the `SchemaFieldCell`. When a user clicks expand, the component inserts child field rows into the flat array at the correct position (with increased `depth` metadata for indentation). When collapsed, those child rows are removed. The `depth` value drives left padding in the Field cell. This is the same technique used by tree-table implementations on top of flat grids — no modifications to `DataGridBase` or Glide Data Grid internals needed. Expand state is local (not persisted).

**Toolbar**: Sample size input, max depth input, Refresh button. Stats cards (Docs Sampled, Fields, Validator) display inline in the toolbar area.

**Multi-type fields**: When a field has multiple observed types (e.g., `age` is 85% int32, 15% string), the type bar shows stacked colored segments proportional to occurrence. The type label lists all types.

### 5. Index Management — DataGridBase + Inline Add

Replace card-based list and inline form with a DataGridBase grid matching SQL's `TableIndexes`.

**Columns:**

| Column | Renderer | Description |
|--------|----------|-------------|
| Name | Custom: monospace, `staged` badge for new rows | Index name, editable for new rows |
| Keys | Custom: tag-style chips | Each key as a chip: `fieldName: 1` / `fieldName: -1` / `fieldName: text` with remove (x) button. `+` button to add keys via inline popover |
| Properties | Custom: toggleable badges | `unique`, `sparse`, `TTL Ns` badges. For new rows, clickable to toggle. TTL shows seconds input when enabled |
| Usage | Text | Usage count from `$indexStats` |
| Size | Text | Index size from collection stats |
| Actions | Custom | "Drop" / "Unstage" action links |

**Inline creation flow and crudStore interaction:**
1. Click `+ Add Index` in toolbar → appends a new editable row at the bottom (green left border highlight). This row is **local-only UI state** (managed via `useState` in the MongoIndexes component), not yet in crudStore.
2. Name cell auto-focuses with text input.
3. Keys cell: click `+` to open inline popover (field name input + direction select: Asc/Desc/Text + Add button). Each key added appears as a removable chip. Supports N-key compound indexes.
4. Properties cell: click badge labels to toggle on/off. TTL opens a small seconds input.
5. When the row has a valid name and at least one key, it is **automatically staged** to `crudStore` via `stageCommand()` with type `"document.index.create"` (same command type as current implementation). The row remains visible in the grid with a `staged` badge and green highlight.
6. Click "Unstage" to remove from crudStore and delete the row. Click "Apply Changes" in the status bar to execute all staged commands.

Note: This differs from SQL's `TableIndexes` which uses a review dialog. The MongoDB side renders staged rows visually in the grid for a more inline experience, consistent with how the current `MongoIndexesView` stages commands. The underlying crudStore flow (`stageCommand` / `unstageCommand` / `Apply Changes`) is identical.

**Toolbar**: Search input (filters by name), `+ Add Index` button, `Refresh` button. Status bar at bottom: `N indexes | M staged` with `Apply Changes` / `Discard` buttons (using `TableActionsToolbar` pattern from SQL side).

**Context menu** (right-click row): Copy index name, Copy key spec, Stage Drop, View details.

**Key add popover**: Small popover anchored to the `+` button in the Keys cell. Contains: field name text input, direction selector (Asc 1 / Desc -1 / Text), and Add button. Closes after adding.

### 6. Aggregation Pipeline Builder — Cards + Per-Stage Preview

Replace textarea-based stages with a card-based pipeline builder inspired by Compass.

**Layout**: Horizontal two-panel split — stage cards on the left, preview panel on the right.

**Stage cards** (left panel):
- Each stage is a card with:
  - Drag handle (grip dots) for reordering
  - Stage type label with color coding: `$match` (green), `$group` (purple), `$sort` (amber), `$project` (blue), `$limit` (red), `$unwind` (orange), `$lookup` (pink)
  - Stage number badge
  - Enable/disable toggle switch (disabled stages are skipped in execution but retained in the pipeline)
  - Delete button (x)
  - CodeMirror editor (JSON mode) for the stage body — replaces plain textareas
- Card footer shows per-stage output summary: doc count + execution time (populated after running)

**Per-stage preview** (right panel):
- Click any stage card to see its intermediate output
- Runs the pipeline up to and including the selected stage via `MongoDBAdapter.aggregate()`
- Preview area has its own Table/JSON toggle (reuses `MongoResultViewer`)
- Header shows: "Stage N Output" + stage type + doc count
- Preview auto-updates when the selected stage's content changes (debounced 500ms). In-flight requests are cancelled via `AbortController` when new input arrives. If the aggregate call fails, the preview panel shows the error message inline (same error styling as existing: `border-destructive/30 bg-destructive/5 text-destructive`).

**Toolbar**:
- Stage template buttons: `+ $match`, `+ $group`, `+ $sort`, `+ $project`, `+ $limit`, `+ More...` (dropdown for $unwind, $lookup, $addFields, $bucket, $facet, etc.)
- Visual / Code toggle: switches between card view and single CodeMirror editor showing the full pipeline as a JSON array
- Run button: executes the full pipeline, shows final results in the preview panel
- Explain button: navigates to Explain tab with `explainSource: "aggregation"`

**Drag-and-drop reordering**: Uses `@dnd-kit/core` and `@dnd-kit/sortable` (already installed in the project). Wrap stage cards in `SortableContext` with `verticalListSortingStrategy`. Each `StageCard` uses `useSortable()` for the drag handle.

**State persistence**: Stage content persists in `workbenchState.aggregationStages[]` as before. New fields added to `MongoWorkbenchState`:
- `aggregationStageEnabled: boolean[]` — per-stage enable/disable state
- `aggregationViewMode: "visual" | "code"` — Visual/Code toggle preference (default: `"visual"`)

### 7. Validation View — CodeMirror + Status Panel

Replace textarea with proper editor and add a status side panel.

**Layout**: Two-panel — CodeMirror editor (left, takes most space), current server status panel (right, ~280px fixed).

**Editor** (left):
- CodeMirror with JSON language mode, line numbers, syntax highlighting
- Same CodeMirror configuration as query editors
- Replaces the plain textarea

**Status panel** (right):
- Shows current server state (read from `getCollectionMetadata()`):
  - Status indicator: "Validator attached" (green) or "No validator" (gray)
  - Current validation level
  - Current validation action
  - Parsed required fields as badges

**Toolbar**: Level dropdown, Action dropdown, `Stage Update` button, `Refresh` button. Same staged CRUD pattern — `Stage Update` adds to crudStore, `Apply` executes.

### 8. Explain View — Visual Node Tree + Stats

Replace nested divs with a proper visual execution tree.

**Layout**: Toolbar → Stats bar → Execution tree (scrollable).

**Stats bar**: Horizontal row of stat cards under the toolbar:
- Winning Stage (color-coded: green for IXSCAN, red for COLLSCAN)
- Docs Returned
- Docs Examined (yellow if > returned, indicating inefficiency)
- Keys Examined
- Execution Time (green if < 100ms, yellow < 1000ms, red > 1000ms)

**Execution tree** (`ExplainTree` component):
- Visual node tree with connecting lines between parent/child stages
- Each node is a rounded card showing:
  - Stage name (FETCH, IXSCAN, COLLSCAN, etc.) — color-coded
  - Doc count / key count
  - Key details: index name, bounds, filter expression, direction
- Node colors: green (IXSCAN, FETCH), blue (SORT, PROJECTION), red (COLLSCAN), purple (GROUP, UNWIND)
- Connecting lines with arrows between parent → child nodes

**Toolbar**: Run Explain button, Source selector (Current Data Query / Aggregation Draft), Visual / Raw JSON toggle.

**Raw JSON view**: Toggle to see the full raw explain output in a CodeMirror instance (read-only, JSON mode). Same as current but with syntax highlighting.

## Error Handling

All views follow the existing error pattern from the current monolith: `const [error, setError] = useState<string | null>(null)` with try/catch around async operations. Error display uses the established styling: `<div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>`. Loading states use `<Loader2 className="animate-spin" />` (from lucide-react, already used throughout the app). No new error patterns introduced.

## Backend Changes

No backend changes required. All features use existing `MongoDBAdapter` methods:
- `findDocuments()` / `findDocumentsPage()` — Data view (all modes)
- `sampleCollectionSchema()` — Structure view
- `listIndexes()` / `getIndexUsageStats()` / `createIndex()` / `dropIndex()` — Indexes view
- `aggregate()` — Aggregation view (including per-stage preview via partial pipeline)
- `getCollectionMetadata()` / `updateCollectionValidation()` — Validation view
- `explainCollectionOperation()` — Explain view

The per-stage preview feature works by running `aggregate()` with only the first N stages of the pipeline (slicing the array). No new backend endpoint needed.

## Component Reuse

| New Component | Reuses From |
|---------------|-------------|
| MongoStructure DataGrid | `DataGridBase` (same as SQL's TableStructure) |
| MongoIndexes DataGrid | `DataGridBase` (same as SQL's TableIndexes) |
| MongoIndexes Toolbar | `TableActionsToolbar` (shared component) |
| MongoIndexes Delete Confirm | `ConfirmDeleteDialog` (shared component) |
| Aggregation CodeMirror editors | Existing CodeMirror setup from query panels |
| Validation CodeMirror editor | Existing CodeMirror setup from query panels |
| Explain Raw JSON | CodeMirror read-only instance |
| Aggregation Result Viewer | `MongoResultViewer` (existing) |
| Tab bar | `Tabs/TabsList/TabsTrigger` (shadcn/ui, same as SQL) |

## New Components

| Component | Purpose |
|-----------|---------|
| `DocumentTreeView` | Tree-mode document viewer with expandable cards |
| `DocumentJsonView` | JSON-mode document viewer using CodeMirror |
| `SchemaFieldCell` | Custom DataGrid cell renderer for type distribution bars |
| `IndexKeyCell` | Custom DataGrid cell renderer for tag-style key chips |
| `IndexPropertiesCell` | Custom DataGrid cell renderer for toggleable property badges |
| `StageCard` | Aggregation stage card with editor, controls, and output summary |
| `StagePreview` | Right panel showing per-stage intermediate output |
| `PipelineCodeView` | Full-pipeline JSON editor (Code mode) |
| `ExplainTree` | Visual execution plan node tree |

## Files Modified

- `src/components/MongoCollectionWorkbench.tsx` → Deleted, replaced by `MongoCollectionWorkbench/index.tsx`
- `src/components/__tests__/MongoCollectionWorkbench.test.tsx` → Update import paths from old monolith to new module structure
- `src/components/Workbench/PanelContentRenderer.tsx` → Import path update only
- `src/types/mongoWorkbench.ts` → Add fields to `MongoWorkbenchState`: `dataViewMode: "table" | "tree" | "json"` (default `"table"`), `aggregationStageEnabled: boolean[]`, `aggregationViewMode: "visual" | "code"` (default `"visual"`)
- `src/components/DataGrid/adapters/DocumentDataGrid.tsx` → Add `viewMode` prop, render toggle in toolbar, conditionally render TreeView/JsonView as sibling to hidden grid

## Files Created

- `src/components/MongoCollectionWorkbench/index.tsx`
- `src/components/MongoStructure/index.tsx`
- `src/components/MongoStructure/columns.ts`
- `src/components/MongoStructure/SchemaFieldCell.tsx`
- `src/components/MongoStructure/utils.ts`
- `src/components/MongoIndexes/index.tsx`
- `src/components/MongoIndexes/columns.ts`
- `src/components/MongoIndexes/commandFactory.ts`
- `src/components/MongoIndexes/IndexKeyCell.tsx`
- `src/components/MongoIndexes/IndexPropertiesCell.tsx`
- `src/components/MongoAggregation/index.tsx`
- `src/components/MongoAggregation/StageCard.tsx`
- `src/components/MongoAggregation/StagePreview.tsx`
- `src/components/MongoAggregation/PipelineCodeView.tsx`
- `src/components/MongoAggregation/utils.ts`
- `src/components/MongoValidation/index.tsx`
- `src/components/MongoExplain/index.tsx`
- `src/components/MongoExplain/ExplainTree.tsx`
- `src/components/MongoExplain/utils.ts`
- `src/components/DataGrid/components/DocumentTreeView.tsx`
- `src/components/DataGrid/components/DocumentJsonView.tsx`
