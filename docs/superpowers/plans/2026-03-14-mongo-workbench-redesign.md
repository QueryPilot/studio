# MongoDB Collection Workbench Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the MongoDB collection workbench to match SQL table view consistency and add Compass-inspired enhancements (3-mode data view, visual schema analytics, per-stage aggregation preview, visual explain tree).

**Architecture:** Extract the 1,906-line monolith `MongoCollectionWorkbench.tsx` into 6 focused module directories mirroring SQL patterns (`MongoStructure/`, `MongoIndexes/`, `MongoAggregation/`, `MongoValidation/`, `MongoExplain/`). Each view uses `DataGridBase` or CodeMirror where the SQL side does, with MongoDB-specific custom cell renderers for type bars, key chips, and toggleable badges.

**Tech Stack:** React 19, Zustand, shadcn/ui, Tailwind, Glide Data Grid (`DataGridBase`), CodeMirror (`@uiw/react-codemirror`), `@dnd-kit/sortable`, `@tabler/icons-react`

**Spec:** `docs/superpowers/specs/2026-03-14-mongo-collection-workbench-redesign.md`

---

## Chunk 1: Foundation — Types, Shell, Tab Bar

### Task 1: Update MongoWorkbenchState Types

**Files:**
- Modify: `src/types/mongoWorkbench.ts`

- [ ] **Step 1: Add new fields to MongoWorkbenchState**

Add three new fields to the interface and defaults:

```typescript
// In MongoWorkbenchState interface, add:
dataViewMode?: "table" | "tree" | "json";
aggregationStageEnabled?: boolean[];
aggregationViewMode?: "visual" | "code";

// In DEFAULT_MONGO_WORKBENCH_STATE, add:
dataViewMode: "table",
aggregationStageEnabled: [],
aggregationViewMode: "visual",
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (new optional fields don't break existing consumers)

- [ ] **Step 3: Commit**

```bash
git add src/types/mongoWorkbench.ts
git commit -m "feat(mongo): add dataViewMode, aggregationStageEnabled, aggregationViewMode to MongoWorkbenchState"
```

### Task 2: Create MongoCollectionWorkbench Shell Module

**Files:**
- Create: `src/components/MongoCollectionWorkbench/index.tsx`
- Delete: `src/components/MongoCollectionWorkbench.tsx` (old monolith)
- Modify: `src/components/Workbench/PanelContentRenderer.tsx` (import path)

This task extracts ONLY the main `MongoCollectionWorkbench` component (the tab routing shell at lines 1688-1906 of the monolith) into the new module. The 6 sub-views remain as temporary inline imports from a compat file until their own modules are built.

- [ ] **Step 1: Create the new module directory and shell**

Create `src/components/MongoCollectionWorkbench/index.tsx`. This is the ~120-line tab routing shell. Copy the `MongoCollectionWorkbench` component (lines 1688-1906 from the monolith) and its direct dependencies (`coerceMongoViewType`, `perTabSortGridId`). The 6 view components are temporarily imported from the old file (which we rename to `_legacy.tsx` during migration).

Key changes to the shell:
- Add icons to all 6 tab triggers (matching SQL pattern from `PanelContentRenderer.tsx` lines 426-481)
- Align tab bar styling: `<div className="flex-none pb-1 pt-1.5 bg-background">` (matching SQL)

Icons to add (from `@tabler/icons-react`):
```typescript
import {
  IconTable,
  IconAssembly,
  IconBookmark,
  IconArrowsShuffle,
  IconShieldCheck,
  IconFilter,
} from "@tabler/icons-react";
```

Each `TabsTrigger` gets an icon + span like SQL:
```tsx
<TabsTrigger value="data" tabIndex={0}>
  <IconTable />
  <span>Data</span>
