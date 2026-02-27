# Inspector Panel Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Inspector panel to support multi-record selection with merged tree view, inline unified diff, CodeEditor-powered raw view, Cmd+J toggle, and per-connection persistence.

**Architecture:** Split monolithic InspectorPanel into subcomponents (TreeView, DiffView, RawView) in a new `inspector/` directory. Change data flow from single `selectedRow` to `selectedRows[]` array collected from grid's multi-row selection. Remove baseline concept entirely — first selected record becomes the diff reference automatically.

**Tech Stack:** React 19, CodeMirror (via existing CodeEditor component), Zustand (grid preferences store), shadcn/ui

---

### Task 1: Create Inspector shared types and utilities

**Files:**
- Create: `src/components/DataGrid/components/inspector/types.ts`
- Create: `src/components/DataGrid/components/inspector/utils.ts`

**Step 1: Create the types file**

```ts
// src/components/DataGrid/components/inspector/types.ts
import type { GridColumnV2, GridRowModel } from "../../types";

export type InspectorTab = "tree" | "diff" | "raw";

export interface InspectorPanelProps {
  selectedRows: GridRowModel[];
  columns: GridColumnV2[];
  onCellEdit?: (rowIndexes: number[], field: string, value: unknown) => void;
  className?: string;
  defaultTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
}

export interface InspectorDocument {
  [key: string]: unknown;
}

/** Merged field value for multi-record tree view */
export type MergedFieldValue =
  | { kind: "same"; value: unknown }
  | { kind: "multiple"; values: unknown[]; distinctValues: unknown[] };
```

**Step 2: Create the utils file**

Port existing helpers from old InspectorPanel.tsx and add new multi-record merge logic:

```ts
// src/components/DataGrid/components/inspector/utils.ts
import type { GridColumnV2, GridRowModel } from "../../types";
import type { InspectorDocument, MergedFieldValue } from "./types";

export function extractCellValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

export function getColumnLabel(column: GridColumnV2): string {
  const title = column.title.trim();
  if (title && !/^col_\d+$/i.test(title)) return title;
  const name = column.name.trim();
  if (name && !/^col_\d+$/i.test(name)) return name;
  const metaName = column.meta?.name.trim();
  if (metaName) return metaName;
  if (title) return title;
  if (name) return name;
  return column.field;
}

export function rowToDocument(
  row: GridRowModel,
  columns: GridColumnV2[],
): InspectorDocument {
  const doc: InspectorDocument = {};
  const usedLabels = new Map<string, number>();

  for (const column of columns) {
    const baseLabel = getColumnLabel(column);
    const duplicateCount = usedLabels.get(baseLabel) ?? 0;
    usedLabels.set(baseLabel, duplicateCount + 1);
    const label =
      duplicateCount === 0 ? baseLabel : `${baseLabel} (${duplicateCount + 1})`;
    doc[label] = extractCellValue(row[column.field]);
  }

  return doc;
}

export function rowsToDocuments(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): InspectorDocument[] {
  return rows.map((row) => rowToDocument(row, columns));
}

/** Merge a field across multiple documents into a single MergedFieldValue */
export function mergeFieldValues(values: unknown[]): MergedFieldValue {
  if (values.length === 0) return { kind: "same", value: undefined };

  const first = values[0];
  const allSame = values.every(
    (v) => JSON.stringify(v) === JSON.stringify(first),
  );

  if (allSame) return { kind: "same", value: first };

  const seen = new Map<string, unknown>();
  for (const v of values) {
    const key = JSON.stringify(v);
    if (!seen.has(key)) seen.set(key, v);
  }

  return {
    kind: "multiple",
    values,
    distinctValues: Array.from(seen.values()),
  };
}

/** Compute diff paths between a reference document and another document */
export function computeDiffFields(
  reference: InspectorDocument,
  other: InspectorDocument,
): Set<string> {
  const diffs = new Set<string>();
  const allKeys = new Set([
    ...Object.keys(reference),
    ...Object.keys(other),
  ]);

  for (const key of allKeys) {
    if (JSON.stringify(reference[key]) !== JSON.stringify(other[key])) {
      diffs.add(key);
    }
  }
  return diffs;
}

export function toSearchableText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function formatValueForDisplay(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
```

**Step 3: Commit**

