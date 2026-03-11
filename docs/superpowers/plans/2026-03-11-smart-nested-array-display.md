# Smart Nested Array Display Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display nested arrays intelligently — as a table when items are homogeneous objects, or as a typed index/value list for mixed content.

**Architecture:** Add a `useNestedArrayLayout` hook that analyzes array items (via worker for >200 items) to determine display mode. Replace the hardcoded `generateColumnsForArrayItems()` call in `useDocumentData` with layout-aware column/row generation. The existing drill-down, search, and inspector all continue working unchanged.

**Tech Stack:** React 19, Vite web workers, existing GridColumnV2/GridRowModel types

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/workers/arraySchemaAnalysis.worker.ts` | Create | Analyze array items, compute field frequencies, determine mode |
| `src/components/DataGrid/hooks/useNestedArrayLayout.ts` | Create | Hook wrapping worker + sync analysis, returns mode/columns |
| `src/components/DataGrid/hooks/useDocumentData.ts` | Modify | Use layout hook for array columns/rows, update stepInto for table mode |
| `src/components/DataGrid/utils/documentCellFactory.ts` | Modify | Add typed-value column generator (3 columns: Index, Type, Value) |

---

## Chunk 1: Schema Analysis Worker

### Task 1: Create arraySchemaAnalysis worker

**Files:**
- Create: `src/workers/arraySchemaAnalysis.worker.ts`

- [ ] **Step 1: Create the worker**

```typescript
/**
 * Web Worker for analyzing array item schemas.
 * Determines whether an array of items should display as a table
 * (homogeneous objects) or typed-value list (mixed types).
 */

export interface ArraySchemaRequest {
  id: number;
  items: unknown[];
}

export type ArrayLayoutMode = 'table' | 'typed-value';

export interface ArraySchemaResponse {
  id: number;
  mode: ArrayLayoutMode;
  /** All unique field names across objects (table mode) or empty (typed-value) */
  columns: string[];
}

const SCHEMA_OVERLAP_THRESHOLD = 0.8;
const MIN_TABLE_COLUMNS = 2;

/**
 * Analyze array items and determine display mode.
 * Exported for reuse in sync path on main thread.
 */
export function analyzeArraySchema(items: unknown[]): { mode: ArrayLayoutMode; columns: string[] } {
  if (items.length === 0) {
    return { mode: 'typed-value', columns: [] };
  }

  // Check if all items are plain objects (not arrays, not null, not primitives)
  const allObjects = items.every(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  );

  if (!allObjects) {
    return { mode: 'typed-value', columns: [] };
  }

  // Count field frequencies across all objects
  const fieldCounts = new Map<string, number>();
  const totalItems = items.length;

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    }
  }

  // Check how many fields pass the threshold
  const threshold = totalItems * SCHEMA_OVERLAP_THRESHOLD;
  let passingFields = 0;
  for (const count of fieldCounts.values()) {
    if (count >= threshold) {
      passingFields++;
    }
  }

  // Need at least MIN_TABLE_COLUMNS fields passing threshold to use table mode
  if (passingFields < MIN_TABLE_COLUMNS) {
    return { mode: 'typed-value', columns: [] };
  }

  // Table mode: return ALL unique fields (sorted: high-frequency first, then alphabetical)
  const columns = [...fieldCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  return { mode: 'table', columns };
}

self.onmessage = (event: MessageEvent<ArraySchemaRequest>) => {
  const { id, items } = event.data;
  const result = analyzeArraySchema(items);
  const response: ArraySchemaResponse = { id, ...result };
  self.postMessage(response);
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/workers/arraySchemaAnalysis.worker.ts
git commit -m "feat: add array schema analysis worker for nested array display"
```

---

### Task 2: Create useNestedArrayLayout hook

**Files:**
- Create: `src/components/DataGrid/hooks/useNestedArrayLayout.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  analyzeArraySchema,
  type ArraySchemaRequest,
  type ArraySchemaResponse,
  type ArrayLayoutMode,
} from '@/workers/arraySchemaAnalysis.worker';

const WORKER_THRESHOLD = 200;