</TabsTrigger>
```

- [ ] **Step 2: Rename old monolith to _legacy.tsx**

Rename `src/components/MongoCollectionWorkbench.tsx` → `src/components/MongoCollectionWorkbench/_legacy.tsx`. Update the new `index.tsx` to import views from `./_legacy`:

```typescript
import {
  MongoStructureView,
  MongoIndexesView,
  MongoAggregationView,
  MongoValidationView,
  MongoExplainView,
} from "./_legacy";
```

Export these views from `_legacy.tsx` (add `export` keyword to each `const MongoXxxView = memo(...)` if not already exported).

- [ ] **Step 3: Update PanelContentRenderer import**

In `src/components/Workbench/PanelContentRenderer.tsx`, change:
```typescript
// Before:
import { MongoCollectionWorkbench } from "@/components/MongoCollectionWorkbench";
// After:
import { MongoCollectionWorkbench } from "@/components/MongoCollectionWorkbench";
```
Since the new module uses `index.tsx`, the import path stays the same. Verify it resolves correctly.

- [ ] **Step 4: Update test imports**

In `src/components/__tests__/MongoCollectionWorkbench.test.tsx`, update the import path if needed. The path `@/components/MongoCollectionWorkbench` should still resolve to the new `index.tsx`.

- [ ] **Step 5: Verify typecheck and lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 6: Verify tests pass**

Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS (same behavior, just moved code)

- [ ] **Step 7: Commit**

```bash
git add src/components/MongoCollectionWorkbench/ src/components/Workbench/PanelContentRenderer.tsx src/components/__tests__/MongoCollectionWorkbench.test.tsx
git rm src/components/MongoCollectionWorkbench.tsx 2>/dev/null || true
git commit -m "refactor(mongo): extract workbench shell into module directory with tab bar icons"
```

---

## Chunk 2: MongoValidation & MongoExplain Modules

These are the simplest views to extract — good warmup before the complex ones.

### Task 3: Extract MongoValidation Module

**Files:**
- Create: `src/components/MongoValidation/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx` (switch import)
- Modify: `src/components/MongoCollectionWorkbench/_legacy.tsx` (remove validation code)

- [ ] **Step 1: Create MongoValidation/index.tsx**

Extract `MongoValidationView` (lines 1324-1516 from monolith) into its own module. Replace the plain `<Textarea>` with a CodeMirror editor:

```typescript
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { bracketMatching } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { keymap, EditorView } from "@codemirror/view";
```

Use the same extension setup as `JsonSubtreeEditor.tsx`:
```typescript
const JSON_EXTENSIONS = [
  jsonLang(),
  bracketMatching(),
  history(),
  keymap.of([...historyKeymap, ...defaultKeymap]),
  EditorView.theme({
    ".cm-scroller": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "12px",
    },
  }),
];
```

Layout changes:
- Move level/action dropdowns to a toolbar at the top (matching spec Section 7)
- Add a right-side status panel (~280px) showing current server state
- Replace `<Textarea>` with `<CodeMirror>` in the left panel

Props interface (explicit):
```typescript
interface MongoValidationViewProps {
  target: CrudCommandTarget;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}
```

Keep the same crudStore integration (`stageCommand` / `unstageCommand`).

**Shared utility dependency:** `MongoValidationView` uses `buildMongoCommand` and `toJsonValue` from the monolith. During the migration period (Tasks 3-7), these functions remain in `_legacy.tsx` and are imported from there. They move to `MongoIndexes/commandFactory.ts` in Task 8, at which point MongoValidation updates its import to `@/components/MongoIndexes/commandFactory`. This avoids build breakage between tasks.

- [ ] **Step 2: Update shell to import from new module**

In `MongoCollectionWorkbench/index.tsx`, replace:
```typescript
import { MongoValidationView } from "./_legacy";
// With:
import { MongoValidationView } from "@/components/MongoValidation";
```

- [ ] **Step 3: Remove MongoValidationView from _legacy.tsx**

Delete the `MongoValidationView` component and its dependencies from `_legacy.tsx`.

- [ ] **Step 4: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/MongoValidation/ src/components/MongoCollectionWorkbench/
git commit -m "refactor(mongo): extract MongoValidation module with CodeMirror editor"
```

### Task 4: Extract MongoExplain Module

**Files:**
- Create: `src/components/MongoExplain/index.tsx`
- Create: `src/components/MongoExplain/ExplainTree.tsx`
- Create: `src/components/MongoExplain/utils.ts`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/_legacy.tsx`

- [ ] **Step 1: Create MongoExplain/utils.ts**

Move `getExplainSummary()` function (lines 442-490 of monolith) here.

- [ ] **Step 2: Create MongoExplain/ExplainTree.tsx**

New component replacing `renderExplainNode()`. Instead of nested divs, render a visual node tree with:
- Color-coded stage cards (green for IXSCAN/FETCH, red for COLLSCAN, blue for SORT/PROJECTION)
- Connecting lines between parent → child nodes using CSS borders
- Each node shows: stage name, doc/key count, key details (index name, bounds, filter, direction)

Props:
```typescript
interface ExplainTreeProps {
  data: Record<string, unknown>;
  label: string;
}
```

Recursively traverse the explain plan object. For each node that has a `stage` or `nodeType` field, render a card. Child nodes are found by looking for object-typed values.

Node color logic:
```typescript
function getStageColor(stage: string): string {
  if (["IXSCAN", "FETCH"].includes(stage)) return "border-green-500/30 bg-green-500/5";
  if (stage === "COLLSCAN") return "border-red-500/30 bg-red-500/5";
  if (["SORT", "PROJECTION"].includes(stage)) return "border-blue-500/30 bg-blue-500/5";
  return "border-border bg-muted/20";
}
```

- [ ] **Step 3: Create MongoExplain/index.tsx**

Extract `MongoExplainView` (lines 1518-1686 of monolith). Changes:
- Stats bar: use horizontal stat cards under toolbar. Define a local `StatCard` component inside this module (do NOT import from `_legacy.tsx` — `StatCard` is a simple 15-line component, just duplicate it here)
- Replace `renderExplainNode()` calls with `<ExplainTree>` component
- Add Visual / Raw JSON toggle using `Tabs` component
- Raw JSON mode: render CodeMirror (read-only) instead of `<pre>`
- **Source selector**: Move the Explain source selector (currently rendered in `MongoCollectionWorkbench` shell, lines 1806-1832) INTO this module's toolbar. The Explain view should render its own "Source" dropdown (`Current Data Query` / `Aggregation Draft`) in its toolbar area, using `workbenchState.explainSource` and `onWorkbenchStateChange`. Update the shell to no longer render this selector.
- **Run Explain button**: Preserve the existing Run button with loading/disabled state

Keep the same props: `connectionId`, `database`, `collection`, `workbenchState`, `sortGridId`. Add `onWorkbenchStateChange` prop to allow the Explain view to update `explainSource`:

```typescript
interface MongoExplainViewProps {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  sortGridId: string;
}
```

- [ ] **Step 4: Update shell imports**

Switch `MongoExplainView` import from `_legacy` to `@/components/MongoExplain`.

- [ ] **Step 5: Remove from _legacy.tsx**

Delete `MongoExplainView`, `renderExplainNode`, `getExplainSummary` from `_legacy.tsx`.

- [ ] **Step 6: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/MongoExplain/ src/components/MongoCollectionWorkbench/
git commit -m "refactor(mongo): extract MongoExplain module with visual node tree"
```