```
git add src/components/DataGrid/components/inspector/
git commit -m "feat(inspector): add shared types and utilities for inspector redesign"
```

---

### Task 2: Create InspectorTreeView component

**Files:**
- Create: `src/components/DataGrid/components/inspector/InspectorTreeView.tsx`

**Context:**
- Refer to `src/components/DataGrid/components/InspectorPanel.tsx:91-153` for the existing `JsonTreeNode` pattern
- The tree view must handle both single and multi-record cases
- Single record: click-to-edit values
- Multi records: merged fields showing `<multiple values>` badges for differing values
- Editing fires `onCellEdit(rowIndexes[], field, newValue)` for all selected records

**Step 1: Create InspectorTreeView**

Build the component with:
1. A `MergedTreeNode` component that renders a single field:
   - If `MergedFieldValue.kind === "same"`: show value with click-to-edit
   - If `MergedFieldValue.kind === "multiple"`: show `<multiple values>` text with Badge components for distinct values (max 3 + "+N more")
2. Inline editing: clicking a value shows an `<Input>` field. On blur/Enter, calls `onCellEdit`.
3. Search input at top filters by field name and value text
4. Recursive expansion for nested objects (using `<details>` like existing code)
5. Accept `documents: InspectorDocument[]` and merge fields using `mergeFieldValues()`

Key implementation details:
- Use `useState` for edit state: `{ field: string; value: string } | null`
- Badge component from `@/components/ui/badge` for distinct values
- Truncate badge text at ~60px with `max-w-[60px] truncate` classes
- When `documents.length === 1`, all fields are `kind: "same"` so editing is straightforward

**Step 2: Commit**

```
git commit -m "feat(inspector): add InspectorTreeView with multi-record merge and inline editing"
```

---

### Task 3: Create InspectorDiffView component

**Files:**
- Create: `src/components/DataGrid/components/inspector/InspectorDiffView.tsx`

**Context:**
- First document in the array is the reference
- Show inline unified diff: field | reference value | per-row differences
- Only fields with differences shown by default, with toggle for "Show N identical fields"

**Step 1: Create InspectorDiffView**

Build the component with:
1. Empty state for `documents.length < 2`: "Select 2+ records to compare differences."
2. Compute diffs: for each document after the first, run `computeDiffFields(reference, doc)` and union all diff keys
3. Render a list of fields:
   - **Changed fields** (default visible): show field name, reference value, then colored badges for each differing row (e.g., "Row 2: value")
   - **Identical fields** (collapsed): toggle "Show N identical fields" using `<details>` or a button
4. Search input filters field names and values
5. Color coding: reference values in normal text, differing values use `text-amber-600` / `bg-amber-50`
6. Row indicators: `Row 2`, `Row 3`, etc. as muted prefix labels

**Step 2: Commit**

```
git commit -m "feat(inspector): add InspectorDiffView with inline unified diff"
```

---

### Task 4: Create InspectorRawView component

**Files:**
- Create: `src/components/DataGrid/components/inspector/InspectorRawView.tsx`

**Context:**
- Uses `CodeEditor` from `@/components/CodeEditor` with `language="json"` and `readOnly={true}`
- Single record: JSON object. Multiple records: JSON array.
- No editing support in raw view.

**Step 1: Create InspectorRawView**

```tsx
import { useMemo } from "react";
import CodeEditor from "@/components/CodeEditor";
import type { InspectorDocument } from "./types";

interface InspectorRawViewProps {
  documents: InspectorDocument[];
  className?: string;
}

export function InspectorRawView({ documents, className }: InspectorRawViewProps) {
  const jsonValue = useMemo(() => {
    if (documents.length === 0) return "";
    const data = documents.length === 1 ? documents[0] : documents;
    return JSON.stringify(data, null, 2);
  }, [documents]);

  if (documents.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-3">
        Select a row to view raw JSON.
      </div>
    );
  }

  return (
    <CodeEditor
      value={jsonValue}
      language="json"
      readOnly
      lineNumbers={false}
      height="100%"
      className={className}
    />
  );
}
```

**Step 2: Commit**

```
git commit -m "feat(inspector): add InspectorRawView using CodeEditor for JSON display"
```

---

### Task 5: Create new InspectorPanel shell component