export interface NestedArrayLayout {
  mode: ArrayLayoutMode;
  /** All unique field names for table mode, empty for typed-value */
  columns: string[];
  /** True while worker is analyzing (only for large arrays) */
  isAnalyzing: boolean;
}

const EMPTY_LAYOUT: NestedArrayLayout = {
  mode: 'typed-value',
  columns: [],
  isAnalyzing: false,
};

/**
 * Analyzes array items to determine the best display layout.
 * Offloads to a web worker for arrays > WORKER_THRESHOLD items.
 */
export function useNestedArrayLayout(
  items: unknown[] | undefined,
  enabled: boolean,
): NestedArrayLayout {
  const [workerLayout, setWorkerLayout] = useState<NestedArrayLayout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const prevItemsRef = useRef<unknown[] | undefined>(undefined);

  // Lazy worker initialization
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('@/workers/arraySchemaAnalysis.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current.onmessage = (event: MessageEvent<ArraySchemaResponse>) => {
        const { id, mode, columns } = event.data;
        if (id === requestIdRef.current) {
          setWorkerLayout({ mode, columns, isAnalyzing: false });
        }
      };
    }
    return workerRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Sync analysis for small arrays (computed during render)
  const syncLayout = useMemo<NestedArrayLayout | null>(() => {
    if (!enabled || !items || items.length === 0) {
      return EMPTY_LAYOUT;
    }
    if (items.length <= WORKER_THRESHOLD) {
      const result = analyzeArraySchema(items);
      return { ...result, isAnalyzing: false };
    }
    return null; // Large array — handled by worker
  }, [enabled, items]);

  // Dispatch worker for large arrays
  useEffect(() => {
    if (!enabled || !items || items.length <= WORKER_THRESHOLD) {
      return;
    }

    // Skip if same items reference
    if (items === prevItemsRef.current) {
      return;
    }
    prevItemsRef.current = items;

    const id = ++requestIdRef.current;
    setWorkerLayout({ mode: 'typed-value', columns: [], isAnalyzing: true }); // eslint-disable-line react-hooks/set-state-in-effect
    const worker = getWorker();
    const request: ArraySchemaRequest = { id, items };
    worker.postMessage(request);
  }, [enabled, items, getWorker]);

  // Return sync result if available, otherwise worker result
  if (syncLayout !== null) {
    return syncLayout;
  }
  return workerLayout ?? { mode: 'typed-value', columns: [], isAnalyzing: true };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/hooks/useNestedArrayLayout.ts
git commit -m "feat: add useNestedArrayLayout hook with worker offloading"
```

---

## Chunk 2: Integrate Layout Into useDocumentData

### Task 3: Add typed-value column generator to documentCellFactory

**Files:**
- Modify: `src/components/DataGrid/utils/documentCellFactory.ts`

- [ ] **Step 1: Add generateColumnsForTypedValueMode**

Add this function after the existing `generateColumnsForArrayItems()` function:

```typescript
/**
 * Generate columns for typed-value mode (Index | Type | Value)
 * Used when array items are mixed types or primitives.
 */
export function generateColumnsForTypedValueMode(): GridColumnV2[] {
  return [
    {
      id: '__index',
      field: '__index',
      title: 'Index',
      name: 'Index',
      width: 80,
      meta: {
        name: '__index',
        db_type: 'integer',
        nullable: false,
        default: null,
        is_pk: true,
        is_fk: false,
        ordinal: 0,
      },
    },
    {
      id: '__type',
      field: '__type',
      title: 'Type',
      name: 'Type',
      width: 100,
      meta: {
        name: '__type',
        db_type: 'text',
        nullable: false,
        default: null,
        is_pk: false,
        is_fk: false,
        ordinal: 1,
      },
    },
    {
      id: '__value',
      field: '__value',
      title: 'Value',
      name: 'Value',
      width: 400,
      meta: {
        name: '__value',
        db_type: 'any',
        nullable: true,
        default: null,
        is_pk: false,
        is_fk: false,
        ordinal: 2,
      },
    },
  ];
}