---

## Chunk 3: MongoStructure Module

### Task 5: Create MongoStructure Utils

**Files:**
- Create: `src/components/MongoStructure/utils.ts`

- [ ] **Step 1: Move utility functions**

Move from `_legacy.tsx` to `MongoStructure/utils.ts`:
- `normalizeSamplePath()`
- `formatPercent()`
- `formatTypes()`
- `formatSampleValues()`
- `buildValidatorOverlayMap()`
- `ensureTreeNode()`
- `buildSchemaTree()`
- Types: `ValidatorOverlay`, `SchemaTreeNode`

Add a new function for the flatten-on-expand approach:

```typescript
export interface SchemaRow {
  id: string;           // unique key for the row
  field: string;        // display name (leaf segment)
  path: string;         // full dot-path
  depth: number;        // indentation level
  hasChildren: boolean; // can expand?
  isExpanded: boolean;  // currently expanded?
  node: SchemaTreeNode; // reference to tree node
}

export function flattenSchemaTree(
  root: SchemaTreeNode,
  expandedPaths: Set<string>,
): SchemaRow[] {
  const rows: SchemaRow[] = [];

  function visit(node: SchemaTreeNode, depth: number): void {
    if (node.path) {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedPaths.has(node.path);
      rows.push({
        id: node.path,
        field: node.label,
        path: node.path,
        depth,
        hasChildren,
        isExpanded,
        node,
      });
      if (!isExpanded) return;
    }
    for (const child of node.children) {
      visit(child, node.path ? depth + 1 : depth);
    }
  }

  visit(root, 0);
  return rows;
}
```

Also add BSON type color map:
```typescript
export const BSON_TYPE_COLORS: Record<string, string> = {
  string: "#4ade80",
  int: "#60a5fa",
  int32: "#60a5fa",
  double: "#60a5fa",
  long: "#60a5fa",
  decimal: "#60a5fa",
  objectId: "#a78bfa",
  object: "#f97316",
  array: "#fbbf24",
  bool: "#f87171",
  boolean: "#f87171",
  date: "#ec4899",
  timestamp: "#ec4899",
  null: "#888888",
  binData: "#888888",
  regex: "#888888",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MongoStructure/utils.ts
git commit -m "feat(mongo): add MongoStructure utils with flatten-on-expand and type colors"
```

### Task 6: Create Schema Cell Renderers

**Files:**
- Create: `src/components/MongoStructure/SchemaFieldCell.tsx`

`SchemaFieldCell.tsx` contains TWO custom cell renderers:
1. `SchemaFieldCellRenderer` — for the "Field" column: draws monospace field name with tree indentation (based on `depth`), expand/collapse arrow for nodes with children, and "required" badge
2. `TypeDistributionCellRenderer` — for the "Type Distribution" column: draws the color-segmented type bar

- [ ] **Step 1: Create both custom cell renderers**

Follow the Glide `CustomRenderer` pattern from `ActionsCellRenderer`.

**SchemaFieldCellRenderer** — for the "Field" column:

```typescript
interface SchemaFieldCellData {
  kind: "schema-field-cell";
  field: string;       // display name
  depth: number;       // indentation level
  hasChildren: boolean;
  isExpanded: boolean;
  isRequired: boolean;
}
```

Draw logic: indent by `depth * 16px`, draw expand/collapse arrow (▶/▼) if `hasChildren`, draw field name in monospace, draw "required" badge if `isRequired`. Click handling for expand/collapse is done via `onCellClicked` in the parent component (not in the renderer).

**TypeDistributionCellRenderer** — for the "Type Distribution" column. This draws the color-segmented type bar:

```typescript
import { GridCellKind, type CustomCell, type CustomRenderer } from "@glideapps/glide-data-grid";
import { BSON_TYPE_COLORS } from "./utils";

interface TypeDistributionCellData {
  kind: "type-distribution-cell";
  types: Array<{ type: string; percentage: number }>;
}

interface TypeDistributionCell extends CustomCell {
  kind: GridCellKind.Custom;
  data: TypeDistributionCellData;
}

export const TypeDistributionCellRenderer: CustomRenderer<TypeDistributionCell> = {
  kind: GridCellKind.Custom,

  isMatch: (cell: CustomCell): cell is TypeDistributionCell =>
    typeof cell.data === "object" &&
    cell.data !== null &&
    "kind" in cell.data &&
    (cell.data as Record<string, unknown>).kind === "type-distribution-cell",

  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { types } = cell.data;
    if (!types.length) return true;

    const padding = 8;
    const barHeight = 14;
    const barY = rect.y + (rect.height - barHeight) / 2;
    const barWidth = Math.min(rect.width * 0.6 - padding * 2, 160);
    const barX = rect.x + padding;

    // Draw segmented bar
    ctx.save();
    let offsetX = barX;
    for (const { type, percentage } of types) {
      const segmentWidth = barWidth * (percentage / 100);
      ctx.fillStyle = BSON_TYPE_COLORS[type] ?? theme.textDark;
      ctx.beginPath();
      ctx.roundRect(offsetX, barY, Math.max(segmentWidth, 2), barHeight, 3);
      ctx.fill();
      offsetX += segmentWidth;
    }

    // Draw type labels to the right of bar
    const labelX = barX + barWidth + 8;
    ctx.font = "10px monospace";
    ctx.fillStyle = theme.textLight;
    const labelText = types.map((t) => t.type).join(", ");
    ctx.fillText(labelText, labelX, rect.y + rect.height / 2 + 3.5);
    ctx.restore();

    return true;
  },

  provideEditor: () => undefined,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MongoStructure/SchemaFieldCell.tsx
git commit -m "feat(mongo): add TypeDistributionCellRenderer for schema type bars"
```

### Task 7: Create MongoStructure Columns and Main Component

**Files:**
- Create: `src/components/MongoStructure/columns.ts`
- Create: `src/components/MongoStructure/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/_legacy.tsx`

- [ ] **Step 1: Create columns.ts**

Define the 6 columns per spec Section 4:

Follow the column definition pattern from `src/components/TableIndexes/columns.ts` — columns use `id`, `field`, `title`, `name`, `width`, `minWidth`, `maxWidth` and are cast `as GridColumnV2`:

```typescript
import type { GridColumnV2 } from "@/components/DataGrid/types";

export const structureColumns: GridColumnV2[] = [
  { id: "field", field: "field", title: "Field", name: "Field", width: 200, minWidth: 120, maxWidth: 400 } as GridColumnV2,
  { id: "typeDistribution", field: "typeDistribution", title: "Type Distribution", name: "Type Distribution", width: 220, minWidth: 140, maxWidth: 350 } as GridColumnV2,
  { id: "present", field: "present", title: "Present %", name: "Present %", width: 80, minWidth: 60, maxWidth: 120 } as GridColumnV2,
  { id: "nullPct", field: "nullPct", title: "Null %", name: "Null %", width: 70, minWidth: 50, maxWidth: 100 } as GridColumnV2,
  { id: "samples", field: "samples", title: "Sample Values", name: "Sample Values", width: 220, minWidth: 100, maxWidth: 400 } as GridColumnV2,
  { id: "validator", field: "validator", title: "Validator", name: "Validator", width: 100, minWidth: 60, maxWidth: 160 } as GridColumnV2,
];
```

- [ ] **Step 2: Create MongoStructure/index.tsx**

New `MongoStructureView` component using `DataGridBase`. Key aspects:

Props (same as current):
```typescript
interface MongoStructureViewProps {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}
```

Implementation approach:
- Fetch schema using existing `MongoDBAdapter.sampleCollectionSchema()` and `getCollectionMetadata()` (same as current)
- Build tree using `buildSchemaTree()` from utils
- Flatten using `flattenSchemaTree()` with `expandedPaths` state (`useState<Set<string>>`)
- Render `DataGridBase` with `structureColumns` and custom renderers
- `getCellContent` maps each row to cells:
  - `field`: Text cell with monospace font. Prepend `depth * 16px` padding + expand/collapse arrow for nodes with children. Add "required" badge text.
  - `typeDistribution`: Custom `type-distribution-cell` with type percentages from `node.field.types`
  - `present`: Text cell with `formatPercent(node.field.occurrences, sampleSize)`
  - `nullPct`: Text cell with `formatPercent(node.field.nullCount, node.field.occurrences)`
  - `samples`: Text cell with `formatSampleValues(node.field.sampleValues)`
  - `validator`: Text cell with overlay bsonType