**Files:**
- Create: `src/components/DataGrid/components/inspector/InspectorPanel.tsx`
- Create: `src/components/DataGrid/components/inspector/index.ts`

**Context:**
- This is the shell that holds the tabs and header
- Delegates to TreeView, DiffView, RawView subcomponents
- Shows record count badge in header
- No "Set Baseline" or "Clear" buttons

**Step 1: Create InspectorPanel shell**

Build the component with:
1. Header: "Inspector" title + Badge showing record count (e.g., "3 records")
2. Tabs component with Tree / Raw / Diff triggers (using shadcn `Tabs`)
3. Each `TabsContent` renders the corresponding subcomponent
4. Converts `selectedRows` to `documents` via `rowsToDocuments()` once in a `useMemo`
5. Props: `InspectorPanelProps` from `./types.ts`
6. Wrap in `memo()` for performance

**Step 2: Create barrel export**

```ts
// src/components/DataGrid/components/inspector/index.ts
export { InspectorPanel } from "./InspectorPanel";
export type { InspectorPanelProps, InspectorTab } from "./types";
```

**Step 3: Commit**

```
git commit -m "feat(inspector): add InspectorPanel shell with tabs and subcomponent delegation"
```

---

### Task 6: Update BaseDataGrid to collect multi-row selection

**Files:**
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx`

**Context:**
- Current code at line 2982 only gets `firstSelectedRowIndex` and passes a single row
- Need to collect ALL selected row indexes and pass `selectedRows[]`
- Remove `inspectorBaselineRow` state and `onSetBaseline` prop passing
- Update the import from old `InspectorPanel` to new `inspector/` module

**Step 1: Update imports**

Change line 37:
```ts
// OLD:
import { InspectorPanel, type InspectorPanelProps } from "../components/InspectorPanel";
// NEW:
import { InspectorPanel, type InspectorPanelProps } from "../components/inspector";
```

**Step 2: Remove baseline state**

Remove lines around 604-606:
```ts
// REMOVE these:
const [inspectorBaselineRow, setInspectorBaselineRow] = useState<GridRowModel | null>(null);
```

**Step 3: Collect all selected rows for inspector**

Replace the `firstSelectedRowIndex` / `activeInspectorRow` logic (lines 2982-3010) with:

```ts
const inspectorSelectedRows = useMemo((): GridRowModel[] => {
  // If explicit row selection exists, use all selected rows
  const selectedIndexes = collectSelectedRowIndexes(gridSelection);
  if (selectedIndexes.size > 0) {
    return Array.from(selectedIndexes)
      .sort((a, b) => a - b)
      .map((idx) => effectiveDisplayRows[idx])
      .filter((row): row is GridRowModel => Boolean(row));
  }
  // Fall back to single inspectorSelectedRow from cell click
  if (inspectorSelectedRow) return [inspectorSelectedRow];
  return [];
}, [gridSelection, effectiveDisplayRows, inspectorSelectedRow]);
```

**Step 4: Update inspector panel rendering**

Replace `activeInspectorPanel` (lines 2995-3008):

```ts
const activeInspectorPanel =
  showInspector && enableInspector ? (
    renderInspectorPanel ? (
      renderInspectorPanel({
        selectedRows: inspectorSelectedRows,
        columns: finalColumns,
      })
    ) : (
      <InspectorPanel
        selectedRows={inspectorSelectedRows}
        columns={finalColumns}
      />
    )
  ) : null;
```

**Step 5: Update `InspectorPanelProps` type usage**

The `renderInspectorPanel` prop type references `InspectorPanelProps` — this import now comes from the new module, which has the updated interface with `selectedRows[]`.

**Step 6: Update `handleInspectorViewDetails`**

At line 2947, change to set the first row from the batch:
```ts
const handleInspectorViewDetails = useCallback(
  (rowsToInspect: GridRowModel[]) => {
    if (!enableInspector || rowsToInspect.length === 0) return;
    setInspectorSelectedRow(rowsToInspect[0] ?? null);
    setInspectorOpen(true);
  },
  [enableInspector, setInspectorOpen],
);
```
(This handler stays the same — it's from the context menu "View Details" which works on one row.)

**Step 7: Commit**

```
git commit -m "feat(inspector): update BaseDataGrid to pass selectedRows[] to inspector"
```

---

### Task 7: Add Cmd+J keyboard shortcut

**Files:**
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx` (keyboard handler ~lines 2614-2717)

