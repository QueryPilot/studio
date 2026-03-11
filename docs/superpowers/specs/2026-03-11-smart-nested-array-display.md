# Smart Nested Array Display

## Problem

When drilling into a nested array in the DocumentDataGrid, all arrays display as a fixed 2-column layout (`Index | Value`) regardless of content. Arrays of homogeneous objects would be far more useful displayed as a table with object keys as columns. Mixed-type arrays lack type visibility.

## Array Display Modes

### Mode 1: Table Mode

Used when the array contains objects with sufficient schema overlap.

```
| name    | age | address          | tags        |
|---------|-----|------------------|-------------|
| Alice   | 30  | {street, city}   | ["admin"]   |
| Bob     | 25  | {street, city}   | undefined   |
```

- **All** unique fields across all objects become columns (no fields omitted)
- Objects missing a field show `undefined`/empty in that cell
- Nested objects/arrays in cells remain drillable (same behavior as root-level document grid)

### Mode 2: Typed Value Mode

Used for mixed-type arrays or primitive arrays.

```
| Index | Type   | Value              |
|-------|--------|--------------------|
| 0     | number | 42                 |
| 1     | string | "hello"            |
| 2     | object | {name: "foo"}      |  ← drillable
| 3     | array  | [1, 2, 3]          |  ← drillable
```

- Adds a `Type` column compared to the current `Index | Value` layout
- Objects and arrays in the Value column remain drillable

## Detection Logic

1. Check if all items in the array are plain objects (not arrays, not primitives, not null)
2. If yes: collect all unique field names across all objects, count how many objects contain each field
3. If >= 2 fields appear in >= 80% of the objects → **Table Mode** with all fields as columns
4. Otherwise → **Typed Value Mode**

The 80% threshold determines whether to enter Table Mode, not which fields to show. Once in Table Mode, every field is shown.

## Worker Offloading

Schema analysis can be expensive for large arrays (iterating all items, collecting field frequencies).

- **Threshold:** > 200 items → delegate analysis to a web worker
- **Worker file:** `src/workers/arraySchemaAnalysis.worker.ts`
- **Worker interface:**
  - Receives: `{ id, items: unknown[] }`
  - Returns: `{ id, mode: 'table' | 'typed-value', columns: string[] }` where `columns` is the ordered list of all unique fields (Table Mode) or empty (Typed Value Mode)
- **While analyzing:** Show loading state (existing `isLoading` spinner behavior)
- **For <= 200 items:** Analyze synchronously on the main thread

## Hook Design

New hook: `src/components/DataGrid/hooks/useNestedArrayLayout.ts`

- **Input:** `items: unknown[]` (the resolved array items from the nested query), `enabled: boolean`
- **Output:** `{ mode: 'table' | 'typed-value', columns: string[], isAnalyzing: boolean }`
- Manages worker lifecycle, handles the sync/async threshold split
- Returns stable column list (memoized to prevent re-renders when items haven't changed)

## Integration with useDocumentData

The existing array path in `useDocumentData`:
- `generateColumnsForArrayItems()` currently always returns `[__index, __value]`
- The nested query wraps array items as `{ __index, __value }`

With this change:
- When `useNestedArrayLayout` returns `mode: 'table'`, generate columns from the layout's `columns` list and build rows by extracting each field from each object directly
- When `useNestedArrayLayout` returns `mode: 'typed-value'`, generate 3 columns (`Index`, `Type`, `Value`) and build rows with type detection per item
- Drill-down (`canStepInto`, `stepInto`) continues to work — in Table Mode, clicking a cell with an object/array value drills into it using the column field as the path segment

## Files Modified

- `src/components/DataGrid/hooks/useDocumentData.ts` — replace array column/row generation with layout-aware logic
- `src/components/DataGrid/utils/documentCellFactory.ts` — add `generateColumnsForTableMode` and `generateColumnsForTypedValueMode` (or update existing `generateColumnsForArrayItems`)

## Files Created

- `src/workers/arraySchemaAnalysis.worker.ts` — schema detection worker
- `src/components/DataGrid/hooks/useNestedArrayLayout.ts` — hook for array layout detection + worker orchestration