Toolbar: Sample size input, Max depth input, Refresh button, stat cards (Docs Sampled, Fields, Validator).

Handle expand/collapse via `onCellClicked` — if the click is on a field cell with children, toggle that path in `expandedPaths`.

- [ ] **Step 3: Update shell imports and remove from _legacy**

Switch `MongoStructureView` import to `@/components/MongoStructure`. Remove `MongoStructureView`, `SchemaNodeView`, `StatCard`, and related utils from `_legacy.tsx`.

- [ ] **Step 4: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/MongoStructure/ src/components/MongoCollectionWorkbench/
git commit -m "feat(mongo): add DataGrid-based MongoStructure with type distribution bars"
```

---

## Chunk 4: MongoIndexes Module

### Task 8: Create MongoIndexes Command Factory and Columns

**Files:**
- Create: `src/components/MongoIndexes/commandFactory.ts`
- Create: `src/components/MongoIndexes/columns.ts`

- [ ] **Step 1: Create commandFactory.ts**

Move from `_legacy.tsx`: `buildMongoCommand`, `normalizeIndexOptionsForCrud`, `toJsonValue`. These functions were kept in `_legacy.tsx` during earlier tasks because MongoValidation also depends on them. Now that this is the canonical home, update `MongoValidation/index.tsx` to import `buildMongoCommand` and `toJsonValue` from `@/components/MongoIndexes/commandFactory` instead of `_legacy`.

- [ ] **Step 2: Create columns.ts**

Define 6 columns per spec Section 5:

Follow the same column definition pattern from `src/components/TableIndexes/columns.ts`:

```typescript
import type { GridColumnV2 } from "@/components/DataGrid/types";