**Step 1: Add Cmd+J handler**

In the `handleDataGridShortcuts` function, add after the existing shortcuts (around line 2717):

```ts
// Toggle Inspector panel
if (isMod && key === "j") {
  event.preventDefault();
  event.stopPropagation();
  if (enableInspector) {
    setInspectorOpen((prev) => !prev);
  }
  return;
}
```

Note: `enableInspector` is available in the closure. `setInspectorOpen` is already in the dependency array for other uses.

**Step 2: Add `enableInspector` and `setInspectorOpen` to the useEffect dependency array if not already present**

Check the dependency list at lines 2724-2733. `setInspectorOpen` should already be stable (it's a `useCallback`). `enableInspector` may need to be added.

**Step 3: Commit**

```
git commit -m "feat(inspector): add Cmd+J keyboard shortcut to toggle inspector"
```

---

### Task 8: Add Inspector persistence to grid preferences store

**Files:**
- Modify: `src/components/DataGrid/stores/gridPreferencesStore.ts`
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx`
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`

**Step 1: Extend GridPreferences interface**

In `gridPreferencesStore.ts`, add to the `GridPreferences` interface (after `structureSearch`):

```ts
/** Inspector panel state */
inspector?: {
  open: boolean;
  tab: string;
};
```

**Step 2: Add setInspector action**

Add to `GridPreferencesState` interface:

```ts
setInspector: (gridId: string, inspector: { open: boolean; tab: string } | undefined) => void;
```

Add implementation following the `setQuickFilter` pattern:

```ts
setInspector: (gridId, inspector) => {
  set((state) => {
    const prefs =
      state.preferences[gridId] ?? createDefaultPreferences();
    if (!state.preferences[gridId]) {
      state.preferences[gridId] = prefs as any;
    }
    prefs.inspector = inspector;
    prefs.updatedAt = Date.now();
  }, false, `gridPreferences/setInspector:${gridId}`);
},
```

**Step 3: Read persisted state in SqlDataGrid**

In `SqlDataGrid.tsx`, replace the `useState(false)` for `showInspector` with reading from preferences:

```ts
const gridId = `${connectionId}:${database}:${schema}:${table}`;
const persistedInspector = useGridPreferencesStore(
  (s) => s.preferences[gridId]?.inspector,
);
const [showInspector, setShowInspector] = useState(
  () => persistedInspector?.open ?? false,
);
```

**Step 4: Persist on change**

Add an effect in SqlDataGrid to write back:

```ts
const setInspectorPrefs = useGridPreferencesStore((s) => s.setInspector);
// Persist inspector state on change (debounce not needed - infrequent)
useEffect(() => {
  setInspectorPrefs(gridId, { open: showInspector, tab: activeInspectorTab });
}, [gridId, showInspector, activeInspectorTab, setInspectorPrefs]);
```

Note: `activeInspectorTab` will need to be threaded from InspectorPanel via `onTabChange` callback through BaseDataGrid.

**Step 5: Commit**

```
git commit -m "feat(inspector): persist inspector open state and active tab per grid"
```

---

### Task 9: Update SqlDataGrid and DocumentDataGrid adapters

**Files:**
- Modify: `src/components/DataGrid/adapters/SqlDataGrid.tsx`
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx`

**Step 1: Update SqlDataGrid**

- Remove any baseline-related state or props
- The `showInspector` toggle button stays as-is (lines 988-1002)
- Pass `onCellEdit` callback to BaseDataGrid that synthesizes edit commands:

For `onCellEdit`, the Inspector will fire `(rowIndexes: number[], field: string, value: unknown)`. The adapter needs to convert this into CRUD edit commands. The simplest approach is to expose this as a new prop on BaseDataGrid (`onInspectorCellEdit`), and in BaseDataGrid, loop through the row indexes and call `handleCellEditCommit` for each.

Alternatively, simpler: pass the `onCellEdit` directly to the InspectorPanel, which calls back to the adapter. The adapter then uses the existing CRUD command factory to stage edits.

**Step 2: Update DocumentDataGrid**

Same pattern — remove baseline props, ensure inspector works with document paradigm. DocumentDataGrid may not need `onCellEdit` initially since it has its own editing mechanism.

**Step 3: Commit**

```
git commit -m "feat(inspector): update SQL and Document adapters for new inspector props"
```

---

### Task 10: Wire up Inspector tree view editing to CRUD pipeline

**Files:**
- Modify: `src/components/DataGrid/base/BaseDataGrid.tsx`

**Context:**
- The existing edit pipeline at `BaseDataGrid.tsx:1777-1836` takes `GridEditCommitEvent` and routes through `commandFactory.createEditCommand()` → `stageCommand()`
- Inspector editing needs to construct `GridEditCommitEvent` for each selected row and push through the same pipeline

**Step 1: Add `onInspectorCellEdit` handler in BaseDataGrid**

Create a callback that takes `(rowIndexes: number[], field: string, value: unknown)`:

```ts
const handleInspectorCellEdit = useCallback(
  (rowIndexes: number[], field: string, value: unknown) => {
    if (readOnly) return;

    // Find the column by field name
    const column = finalColumns.find((col) => col.field === field);
    if (!column) return;
    const colIndex = finalColumns.indexOf(column);

    for (const rowIdx of rowIndexes) {
      const row = effectiveDisplayRows[rowIdx];
      if (!row) continue;

      // Construct a GridEditCommitEvent compatible with the CRUD pipeline
      const event: GridEditCommitEvent = {
        cell: [colIndex, rowIdx],
        rowIndex: rowIdx,
        columnIndex: colIndex,
        column,
        row,
        newValue: { kind: GridCellKind.Text, data: String(value), displayData: String(value), allowOverlay: true },
        previousValue: extractCellValue(row[field]),
      };

      handleCellEditCommit(event);
    }
  },
  [readOnly, finalColumns, effectiveDisplayRows, handleCellEditCommit],
);
```

Pass `handleInspectorCellEdit` as `onCellEdit` to the InspectorPanel.

**Step 2: Commit**

```
git commit -m "feat(inspector): wire tree view editing to CRUD command pipeline"
```

---

### Task 11: Delete old InspectorPanel and update imports

**Files:**
- Delete: `src/components/DataGrid/components/InspectorPanel.tsx`
- Verify: all imports point to `inspector/` module

**Step 1: Delete old file**

```bash
rm src/components/DataGrid/components/InspectorPanel.tsx
```

**Step 2: Search for any remaining imports of old path**

```bash
grep -r "InspectorPanel" src/components/DataGrid/ --include="*.ts" --include="*.tsx"
```

Fix any remaining references to point to `./inspector` or `../components/inspector`.

**Step 3: Commit**

```
git commit -m "refactor(inspector): remove old InspectorPanel, clean up imports"
```

---

### Task 12: Run verification

**Step 1: TypeScript check**

```bash
pnpm typecheck
```

Expected: 0 errors (or only pre-existing errors unrelated to Inspector)

**Step 2: Lint check**

```bash
pnpm lint
```

Expected: 0 new errors

**Step 3: Fix any issues found**

Iterate until clean.

**Step 4: Final commit**

```
git commit -m "fix(inspector): resolve typecheck and lint issues from redesign"
```

---

## File Summary

| Action | File |
|--------|------|
| Create | `src/components/DataGrid/components/inspector/types.ts` |
| Create | `src/components/DataGrid/components/inspector/utils.ts` |
| Create | `src/components/DataGrid/components/inspector/InspectorTreeView.tsx` |
| Create | `src/components/DataGrid/components/inspector/InspectorDiffView.tsx` |
| Create | `src/components/DataGrid/components/inspector/InspectorRawView.tsx` |
| Create | `src/components/DataGrid/components/inspector/InspectorPanel.tsx` |
| Create | `src/components/DataGrid/components/inspector/index.ts` |
| Modify | `src/components/DataGrid/base/BaseDataGrid.tsx` |
| Modify | `src/components/DataGrid/stores/gridPreferencesStore.ts` |
| Modify | `src/components/DataGrid/adapters/SqlDataGrid.tsx` |
| Modify | `src/components/DataGrid/adapters/DocumentDataGrid.tsx` |
| Delete | `src/components/DataGrid/components/InspectorPanel.tsx` |
