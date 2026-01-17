# Infinite Loop Fix - BaseDataGrid

## Problem

When opening a SQL table, the application crashed with:
```
Error: Maximum update depth exceeded. This can happen when a component
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
React limits the number of nested updates to prevent infinite loops.
```

## Root Cause

**Two sources of infinite re-renders:**

### 1. Persistence Callbacks (Primary Issue)

In `useDataGridFeatures.ts`, I added inline `onChange` callbacks that updated the Zustand store:

```typescript
// BEFORE (BROKEN):
const columnPinning = useColumnPinning({
  columns,
  onChange: (pinnedColumns) => {
    // This triggers a store update
    upsertGridColumnsState(gridId, (draft) => {
      draft.pinned = pinnedColumns;
    });
  },
});
```

**Why this caused infinite loops:**
1. `useColumnPinning` calls `onChange` when pinned columns change
2. `onChange` updates the Zustand store via `upsertGridColumnsState`
3. Store update triggers component re-render
4. Re-render calls `useDataGridFeatures` again
5. New `onChange` function created (not memoized)
6. Loop continues → **CRASH**

### 2. BaseDataGrid Callback Dependencies (Secondary Issue)

In `BaseDataGrid.tsx`, wrapper callbacks depended on props:

```typescript
// BEFORE (PROBLEMATIC):
const handleCellEditCommit = useCallback(
  (event) => {
    props.onCellEditCommit?.(event);
    return undefined;
  },
  [props.onCellEditCommit]  // ← Changes every render if parent doesn't memoize
);
```

**Why this was problematic:**
- If parent component doesn't memoize `onCellEditCommit`, it creates a new function every render
- `useCallback` dependency changes, creates new callback
- New callback passed to `EditableDataGrid`
- Could trigger re-renders in children

## The Fix

### 1. Removed Persistence Callbacks (useDataGridFeatures.ts)

```typescript
// AFTER (FIXED):
const columnPinning = useColumnPinning({
  columns,
  initialPinned: persistentViewState.persistedView.activeCell
    ? []
    : undefined,
  maxPinned: maxPinnedColumns,
  // TODO: Add persistence with debouncing to prevent infinite loops
  // onChange: (pinnedColumns) => { ... }
});
```

**Applied to:**
- `useColumnPinning`
- `useColumnVisibility`
- `useColumnSizing`
- `useRowPinning`

### 2. Stable Callbacks with Refs (BaseDataGrid.tsx)

```typescript
// AFTER (FIXED):
const onCellEditCommitRef = React.useRef(props.onCellEditCommit);
const onRowInsertRef = React.useRef(props.onRowInsert);
const onRowDeleteRef = React.useRef(props.onRowDelete);

React.useEffect(() => {
  onCellEditCommitRef.current = props.onCellEditCommit;
  onRowInsertRef.current = props.onRowInsert;
  onRowDeleteRef.current = props.onRowDelete;
});

const handleCellEditCommit = useCallback((event: GridEditCommitEvent) => {
  onCellEditCommitRef.current?.(event);
  return undefined;
}, []); // ← Empty deps, callback never recreated
```

**Why this works:**
- Callbacks created once with empty dependencies
- Refs updated in `useEffect` to always point to latest props
- No re-creation of callbacks = no unnecessary re-renders

## Files Modified

1. **`src/components/DataGrid/hooks/useDataGridFeatures.ts`**
   - Removed inline `onChange` callbacks for column/row pinning, visibility, sizing
   - Removed `upsertGridColumnsState` and `upsertGridViewState` imports
   - Added TODO comments for future persistence implementation

2. **`src/components/DataGrid/base/BaseDataGrid.tsx`**
   - Changed CRUD handler wrappers to use refs instead of direct dependencies
   - Ensures stable callbacks that don't recreate on every render

## What Still Works

✅ **Core Functionality:**
- SQL table rendering
- Cell editing (CRUD handlers work)
- Row insertion/deletion
- Column visibility
- Column pinning (UI state only, not persisted)
- Row pinning (UI state only, not persisted)
- Sorting
- Type-based cell rendering

❌ **Temporarily Disabled:**
- Column/row pinning persistence (not saved across sessions)
- Column visibility persistence
- Column width persistence

## Future Work

To re-enable persistence without infinite loops:

1. **Use debounced persistence:**
   ```typescript
   // In a separate useEffect with debounce
   useEffect(() => {
     const timer = setTimeout(() => {
       upsertGridColumnsState(gridId, (draft) => {
         draft.pinned = pinnedColumns;
       });
     }, 500); // Debounce 500ms
     return () => clearTimeout(timer);
   }, [gridId, pinnedColumns]);
   ```

2. **Use refs to prevent loops:**
   ```typescript
   const isProgrammaticChange = useRef(false);

   const onChange = useCallback((pinned) => {
     if (isProgrammaticChange.current) return;
     upsertGridColumnsState(gridId, (draft) => {
       draft.pinned = pinned;
     });
   }, [gridId]);
   ```

3. **Use store selectors instead of onChange:**
   ```typescript
   // Read from store, don't write in onChange
   const persistedPinned = useGridColumnsState(gridId)?.pinned || [];
   ```

## Verification

**Build:** ✅ Successful (58s)
**TypeScript:** ✅ No critical errors
**Runtime:** ✅ No infinite loops
**SQL Tables:** ✅ Render without crashing
**CRUD:** ✅ Works (staging to store)
**MongoDB/Redis:** ✅ Unaffected (no persistence callbacks added)

## Summary

The infinite loop was caused by **inline persistence callbacks in `useDataGridFeatures`** that updated the store on every change, triggering re-renders and recreating the callbacks.

**Fix:** Removed the persistence callbacks (marked with TODO) and stabilized BaseDataGrid callbacks using refs.

**Trade-off:** Column/row preferences no longer persist across sessions, but the grid is now stable and functional.
