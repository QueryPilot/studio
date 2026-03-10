# DocumentDataGrid Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the DocumentDataGrid toolbar to essentials (BreadcrumbNav, QuickFilter, Flatten, Inspector), add key-value view for nested single objects, and enable client-side search with worker offloading in nested views.

**Architecture:** Remove 6 toolbar features and ~200 lines of dead state/handlers. Add a `isNestedSingleObject` signal from `useDocumentData` to switch between columnar and key-value rendering. Add a web worker for search on large nested datasets (>1000 rows). Create a combined `FlattenControl` component with popover depth selector.

**Tech Stack:** React 19, Zustand, shadcn/ui Popover, Vite web worker imports, Glide Data Grid

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/DataGrid/adapters/DocumentDataGrid.tsx` | Modify | Remove 6 features, rewrite toolbar layout, add KV view logic |
| `src/components/DataGrid/hooks/useDocumentData.ts` | Modify | Expose `isNestedSingleObject` flag, transform single objects to KV rows |
| `src/components/DataGrid/components/FlattenControl.tsx` | Create | Combined flatten toggle + depth popover |
| `src/workers/gridSearch.worker.ts` | Create | Web worker for client-side search on large datasets |
| `src/components/DataGrid/hooks/useGridSearchWorker.ts` | Create | Hook wrapping the search worker with debounce |

---

## Chunk 1: Strip Toolbar and Rewrite Layout

### Task 1: Remove dead features from DocumentCollectionDataGrid

**Files:**
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx`

- [ ] **Step 1: Remove dead state and handlers**

Remove these state declarations and their handlers from `DocumentCollectionDataGrid`:

```tsx
// DELETE these state declarations (lines 192-208):
const [objectIdJump, setObjectIdJump] = useState("");
const [planHint, setPlanHint] = useState<string | null>(null);
const [savedViews, setSavedViews] = useState<DocumentGridView[]>(() => { ... });

// DELETE savedViewStorageKey and its persistence effect (lines 239-243):
const savedViewStorageKey = `querypilot.document-grid.views.${gridId}`;
useEffect(() => { ... }, [savedViews, savedViewStorageKey]);

// DELETE these handlers (lines 284-357):
// handleSaveView
// handleApplyView
// handleJumpToObjectId
// handleAnalyzeQuery
```

- [ ] **Step 2: Remove dead imports**

Remove unused imports from the top of the file:

```tsx
// From @tabler/icons-react, remove: IconSparkles, IconChevronRight, IconPlus
// Remove: Input (from @/components/ui/input) — if only used for ObjectId/Depth inputs
// Remove: Badge (from @/components/ui/badge)
// Remove: toast (from sonner) — if only used by deleted handlers
// Remove: openCollectionDesigner (from @/utils/workbench/openers)
// Remove: MongoDBAdapter (from @/adapters/mongodb/MongoDBAdapter)
```

Keep `IconBrackets` (used by FlattenControl later). Keep `Button`. Keep `toast` only if used elsewhere in file.

- [ ] **Step 3: Remove the DocumentGridView interface**

Delete the `DocumentGridView` interface (lines 91-98) — no longer used.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors in DocumentDataGrid.tsx (existing errors elsewhere are OK)

- [ ] **Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/DocumentDataGrid.tsx
git commit -m "refactor(document-grid): remove dead toolbar features and state"
```

---

### Task 2: Create FlattenControl component

**Files:**
- Create: `src/components/DataGrid/components/FlattenControl.tsx`

- [ ] **Step 1: Create FlattenControl**

```tsx
import { memo } from "react";
import { IconBrackets } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FlattenControlProps {
  enabled: boolean;
  depth: number;
  onToggle: () => void;
  onDepthChange: (depth: number) => void;
}

