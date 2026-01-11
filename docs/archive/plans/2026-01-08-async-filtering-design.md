# React Concurrent Mode for Filtering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement non-blocking UI filtering using React's `useDeferredValue` to solve typing lag in the query results grid.

**Architecture:** Wrap the filter state in `useDeferredValue` within the `TableDataGrid` component. Use the deferred value for the heavy filtering operation while keeping the input responsive to the immediate state. Add a visual indicator (opacity change) to show when filtering is in progress.

**Tech Stack:** React 19 (useDeferredValue), TypeScript

### Task 1: Implement Deferred Filtering in TableDataGrid

**Files:**
- Modify: `src/components/DataGrid/adapters/TableDataGrid.tsx`

**Step 1: Locate relevant code block**
Find the `filteredRows` memoization in `TableDataGrid.tsx` around line 890.

**Step 2: Add useDeferredValue hook**

```typescript
// Inside TableDataGrid component
const deferredFilter = useDeferredValue(activeFilter);
const isFiltering = activeFilter !== deferredFilter;
```

**Step 3: Update filtering logic to use deferred value**

```typescript
// Client-side filtering for query mode
const filteredRows = useMemo(() => {
  if (isTableMode) {
    return rows; // Server-side filtering
  }
  // Client-side filtering for query results
  // Build column name -> key mapping (query mode uses col_N keys)
  const columnKeyMap = new Map<string, string>();
  columnMeta.forEach((col, index) => {
    columnKeyMap.set(col.name, `col_${index}`);
  });

  const columnNames = columnMeta.map((c) => c.name);
  const filterOptions: FilterOptions = {
    columnKeyMap,
    wrappedValues: true, // Query mode wraps values in {value: ...} objects
  };
  
  // Use deferredFilter instead of activeFilter
  return applyClientSideFilter(
    rows,
    deferredFilter, 
    columnNames,
    filterOptions,
  ) as TableDataRow[];
}, [rows, isTableMode, deferredFilter, columnMeta]); // Depend on deferredFilter
```

**Step 4: Add visual feedback for pending state**

Update the grid container or wrapper div to show a loading state when filtering is pending.

```typescript
// Find the div wrapping UnifiedContextMenu or EditableDataGrid
<div 
  className={cn(
    "relative flex-1 outline-none", 
    isFiltering && "opacity-60 transition-opacity duration-200" // Add opacity transition
  )}
  // ... existing props
>
  {/* existing content */}
</div>
```

**Step 5: Verify types**
Ensure `cn` utility is imported from `@/lib/utils` (it likely is).

**Step 6: Verify implementation**
- Run `pnpm typecheck` to ensure no type errors.
- Manual verification: Type quickly in the filter box with a large result set. The input should remain responsive even if the grid lags slightly behind.