export const indexColumns: GridColumnV2[] = [
  { id: "name", field: "name", title: "Name", name: "Name", width: 180, minWidth: 100, maxWidth: 300 } as GridColumnV2,
  { id: "keys", field: "keys", title: "Keys", name: "Keys", width: 220, minWidth: 140, maxWidth: 400 } as GridColumnV2,
  { id: "properties", field: "properties", title: "Properties", name: "Properties", width: 120, minWidth: 80, maxWidth: 200 } as GridColumnV2,
  { id: "usage", field: "usage", title: "Usage", name: "Usage", width: 80, minWidth: 60, maxWidth: 120 } as GridColumnV2,
  { id: "size", field: "size", title: "Size", name: "Size", width: 80, minWidth: 60, maxWidth: 120 } as GridColumnV2,
  { id: "actions", field: "actions", title: "Actions", name: "Actions", width: 90, minWidth: 70, maxWidth: 120 } as GridColumnV2,
];
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MongoIndexes/
git commit -m "feat(mongo): add MongoIndexes command factory and column definitions"
```

### Task 9: Create Index Cell Renderers

**Files:**
- Create: `src/components/MongoIndexes/IndexKeyCell.tsx`
- Create: `src/components/MongoIndexes/IndexPropertiesCell.tsx`

- [ ] **Step 1: Create IndexKeyCell**

Custom renderer that draws tag-style chips for index keys. Each chip shows `fieldName: 1` / `fieldName: -1` / `fieldName: text` with a colored background. Follow `CustomRenderer` pattern from `ActionsCellRenderer`.

Cell data shape:
```typescript
interface IndexKeyCellData {
  kind: "index-key-cell";
  keys: Record<string, 1 | -1 | "text">;
  isEditable: boolean;
}
```

Draw pattern: For each key entry, draw a rounded rect chip with the key text inside.

**Key add popover for inline editing:** The canvas-based renderer cannot embed React DOM elements. Instead, handle key editing via the `onCellClicked` callback in the parent `MongoIndexes/index.tsx`. When a user clicks on an editable Keys cell, show a React `Popover` (from `@/components/ui/popover`) anchored to the cell position. The popover contains: field name text input, direction selector (Select with Asc/Desc/Text), and Add button. This is the same approach used by other Glide Data Grid integrations that need React overlays for editing — the popover is rendered as a sibling to the grid, positioned using the cell's bounding rect from the click event args.

- [ ] **Step 2: Create IndexPropertiesCell**

Custom renderer that draws property badges (unique, sparse, TTL). Similar chip/badge drawing approach.

Cell data shape:
```typescript
interface IndexPropertiesCellData {
  kind: "index-properties-cell";
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds?: number;
  isTextIndex: boolean;
  language?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MongoIndexes/IndexKeyCell.tsx src/components/MongoIndexes/IndexPropertiesCell.tsx
git commit -m "feat(mongo): add IndexKeyCell and IndexPropertiesCell custom renderers"
```

### Task 10: Create MongoIndexes Main Component

**Files:**
- Create: `src/components/MongoIndexes/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/_legacy.tsx`

- [ ] **Step 1: Create MongoIndexes/index.tsx**

New `MongoIndexesView` using `DataGridBase`. Key aspects:

Props (same as current):
```typescript
interface MongoIndexesViewProps {
  target: CrudCommandTarget;
}
```

Implementation:
- Fetch indexes via `MongoDBAdapter.listIndexes()` and `getIndexUsageStats()` (same as current)
- Transform to grid rows including staged rows from `useCrudStore`
- Render `DataGridBase` with custom renderers: `IndexKeyCellRenderer`, `IndexPropertiesCellRenderer`, `ActionsCellRenderer`
- Toolbar: Search input + `+ Add Index` button + Refresh
- Status bar: `TableActionsToolbar` pattern with Apply/Discard
- Inline add: `+ Add Index` appends a local-state row. When valid (name + key), auto-stage to crudStore. Row shows with green highlight and `staged` badge.
- Context menu: Copy name, Copy key spec, Stage Drop
- Use `ConfirmDeleteDialog` for drop confirmation (like SQL `TableIndexes`)

Reference `src/components/TableIndexes/index.tsx` for the exact DataGridBase + crudStore + TableActionsToolbar integration pattern.

- [ ] **Step 2: Update shell imports and remove from _legacy**

Switch `MongoIndexesView` import. Remove from `_legacy.tsx`.

- [ ] **Step 3: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/MongoIndexes/ src/components/MongoCollectionWorkbench/
git commit -m "feat(mongo): add DataGrid-based MongoIndexes with inline creation"
```

---

## Chunk 5: Data View Modes

### Task 11: Create DocumentTreeView

**Files:**
- Create: `src/components/DataGrid/components/DocumentTreeView.tsx`

- [ ] **Step 1: Create DocumentTreeView component**

Props:
```typescript
interface DocumentTreeViewProps {
  documents: Record<string, unknown>[];
  className?: string;
}
```

Implementation:
- Render a scrollable list of document cards
- Each document has a header with ObjectId (truncated) and expand/collapse toggle
- Collapsed: show a one-line preview of top-level fields
- Expanded: show key-value tree with BSON type color coding
- Nested objects/arrays are expandable sub-trees
- Use `BSON_TYPE_COLORS` from `MongoStructure/utils.ts` for consistent colors
- Use virtualization for large document counts (use CSS `overflow-auto` and lazy rendering — a simple approach is fine for V1, can add `react-window` later if needed)

Color coding helper:
```typescript
function getValueColor(value: unknown): string {
  if (value === null) return "#888888";
  if (typeof value === "string") return "#4ade80";
  if (typeof value === "number") return "#60a5fa";
  if (typeof value === "boolean") return "#f87171";
  if (Array.isArray(value)) return "#fbbf24";
  if (typeof value === "object") return "#f97316";
  return "#888888";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DataGrid/components/DocumentTreeView.tsx
git commit -m "feat(mongo): add DocumentTreeView component for tree-mode document display"
```

### Task 12: Create DocumentJsonView

**Files:**
- Create: `src/components/DataGrid/components/DocumentJsonView.tsx`

- [ ] **Step 1: Create DocumentJsonView component**

Props:
```typescript
interface DocumentJsonViewProps {
  documents: Record<string, unknown>[];
  className?: string;
}
```

Implementation:
- Render a read-only CodeMirror instance with JSON language mode
- Serialize all documents as a JSON array: `JSON.stringify(documents, null, 2)`
- Use the same CodeMirror extensions as `MongoValidation` (JSON lang, bracket matching, monospace theme)
- Set `editable={false}` and `readOnly={true}`

- [ ] **Step 2: Commit**

```bash
git add src/components/DataGrid/components/DocumentJsonView.tsx
git commit -m "feat(mongo): add DocumentJsonView component for JSON-mode document display"
```

### Task 13: Add View Mode Toggle to DocumentDataGrid

**Files:**
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx`

- [ ] **Step 1: Add viewMode prop and toggle UI**

Add to `DocumentDataGridBaseProps`:
```typescript
viewMode?: "table" | "tree" | "json";
onViewModeChange?: (mode: "table" | "tree" | "json") => void;
```

In the toolbar area (near the existing quick filter), render a segmented control when `onViewModeChange` is provided:
```tsx
{onViewModeChange && (
  <Tabs value={viewMode ?? "table"} onValueChange={onViewModeChange}>
    <TabsList className="h-7 p-0.5">
      <TabsTrigger value="table" className="h-6 px-2 text-xs">
        <IconTable className="size-3" />
        Table
      </TabsTrigger>
      <TabsTrigger value="tree" className="h-6 px-2 text-xs">
        <IconListTree className="size-3" />
        Tree
      </TabsTrigger>
      <TabsTrigger value="json" className="h-6 px-2 text-xs">
        <IconBraces className="size-3" />
        JSON
      </TabsTrigger>
    </TabsList>
  </Tabs>
)}
```

- [ ] **Step 2: Conditionally render view modes**

When `viewMode` is `"tree"` or `"json"`, hide the grid (`display: none` to preserve state) and render the alternative view as a sibling:

```tsx
<div style={{ display: (viewMode ?? "table") === "table" ? undefined : "none" }}>
  {/* existing BaseDataGrid rendering */}
</div>
{(viewMode ?? "table") === "tree" && (
  <DocumentTreeView documents={rawDocuments} className="h-full" />
)}
{(viewMode ?? "table") === "json" && (
  <DocumentJsonView documents={rawDocuments} className="h-full" />
)}
```

The `rawDocuments` array comes from the existing `useDocumentData` hook's data. Identify where the raw documents are available before grid transformation and pass them through.

- [ ] **Step 3: Wire viewMode in MongoCollectionWorkbench shell**

In `MongoCollectionWorkbench/index.tsx`, pass `viewMode` and `onViewModeChange` to `DocumentDataGrid`:

```tsx
<DocumentDataGrid
  // ... existing props
  viewMode={workbenchState.dataViewMode}
  onViewModeChange={(mode) => updateWorkbenchState({ dataViewMode: mode })}
/>
```

- [ ] **Step 4: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/DocumentDataGrid.tsx src/components/MongoCollectionWorkbench/
git commit -m "feat(mongo): add Table/Tree/JSON view mode toggle to DocumentDataGrid"
```

---

## Chunk 6: MongoAggregation Module

### Task 14: Create MongoAggregation Utils

**Files:**
- Create: `src/components/MongoAggregation/utils.ts`

- [ ] **Step 1: Move aggregation utilities**

Move from `_legacy.tsx`:
- `parseAggregationStages()` function
- `DEFAULT_STAGE_TEMPLATES` constant
- `swapStages()` function
- `AggregationParseResult` type

Add stage color map:
```typescript
export const STAGE_COLORS: Record<string, string> = {
  $match: "text-green-400 border-green-500/30 bg-green-500/5",
  $group: "text-purple-400 border-purple-500/30 bg-purple-500/5",
  $sort: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  $project: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  $limit: "text-red-400 border-red-500/30 bg-red-500/5",
  $unwind: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  $lookup: "text-pink-400 border-pink-500/30 bg-pink-500/5",
  $addFields: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
};

export function detectStageType(stageJson: string): string {
  try {
    const parsed = JSON.parse(stageJson);
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      if (keys.length > 0 && keys[0].startsWith("$")) return keys[0];
    }
  } catch { /* ignore */ }
  return "$stage";
}

export function getStageColorClasses(stageType: string): string {
  return STAGE_COLORS[stageType] ?? "text-muted-foreground border-border bg-muted/20";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MongoAggregation/utils.ts
git commit -m "feat(mongo): add MongoAggregation utils with stage colors and parser"
```

### Task 15: Create StageCard Component

**Files:**
- Create: `src/components/MongoAggregation/StageCard.tsx`

- [ ] **Step 1: Create StageCard**

Props:
```typescript
interface StageCardProps {
  id: string;
  index: number;
  stageJson: string;
  enabled: boolean;
  selected: boolean;
  outputSummary?: { docCount: number; timeMs: number } | null;
  onJsonChange: (json: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onDelete: () => void;
  onSelect: () => void;
}
```

Implementation:
- **Pre-check**: Before building, verify `@dnd-kit/sortable` is importable: create a temp file with `import { useSortable } from "@dnd-kit/sortable"` and run `pnpm typecheck`. If it fails, check `node_modules/@dnd-kit/sortable` exports. The project uses v10 which may have API differences from commonly documented v8/v9 — check actual exports.
- Uses `useSortable()` from `@dnd-kit/sortable` for drag handle
- Header: drag handle (grip dots) + stage type label (color-coded using `detectStageType` + `getStageColorClasses`) + stage number badge + enable/disable toggle (shadcn Switch) + delete button
- Body: CodeMirror editor with JSON mode for the stage content
- Footer: per-stage output summary (doc count + execution time) when available
- Selected state: highlighted border (`border-primary`)
- Disabled state: reduced opacity, editor read-only

Use `@dnd-kit/sortable`:
```typescript
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
const style = { transform: CSS.Transform.toString(transform), transition };
```

Drag handle renders with `{...listeners}` on a grip icon.

- [ ] **Step 2: Commit**

```bash
git add src/components/MongoAggregation/StageCard.tsx
git commit -m "feat(mongo): add StageCard component with drag, toggle, and CodeMirror editor"
```

### Task 16: Create StagePreview and PipelineCodeView

**Files:**
- Create: `src/components/MongoAggregation/StagePreview.tsx`
- Create: `src/components/MongoAggregation/PipelineCodeView.tsx`

- [ ] **Step 1: Create StagePreview**

Props:
```typescript
interface StagePreviewProps {
  connectionId: string;
  database: string;
  collection: string;
  stages: string[];
  stageEnabled: boolean[];
  selectedStageIndex: number;
  tabId: string;
}
```

Implementation:
- Runs `MongoDBAdapter.aggregate()` with pipeline sliced to `stages[0..selectedStageIndex]` (only enabled stages)
- Debounced execution (500ms) with AbortController for cancellation
- Renders result using `MongoResultViewer` (existing component) with Table/JSON toggle
- Header: "Stage N Output" + stage type + doc count
- Error display: inline error with established styling
- Loading state: `Loader2` spinner

- [ ] **Step 2: Create PipelineCodeView**

Props:
```typescript
interface PipelineCodeViewProps {
  stages: string[];
  onChange: (stages: string[]) => void;
}
```

Implementation:
- Single CodeMirror editor showing the full pipeline as a JSON array
- On change, parse the JSON array and call `onChange` with individual stage strings
- Two-way sync: changes in Code mode update the stages array, which also updates Visual mode

- [ ] **Step 3: Commit**

```bash
git add src/components/MongoAggregation/StagePreview.tsx src/components/MongoAggregation/PipelineCodeView.tsx
git commit -m "feat(mongo): add StagePreview with per-stage output and PipelineCodeView"
```

### Task 17: Create MongoAggregation Main Component

**Files:**
- Create: `src/components/MongoAggregation/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx`
- Modify: `src/components/MongoCollectionWorkbench/_legacy.tsx`

- [ ] **Step 1: Create MongoAggregation/index.tsx**

Props (same as current):
```typescript
interface MongoAggregationViewProps {
  connectionId: string;
  database: string;
  collection: string;
  tabId: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  onOpenExplain: () => void;
}
```

Layout: Two-panel split using CSS grid `grid-template-columns: 1fr 1fr`:
- Left: stage cards wrapped in `DndContext` + `SortableContext` from `@dnd-kit`
- Right: `StagePreview` component

Toolbar:
- Stage template buttons (`+ $match`, `+ $group`, etc.) from `DEFAULT_STAGE_TEMPLATES`
- Visual / Code toggle using `Tabs`
- Run button + Explain button

DnD setup:
```typescript
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
```

Handle drag end:
```typescript
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (over && active.id !== over.id) {
    const oldIndex = stages.findIndex((_, i) => `stage-${i}` === active.id);
    const newIndex = stages.findIndex((_, i) => `stage-${i}` === over.id);
    onWorkbenchStateChange({
      aggregationStages: arrayMove(stages, oldIndex, newIndex),
      aggregationStageEnabled: arrayMove(stageEnabled, oldIndex, newIndex),
    });
  }
}
```

Visual / Code toggle: when `aggregationViewMode === "code"`, render `PipelineCodeView` instead of stage cards. When `"visual"`, render stage cards.

- [ ] **Step 2: Update shell imports and remove from _legacy**

Switch `MongoAggregationView` import. Remove from `_legacy.tsx`.

- [ ] **Step 3: Verify typecheck, lint, tests**

Run: `pnpm typecheck && pnpm lint`
Run: `pnpm vitest run src/components/__tests__/MongoCollectionWorkbench.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/MongoAggregation/ src/components/MongoCollectionWorkbench/
git commit -m "feat(mongo): add card-based MongoAggregation with per-stage preview and drag-drop"
```

---

## Chunk 7: Cleanup and Final Verification

### Task 18: Delete Legacy File and Final Cleanup

**Files:**
- Delete: `src/components/MongoCollectionWorkbench/_legacy.tsx`
- Modify: `src/components/MongoCollectionWorkbench/index.tsx` (remove _legacy imports)

- [ ] **Step 1: Verify _legacy.tsx is empty**

At this point, all 5 views and their utilities should have been extracted. The `_legacy.tsx` file should only contain dead imports. If any code remains, move it to the appropriate module.

- [ ] **Step 2: Delete _legacy.tsx**

Remove the file and update any remaining imports.

- [ ] **Step 3: Commit**

```bash
git rm src/components/MongoCollectionWorkbench/_legacy.tsx
git add src/components/MongoCollectionWorkbench/index.tsx
git commit -m "refactor(mongo): delete legacy monolith after full module extraction"
```

### Task 19: Full Verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 4: Run the app**

Run: `make dev`

Manually verify:
1. Open a MongoDB connection
2. Open a collection — verify 6 tabs with icons
3. Data tab: toggle between Table/Tree/JSON views
4. Structure tab: verify type distribution bars in DataGrid, expand/collapse nested fields
5. Indexes tab: verify grid layout, inline add row, stage/unstage
6. Aggregation tab: add stages, drag to reorder, toggle enable/disable, verify per-stage preview
7. Validation tab: verify CodeMirror editor with syntax highlighting, status panel
8. Explain tab: run explain, verify visual node tree, stats bar

- [ ] **Step 5: Final commit if any fixes needed**

Stage only the specific files that were changed (do NOT use `git add -A`):
```bash
git add src/components/MongoCollectionWorkbench/ src/components/MongoStructure/ src/components/MongoIndexes/ src/components/MongoAggregation/ src/components/MongoValidation/ src/components/MongoExplain/ src/components/DataGrid/
git commit -m "fix(mongo): final adjustments after manual verification"
```