/**
 * Generate columns for table mode (one column per object field).
 * Used when array items are homogeneous objects.
 */
export function generateColumnsForTableMode(fieldNames: string[]): GridColumnV2[] {
  return fieldNames.map((field, index) => ({
    id: field,
    field,
    title: field,
    name: field,
    width: Math.max(120, Math.min(300, field.length * 10 + 40)),
    meta: {
      name: field,
      db_type: 'any',
      nullable: true,
      default: null,
      is_pk: false,
      is_fk: false,
      ordinal: index,
    },
  }));
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/utils/documentCellFactory.ts
git commit -m "feat: add column generators for table and typed-value array modes"
```

---

### Task 4: Wire layout into useDocumentData columns and rows

**Files:**
- Modify: `src/components/DataGrid/hooks/useDocumentData.ts`

This is the core integration task. We need to:
1. Import and call `useNestedArrayLayout`
2. Replace the `generateColumnsForArrayItems()` call with layout-aware logic
3. Build rows differently based on mode
4. Update `stepInto` for table mode

- [ ] **Step 1: Add imports**

At the top of `useDocumentData.ts`, add:

```typescript
import { useNestedArrayLayout } from './useNestedArrayLayout';
import {
  generateColumnsForTypedValueMode,
  generateColumnsForTableMode,
} from '../utils/documentCellFactory';
```

Remove `generateColumnsForArrayItems` from the existing import since it will be replaced.

- [ ] **Step 2: Call useNestedArrayLayout**

After the `isNestedSingleObject` memo (around line 509), add:

```typescript
// Determine array display layout (table vs typed-value)
const isArrayLevel = useMemo(() => {
  if (currentPath.length === 0) return false;
  const lastSegment = currentPath[currentPath.length - 1];
  return lastSegment?.type === 'array';
}, [currentPath]);

// Extract raw array items for schema analysis
// nestedDocuments has shape [{ __index, __value }, ...] for arrays
const arrayItems = useMemo(() => {
  if (!isArrayLevel || !nestedDocuments) return undefined;
  return nestedDocuments.map((doc: Record<string, unknown>) => doc.__value);
}, [isArrayLevel, nestedDocuments]);

const arrayLayout = useNestedArrayLayout(arrayItems, isArrayLevel);
```

- [ ] **Step 3: Update the columns memo**

Replace the existing array branch in the `columns` useMemo:

```typescript
// Old code:
// if (currentPath.length > 0) {
//   const lastSegment = currentPath[currentPath.length - 1];
//   if (lastSegment && lastSegment.type === 'array') {
//     return generateColumnsForArrayItems();
//   }
// }

// New code:
if (isArrayLevel) {
  if (arrayLayout.mode === 'table') {
    return generateColumnsForTableMode(arrayLayout.columns);
  }
  return generateColumnsForTypedValueMode();
}
```

Add `isArrayLevel` and `arrayLayout` to the useMemo dependency array. Remove `generateColumnsForArrayItems` from dependencies since it's no longer called.

- [ ] **Step 4: Update the rows memo**

In the `rows` useMemo, add a branch for array layout modes before the existing generic row builder. This goes after the KV mode branch and before the generic `filteredDocs.map`:

```typescript
// Array table mode: each object item becomes a row with field columns
if (isArrayLevel && arrayLayout.mode === 'table' && filteredDocs.length > 0) {
  return filteredDocs.map((doc) => {
    const item = (doc as Record<string, unknown>).__value;
    const obj = (typeof item === 'object' && item !== null && !Array.isArray(item))
      ? item as Record<string, unknown>
      : {};
    const row: GridRowModel = {};
    for (const col of columns) {
      const value = obj[col.field];
      const valueType = detectDocumentValueType(value);
      row[col.field] = {
        value: value === undefined ? undefined : value,
        db_type: valueType,
        value_type: mapDocumentValueTypeToGrid(valueType),
        is_truncated: false,
      };
    }
    return row;
  });
}

// Array typed-value mode: Index | Type | Value
if (isArrayLevel && arrayLayout.mode === 'typed-value' && filteredDocs.length > 0) {
  return filteredDocs.map((doc) => {
    const d = doc as Record<string, unknown>;
    const rawValue = d.__value;
    const valueType = detectDocumentValueType(rawValue);
    return {
      __index: {
        value: d.__index,
        db_type: 'number',
        value_type: 'Integer' as GridCellValueType,
        is_truncated: false,
      },
      __type: {
        value: valueType,
        db_type: 'string',
        value_type: 'Text' as GridCellValueType,
        is_truncated: false,
      },
      __value: {
        value: rawValue,
        db_type: valueType,
        value_type: mapDocumentValueTypeToGrid(valueType),
        is_truncated: false,
      },
    } as GridRowModel;
  });
}
```

Add `isArrayLevel` and `arrayLayout` to the useMemo dependency array.

- [ ] **Step 5: Update stepInto for table mode**

In the `stepInto` callback, the existing array logic (around line 729) uses `rowData.__index` to get the array index. In table mode, there's no `__index` column — we need to determine the array index differently.

Add a branch for table mode before the existing `isArrayLevel` check in `stepInto`:

```typescript
// Table mode: drill into a cell's object/array value
// The path segment uses the column field name, but we also need the array index
// to resolve the correct item in the nested query
const isArrayLevelNav = currentPath.length > 0 && currentPath[currentPath.length - 1]?.type === 'array';
if (isArrayLevelNav && arrayLayout.mode === 'table') {
  // In table mode, each row IS an object — drill into a nested field
  // First, push the array index segment, then the field segment
  const rowIndex = event.rowIndex;
  const fieldType: PathSegment['type'] = valueType === 'array' ? 'array' : 'object';

  setCurrentPath((prev) => [
    ...prev,
    { key: rowIndex, label: `[${rowIndex}]`, type: 'object' },
    { key: column.field, label: column.field, type: fieldType },
  ]);
  return;
}
```

Place this after the KV-mode branch and before the existing generic `stepInto` logic. Add `arrayLayout` to the `stepInto` dependency array.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Run lint**

Run: `pnpm lint`
Expected: No new errors in our modified files

- [ ] **Step 8: Commit**

```bash
git add src/components/DataGrid/hooks/useDocumentData.ts
git commit -m "feat(document-grid): smart array display with table and typed-value modes"
```

---

## Chunk 3: Cleanup and Verification

### Task 5: Remove deprecated generateColumnsForArrayItems

**Files:**
- Modify: `src/components/DataGrid/utils/documentCellFactory.ts`
- Modify: `src/components/DataGrid/hooks/useDocumentData.ts`

- [ ] **Step 1: Check if generateColumnsForArrayItems is used anywhere else**

Run: `grep -r "generateColumnsForArrayItems" src/ --include="*.ts" --include="*.tsx"`

If only referenced in `useDocumentData.ts` and `documentCellFactory.ts`, it's safe to remove.

- [ ] **Step 2: Remove the function from documentCellFactory.ts**

Delete the `generateColumnsForArrayItems` function from `documentCellFactory.ts` (the old 2-column Index/Value generator).

- [ ] **Step 3: Remove the import from useDocumentData.ts**

Remove `generateColumnsForArrayItems` from the import statement.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/DataGrid/utils/documentCellFactory.ts src/components/DataGrid/hooks/useDocumentData.ts
git commit -m "refactor: remove deprecated generateColumnsForArrayItems"
```

---

### Task 6: Final verification

**Files:**
- No modifications, verification only

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint on changed files**

Run: `npx eslint src/components/DataGrid/hooks/useDocumentData.ts src/components/DataGrid/hooks/useNestedArrayLayout.ts src/components/DataGrid/utils/documentCellFactory.ts src/workers/arraySchemaAnalysis.worker.ts --ext ts,tsx`

Expected: No new errors (pre-existing warnings are OK)

- [ ] **Step 3: Run tests**

Run: `pnpm test:unit`
Expected: All tests pass

- [ ] **Step 4: Fix any issues and commit if needed**

```bash
git add -A
git commit -m "fix: resolve lint/type issues in smart array display"
```