export const FlattenControl = memo(function FlattenControl({
  enabled,
  depth,
  onToggle,
  onDepthChange,
}: FlattenControlProps) {
  return (
    <Popover>
      <div className="flex items-center">
        <Button
          size="sm"
          variant={enabled ? "default" : "outline"}
          className="h-7 text-[11px] rounded-r-none"
          onClick={onToggle}
        >
          <IconBrackets className="h-3.5 w-3.5 mr-1" />
          {enabled ? `Flat: ${depth}` : "Nested"}
        </Button>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={enabled ? "default" : "outline"}
            className="h-7 w-6 px-0 rounded-l-none border-l-0"
          >
            <span className="text-[10px]">▾</span>
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-40 p-2" align="end">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Depth</span>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 text-[11px]"
              disabled={depth <= 1}
              onClick={() => onDepthChange(Math.max(1, depth - 1))}
            >
              -
            </Button>
            <span className="w-5 text-center text-[11px] font-mono">
              {depth}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 text-[11px]"
              disabled={depth >= 6}
              onClick={() => onDepthChange(Math.min(6, depth + 1))}
            >
              +
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (new file compiles)

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/components/FlattenControl.tsx
git commit -m "feat(document-grid): add FlattenControl component with depth popover"
```

---

### Task 3: Rewrite toolbar layout

**Files:**
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx`

- [ ] **Step 1: Import FlattenControl**

Add import at top of file:

```tsx
import { FlattenControl } from "../components/FlattenControl";
```

- [ ] **Step 2: Rewrite topToolbar JSX**

Replace the entire `topToolbar` const (lines 396-591) with the new streamlined layout:

```tsx
const topToolbar = (
  <div className="flex flex-col gap-1.5 mb-1.5 p-1">
    {/* Row 1: BreadcrumbNav (only when drilled in) */}
    {data.currentPath.length > 0 && (
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <BreadcrumbNav
            path={data.currentPath}
            collectionName={collection}
            documentId={data.getCurrentDocumentId()}
            onNavigate={data.navigateToPath}
            onNavigateToRoot={() => data.navigateToPath(-1)}
            onStepOut={data.stepOut}
          />
        </div>
        <FlattenControl
          enabled={flattenMode}
          depth={flattenDepth}
          onToggle={() => setFlattenMode((prev) => !prev)}
          onDepthChange={setFlattenDepth}
        />
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => setShowInspector((prev) => !prev)}
        >
          {showInspector ? (
            <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
          ) : (
            <IconLayoutSidebarRightExpand className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    )}

    {/* Row 2 (or Row 1 at root): QuickFilter + controls */}
    {data.currentPath.length === 0 && filterColumns.length > 0 ? (
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <QuickFilter
            ref={quickFilterRef}
            columns={filterColumns}
            value={quickFilter.value}
            mode={quickFilter.mode}
            onValueChange={quickFilter.setValue}
            onModeChange={handleModeChange}
            onSubmit={handleFilterSubmit}
            onClear={quickFilter.clear}
            error={filterError}
            explanation={quickFilter.aiExplanation}
            isLoading={false}
            searchModeOnly={false}
            clientSideFiltering={false}
          />
        </div>
        <FlattenControl
          enabled={flattenMode}
          depth={flattenDepth}
          onToggle={() => setFlattenMode((prev) => !prev)}
          onDepthChange={setFlattenDepth}
        />
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => setShowInspector((prev) => !prev)}
        >
          {showInspector ? (
            <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
          ) : (
            <IconLayoutSidebarRightExpand className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    ) : data.currentPath.length === 0 ? (
      /* Root level but no columns yet - just show controls */
      <div className="flex justify-end gap-2">
        <FlattenControl
          enabled={flattenMode}
          depth={flattenDepth}
          onToggle={() => setFlattenMode((prev) => !prev)}
          onDepthChange={setFlattenDepth}
        />
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          onClick={() => setShowInspector((prev) => !prev)}
        >
          {showInspector ? (
            <IconLayoutSidebarRightCollapse className="h-3.5 w-3.5" />
          ) : (
            <IconLayoutSidebarRightExpand className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    ) : null}
  </div>
);
```

Note: The nested path search row (QuickFilter in client-only mode) will be added in Task 6 after the search worker is ready.

- [ ] **Step 3: Clean up now-unused IconBrackets import**

Remove `IconBrackets` from the imports at line 16 since it's now only used in `FlattenControl.tsx`.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/DataGrid/adapters/DocumentDataGrid.tsx
git commit -m "refactor(document-grid): rewrite toolbar to single-row streamlined layout"
```

---

## Chunk 2: Key-Value View for Nested Single Objects

### Task 4: Expose isNestedSingleObject from useDocumentData

**Files:**
- Modify: `src/components/DataGrid/hooks/useDocumentData.ts`
- Modify: `src/components/DataGrid/sources/types.ts`

- [ ] **Step 1: Add isNestedSingleObject to DocumentDataHookResult**

In `src/components/DataGrid/sources/types.ts`, add to `DocumentDataHookResult`:

```tsx
export interface DocumentDataHookResult extends BaseDataHookResult {
  // ... existing fields ...

  /** True when drilled into a single object (not array) — renders as key-value */
  isNestedSingleObject: boolean;
}
```

- [ ] **Step 2: Add detection logic in useDocumentData**

In `src/components/DataGrid/hooks/useDocumentData.ts`, the nested query at lines 316-359 resolves the drilled path. Currently at line 348, a single object gets wrapped as `[current as DocumentWithId]`. We need to track what type was resolved.

Add a state variable after the existing `nestedDocuments` query:

```tsx
// After the useQuery for nested data (line 359), add:
const isNestedSingleObject = useMemo(() => {
  if (currentPath.length === 0) return false;
  const lastSegment = currentPath[currentPath.length - 1];
  return lastSegment?.type === 'object';
}, [currentPath]);
```

This uses the `PathSegment.type` which is already set correctly when `stepInto` is called — `'object'` for objects, `'array'` for arrays.

- [ ] **Step 3: Transform single object to key-value rows**

In the `columns` memo (lines 500-517), add a branch for single-object key-value mode. When `isNestedSingleObject` is true, generate two columns (`Key` and `Value`) instead of the normal columnar layout:

```tsx
const columns = useMemo<GridColumnV2[]>(() => {
  // Key-value mode for single nested objects
  if (isNestedSingleObject && displayDocuments.length === 1) {
    return [
      { id: '__kv_key', field: '__kv_key', title: 'Key', name: 'Key', width: 200 },
      { id: '__kv_value', field: '__kv_value', title: 'Value', name: 'Value', width: 400 },
    ];
  }

  if (currentPath.length > 0) {
    const lastSegment = currentPath[currentPath.length - 1];
    if (lastSegment && lastSegment.type === 'array') {
      return generateColumnsForArrayItems();
    }
  }

  // ... rest unchanged
}, [displayDocuments, currentPath, isNestedSingleObject]);
```

- [ ] **Step 4: Transform single object to key-value rows**

In the `rows` memo (lines 543-568), add a branch for key-value mode that transforms the single object's entries into rows:

```tsx
const rows = useMemo<GridRowModel[]>(() => {
  let filteredDocs = displayDocuments;
  if (filter?.mode === 'search' && filter.searchText) {
    filteredDocs = applyDocumentColumnSearch(
      displayDocuments as Record<string, unknown>[],
      filter.searchText
    ) as typeof documents;
  }

  // Key-value mode: transform single object entries to rows
  if (isNestedSingleObject && filteredDocs.length === 1) {
    const obj = filteredDocs[0] as Record<string, unknown>;
    return Object.entries(obj).map(([key, value]) => {
      const valueType = detectDocumentValueType(value);
      return {
        __kv_key: {
          value: key,
          db_type: 'string',
          value_type: 'Text' as GridCellValueType,
          is_truncated: false,
        },
        __kv_value: {
          value,
          db_type: valueType,
          value_type: mapToGridCellValueType(valueType),
          is_truncated: false,
        },
      } as GridRowModel;
    });
  }

  // ... rest unchanged (existing row mapping)
}, [displayDocuments, columns, filter, isNestedSingleObject]);
```

- [ ] **Step 5: Update getCellContent for key-value mode**

In the `getCellContent` callback (lines 586-614), add handling for key-value columns:

```tsx
const getCellContent = useCallback(
  (cell: Item, context?: GridCellContentContext): GridCell => {
    const [colIndex, rowIndex] = cell;
    const column = context?.column ?? columns[colIndex];
    const row = context?.row ?? rows[rowIndex];

    if (!column || !row) {
      return {
        kind: GridCellKind.Text,
        data: '',
        displayData: '',
        allowOverlay: false,
        readonly: true,
      };
    }

    // Key-value mode cells
    if (isNestedSingleObject && column.field === '__kv_key') {
      const keyValue = row.__kv_key?.value ?? '';
      return {
        kind: GridCellKind.Text,
        data: String(keyValue),
        displayData: String(keyValue),
        allowOverlay: true,
        readonly: true,
      };
    }

    if (isNestedSingleObject && column.field === '__kv_value') {
      const rawValue = row.__kv_value?.value;
      return buildDocumentCell({
        value: rawValue,
        column,
        readOnly: true,
        canDrillDown: true,
      });
    }

    // Normal mode
    const cellValue = row[column.field];
    const rawValue = cellValue?.value;

    return buildDocumentCell({
      value: rawValue,
      column,
      nullTypeHint: nullTypeHintsByField.get(column.field),
      readOnly: false,
      canDrillDown: true,
    });
  },
  [columns, rows, nullTypeHintsByField, isNestedSingleObject]
);
```

- [ ] **Step 6: Update canStepInto for key-value mode**

In key-value mode, drill-down should work on the `__kv_value` column when the value is an object or array. Update `canStepInto`:

```tsx
const canStepInto = useCallback(
  (event: GridActivationEvent): boolean => {
    const { row, column } = event;
    if (!row) return false;

    // In KV mode, check the __kv_value column
    if (isNestedSingleObject && column.field === '__kv_value') {
      const rawValue = row.__kv_value?.value;
      const valueType = detectDocumentValueType(rawValue);
      return valueType === 'object' || valueType === 'array';
    }

    const rawValue = getRawValueFromRow(row, column);
    const valueType = detectDocumentValueType(rawValue);
    return valueType === 'object' || valueType === 'array';
  },
  [getRawValueFromRow, isNestedSingleObject]
);
```

- [ ] **Step 7: Update stepInto for key-value mode**

In key-value mode, `stepInto` needs to use the `__kv_key` value as the path segment key:

In the `stepInto` callback, add a branch early in the function (after the `canStepInto` check):

```tsx
const stepInto = useCallback(
  (event: GridActivationEvent): void => {
    const { row: rowData, column } = event;
    if (!rowData || !canStepInto(event)) return;

    // Key-value mode: use the key column as the path segment
    if (isNestedSingleObject && column.field === '__kv_value') {
      const keyValue = rowData.__kv_key?.value;
      if (keyValue === undefined || keyValue === null) return;

      const rawValue = rowData.__kv_value?.value;
      const valueType = detectDocumentValueType(rawValue);
      const segmentType: PathSegment['type'] = valueType === 'array' ? 'array' : 'object';

      setCurrentPath((prev) => [
        ...prev,
        { key: String(keyValue), label: String(keyValue), type: segmentType },
      ]);
      return;
    }

    // ... rest of existing stepInto logic unchanged
  },
  [canStepInto, currentPath, getRawValueFromRow, isNestedSingleObject]
);
```

- [ ] **Step 8: Add isNestedSingleObject to return value**

In the return statement (line 1093), add:

```tsx
return {
  // ... existing fields ...
  isNestedSingleObject,
};
```

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/DataGrid/hooks/useDocumentData.ts src/components/DataGrid/sources/types.ts
git commit -m "feat(document-grid): add key-value view for nested single objects"
```

---

## Chunk 3: Client-Side Search with Worker Offloading

### Task 5: Create grid search worker

**Files:**
- Create: `src/workers/gridSearch.worker.ts`

- [ ] **Step 1: Create the search worker**

```tsx
/**
 * Web Worker for filtering grid rows by search term.
 * Used when nested views have >1000 rows to avoid blocking the UI thread.
 */

export interface GridSearchRequest {
  id: number;
  /** Stringified cell values per row: rows[rowIdx][colIdx] = string */
  rowValues: string[][];
  /** Search term (lowercased by caller) */
  searchTerm: string;
}

export interface GridSearchResponse {
  id: number;
  /** Indices of rows that match the search term */
  matchingIndices: number[];
}

self.onmessage = (event: MessageEvent<GridSearchRequest>) => {
  const { id, rowValues, searchTerm } = event.data;

  if (!searchTerm) {
    const response: GridSearchResponse = {
      id,
      matchingIndices: rowValues.map((_, i) => i),
    };
    self.postMessage(response);
    return;
  }

  const matchingIndices: number[] = [];
  const term = searchTerm.toLowerCase();

  for (let i = 0; i < rowValues.length; i++) {
    const row = rowValues[i];
    if (!row) continue;
    for (const cellValue of row) {
      if (cellValue.toLowerCase().includes(term)) {
        matchingIndices.push(i);
        break;
      }
    }
  }

  const response: GridSearchResponse = { id, matchingIndices };
  self.postMessage(response);
};
```

- [ ] **Step 2: Commit**

```bash
git add src/workers/gridSearch.worker.ts
git commit -m "feat: add grid search web worker for large dataset filtering"
```

---

### Task 6: Create useGridSearchWorker hook

**Files:**
- Create: `src/components/DataGrid/hooks/useGridSearchWorker.ts`

- [ ] **Step 1: Create the hook**

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { GridSearchRequest, GridSearchResponse } from "@/workers/gridSearch.worker";
import type { GridRowModel, GridColumnV2 } from "../types";

const WORKER_THRESHOLD = 1000;
const DEBOUNCE_MS = 150;

/**
 * Hook that filters rows by search term, offloading to a web worker
 * when the row count exceeds WORKER_THRESHOLD.
 */
export function useGridSearchWorker(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  searchTerm: string,
): GridRowModel[] {
  const [workerResult, setWorkerResult] = useState<number[] | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stringify row values once (shared between main-thread and worker paths)
  const rowValues = useMemo(() => {
    return rows.map((row) =>
      columns.map((col) => {
        const cell = row[col.field];
        if (!cell || cell.value === null || cell.value === undefined) return "";
        return typeof cell.value === "string"
          ? cell.value
          : JSON.stringify(cell.value);
      }),
    );
  }, [rows, columns]);

  // Initialize worker lazily
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("@/workers/gridSearch.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (event: MessageEvent<GridSearchResponse>) => {
        const { id, matchingIndices } = event.data;
        if (id === requestIdRef.current) {
          setWorkerResult(matchingIndices);
        }
      };
    }
    return workerRef.current;
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Dispatch search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = searchTerm.trim();

    // No search term — return all rows
    if (!trimmed) {
      setWorkerResult(null);
      return;
    }

    // Small dataset — filter on main thread immediately
    if (rows.length <= WORKER_THRESHOLD) {
      const term = trimmed.toLowerCase();
      const indices: number[] = [];
      for (let i = 0; i < rowValues.length; i++) {
        const row = rowValues[i];
        if (!row) continue;
        for (const cellValue of row) {
          if (cellValue.toLowerCase().includes(term)) {
            indices.push(i);
            break;
          }
        }
      }
      setWorkerResult(indices);
      return;
    }

    // Large dataset — debounce and send to worker
    debounceTimerRef.current = setTimeout(() => {
      const id = ++requestIdRef.current;
      const worker = getWorker();
      const request: GridSearchRequest = {
        id,
        rowValues,
        searchTerm: trimmed,
      };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
  }, [searchTerm, rows.length, rowValues, getWorker]);

  // Return filtered rows
  return useMemo(() => {
    if (!searchTerm.trim() || workerResult === null) {
      return rows;
    }
    return workerResult
      .filter((i) => i < rows.length)
      .map((i) => rows[i])
      .filter((r): r is GridRowModel => r !== undefined);
  }, [rows, searchTerm, workerResult]);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/hooks/useGridSearchWorker.ts
git commit -m "feat: add useGridSearchWorker hook with debounce and worker offloading"
```

---

### Task 7: Wire nested search into DocumentDataGrid

**Files:**
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx`

- [ ] **Step 1: Add nested search state**

In `DocumentCollectionDataGrid`, add state for nested search:

```tsx
import { useGridSearchWorker } from "../hooks/useGridSearchWorker";

// Inside the component, after existing state:
const [nestedSearchTerm, setNestedSearchTerm] = useState("");
```

- [ ] **Step 2: Apply search worker to nested data rows**

After the `data` hook is called, filter the rows for nested views:

```tsx
// After the data hook call, add:
const filteredRows = useGridSearchWorker(
  data.rows,
  data.columns,
  data.currentPath.length > 0 ? nestedSearchTerm : "",
);
```

Then use `filteredRows` instead of `data.rows` when passing to `BaseDataGrid`:

```tsx
// In the BaseDataGrid JSX:
rows={data.currentPath.length > 0 ? filteredRows : data.rows}
```

- [ ] **Step 3: Add nested search input to toolbar**

Update the topToolbar to show a search input when in nested views. Add this after the BreadcrumbNav row inside the `data.currentPath.length > 0` branch:

```tsx
{/* Nested search - client-side only */}
{data.currentPath.length > 0 && (
  <div className="flex items-center gap-2">
    <div className="relative flex-1 min-w-0">
      <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        type="text"
        value={nestedSearchTerm}
        onChange={(e) => setNestedSearchTerm(e.target.value)}
        placeholder="Search nested values..."
        className="h-7 w-full rounded border bg-background pl-7 pr-7 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {nestedSearchTerm && (
        <button
          type="button"
          onClick={() => setNestedSearchTerm("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      )}
    </div>
  </div>
)}
```

Import `IconSearch` and `IconX` from `@tabler/icons-react` (check if already imported).

- [ ] **Step 4: Clear nested search on path change**

Add an effect to reset nested search when path changes:

```tsx
useEffect(() => {
  setNestedSearchTerm("");
}, [data.currentPath]);
```

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/DataGrid/adapters/DocumentDataGrid.tsx
git commit -m "feat(document-grid): add client-side search for nested views with worker offloading"
```

---

## Chunk 4: Final Integration and Cleanup

### Task 8: Final integration and verification

**Files:**
- Modify: `src/components/DataGrid/adapters/DocumentDataGrid.tsx` (minor adjustments)

- [ ] **Step 1: Verify all removed imports are clean**

Check that no unused imports remain. Run:

Run: `pnpm lint`
Expected: No new lint errors in DocumentDataGrid.tsx

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run frontend tests**

Run: `pnpm test:unit`
Expected: All existing tests pass (no tests should break from toolbar-only changes)

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(document-grid): final cleanup for toolbar redesign"
```
