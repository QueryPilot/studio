# Central Table Editing Store - Integration Example

## Step-by-Step Migration Example

This guide shows how to migrate `TableDataGridV2` to use the centralized store.

### Before (Current Implementation)

```tsx
// TableDataGridV2.tsx - OLD IMPLEMENTATION
const [editingRows, setEditingRows] = useState<Map<string, RowEditDraft>>(
  () => new Map(),
);
const [isSaving, setIsSaving] = useState(false);

const handleEditCommit = useCallback((event: GridEditCommitEvent) => {
  // ... validation ...

  // Local state update
  const { state: nextEditingState, changed } = upsertCellEditState(
    editingRowsRef.current,
    { rowKey, rowIndex, columnId, originalCell, draftCell, ... }
  );

  if (changed) {
    setEditingRows(nextEditingState);
    editingRowsRef.current = nextEditingState;
  }

  // Optimistic update
  const newRows = [...rows];
  newRows[rowIndex] = updatedRow;
  setRows(newRows);

  // Return undo/redo (local history)
  return { undo: () => {...}, redo: () => {...} };
}, []);

const handleSaveAllChanges = useCallback(async () => {
  setIsSaving(true);
  // ... apply changes one by one ...
  setEditingRows(new Map());
}, []);
```

### After (Using Centralized Store)

```tsx
// TableDataGridV2.tsx - NEW IMPLEMENTATION
import {
  useTableEditData,
  useTableEditSummary,
} from "@/stores/tableEditStore.selectors";
import { applyChangesService } from "@/services/applyChangesService";
import { useConnectionStore } from "@/stores";
import { useTableEditStore } from "@/stores/tableEditStore";
import type {
  EditingScopeKey,
  RowDraft,
  CellDraft,
} from "@/stores/tableEditStore.types";

// Define scope
const scope: EditingScopeKey = {
  connectionId,
  database,
  table,
  schema: schema || "public",
};

// Use centralized store hooks
const { rowDrafts, upsertRowDraft, removeRowDraft, discardAll } =
  useTableEditData(scope);

const summary = useTableEditSummary(scope);
const [isSaving, setIsSaving] = useState(false);

// Convert store rowDrafts to local rows for rendering
const displayRows = useMemo(() => {
  const baseRows = [...rows]; // rows from useTableDataQuery

  // Apply drafts on top of base rows
  for (const [rowKey, draft] of rowDrafts) {
    if (draft.action === "insert" && draft.draftRow) {
      baseRows.splice(draft.rowIndex, 0, draft.draftRow);
    } else if (draft.action === "update" && draft.draftRow) {
      baseRows[draft.rowIndex] = draft.draftRow;
    } else if (draft.action === "delete") {
      // Mark as deleted but keep in view
      // (or filter out if you want immediate removal)
    }
  }

  return baseRows;
}, [rows, rowDrafts]);

const handleEditCommit = useCallback(
  (event: GridEditCommitEvent) => {
    const { rowIndex, column, newValue, previousValue } = event;
    const currentRow = rows[rowIndex];
    if (!currentRow || !column.field) return { undo: () => {}, redo: () => {} };

    const rowKey = getRowKey(currentRow, rowIndex);

    // Create updated row
    const updatedRow = { ...currentRow };
    const updatedCell = {
      /* convert newValue to CellValue */
    } as CellValue;
    updatedRow[column.field] = updatedCell;

    // Get existing draft or create new one
    const existingDraft = rowDrafts.get(rowKey);
    const cells = existingDraft?.cells || new Map<string, CellDraft>();

    // Update cell draft
    cells.set(column.field, {
      columnId: column.field,
      originalValue: previousValue ?? null,
      draftValue: updatedCell,
      hasChanged: true,
    });

    // Create row draft
    const draft: RowDraft = {
      rowKey,
      rowIndex,
      action: existingDraft?.action || "update",
      createdAt: existingDraft?.createdAt || Date.now(),
      updatedAt: Date.now(),
      originalRow: existingDraft?.originalRow || currentRow,
      draftRow: updatedRow,
      cells,
    };

    // Write to store (replaces local state update)
    upsertRowDraft(rowKey, draft);

    // Note: Undo/redo now handled by store
    // Return empty handlers for compatibility
    return { undo: () => {}, redo: () => {} };
  },
  [rowDrafts, upsertRowDraft, getRowKey, rows],
);

const handleSaveAllChanges = useCallback(async () => {
  setIsSaving(true);

  try {
    const scopeState = useTableEditStore.getState().getScopeState(scope);
    const connection = useConnectionStore
      .getState()
      .getConnection(connectionId);

    if (!scopeState || !connection) {
      toast({
        description: "Invalid scope or connection",
        variant: "destructive",
      });
      return;
    }

    // Apply changes using service
    const result = await applyChangesService.applyScope(
      scope,
      scopeState,
      connection.type,
      {
        domains: ["data"], // Only apply data changes
        continueOnError: false,
        onProgress: (domain, progress, total) => {
          console.log(`Applying ${domain}: ${progress}/${total}`);
        },
      },
    );

    if (result.success) {
      toast({
        description: `Saved ${result.applied?.data.applied || 0} changes`,
      });

      // Clear changes from store
      discardAll();

      // Refresh data from server
      await refreshData();
    } else {
      toast({
        description: `Failed: ${result.errors?.join(", ")}`,
        variant: "destructive",
      });
    }
  } finally {
    setIsSaving(false);
  }
}, [scope, connectionId, discardAll, toast]);
```

### Key Changes Summary

1. **Remove Local State**

   ```diff
   - const [editingRows, setEditingRows] = useState<Map<string, RowEditDraft>>(new Map());
   + const { rowDrafts, upsertRowDraft, discardAll } = useTableEditData(scope);
   ```

2. **Write to Store Instead of Local State**

   ```diff
   - setEditingRows(nextEditingState);
   + upsertRowDraft(rowKey, draft);
   ```

3. **Use Service for Apply**

   ```diff
   - // Manual cell-by-cell updates
   - for (const [rowKey, draft] of editingRows) {
   -   await CellEditService.updateCell({...});
   - }
   + const result = await applyChangesService.applyScope(scope, scopeState, dbType);
   ```

4. **Render from Store State**

   ```diff
   - // Rows already include optimistic updates
   - const displayRows = rows;
   + // Merge base rows with drafts
   + const displayRows = useMemo(() => mergeRowsWithDrafts(rows, rowDrafts), [rows, rowDrafts]);
   ```

5. **Clear Changes**
   ```diff
   - setEditingRows(new Map());
   + discardAll();
   ```

## Integration Checklist

### For TableDataGridV2

- [ ] Import store hooks and types
- [ ] Define scope object
- [ ] Replace `editingRows` state with `useTableEditData(scope)`
- [ ] Update `handleEditCommit` to write to store
- [ ] Update `handleRowAppend` to write to store
- [ ] Update `handleRowDelete` to write to store
- [ ] Replace `handleSaveAllChanges` with applyChangesService
- [ ] Update row rendering to merge drafts
- [ ] Remove local history (handled by store)
- [ ] Test editing workflow end-to-end

### For TableStructure

- [ ] Import store hooks
- [ ] Define scope object
- [ ] Replace local state with `useTableEditStructure(scope)`
- [ ] Update `updateEditingData` to write to store
- [ ] Update `handleDeleteColumn` to write to store
- [ ] Update `addNewColumn` to write to store
- [ ] Replace `handleSaveAllChanges` with applyChangesService
- [ ] Update `hasChanges` to use store summary
- [ ] Test column editing workflow

### For TableIndexes

- [ ] Import store hooks
- [ ] Define scope object
- [ ] Replace local state with `useTableEditIndexes(scope)`
- [ ] Update edit handlers to write to store
- [ ] Replace save handler with applyChangesService
- [ ] Test index management workflow

### For TableTriggers

- [ ] Import store hooks
- [ ] Define scope object
- [ ] Replace local state with `useTableEditTriggers(scope)`
- [ ] Update edit handlers to write to store
- [ ] Replace save handler with applyChangesService
- [ ] Test trigger management workflow

## Testing the Integration

### 1. Basic Editing

```tsx
// Test that changes are tracked
await user.type(cellInput, "new value");
expect(usePendingChangesCount(connectionId)).toBe(1);
```

### 2. Cross-Component State Sharing

```tsx
// Edit in DataGrid
await editCell(connectionId, database, table, "column1", "value1");

// Check in status bar
expect(screen.getByText("1 edit")).toBeInTheDocument();

// Check in drawer
await user.click(screen.getByText("1 edit"));
expect(screen.getByText("Data (1)")).toBeInTheDocument();
```

### 3. Apply and Clear

```tsx
// Apply changes
await user.click(screen.getByText("Apply All"));
await waitFor(() => expect(mockApplyService).toHaveBeenCalled());

// Verify cleared
expect(usePendingChangesCount(connectionId)).toBe(0);
```

### 4. Discard

```tsx
// Make changes
await editCell(...);
expect(usePendingChangesCount(connectionId)).toBe(1);

// Discard
await user.click(screen.getByText("Discard All"));

// Verify cleared
expect(usePendingChangesCount(connectionId)).toBe(0);
```

## Common Pitfalls

### 1. Scope Consistency

**Problem:** Using different scope objects across components.

**Solution:** Create scope in a shared location or ensure all properties match:

```tsx
const scope = useMemo(
  () => ({
    connectionId,
    database,
    schema: schema || "public",
    table,
  }),
  [connectionId, database, schema, table],
);
```

### 2. Stale Data After Apply

**Problem:** UI shows old data after applying changes.

**Solution:** Refresh data from server after successful apply:

```tsx
if (result.success) {
  discardAll();
  await refresh(); // Refetch from server
}
```

### 3. Missing Primary Keys

**Problem:** Update/delete operations fail without primary keys.

**Solution:** Set primary keys in scope metadata:

```tsx
useEffect(() => {
  const { setScopeMeta } = useTableEditStore.getState();
  setScopeMeta(scope, {
    primaryKey: columns.filter((c) => c.is_pk).map((c) => c.name),
  });
}, [scope, columns]);
```

### 4. Rendering Performance

**Problem:** Re-rendering on every change.

**Solution:** Use fine-grained selectors:

```tsx
// Bad: Re-renders on any change
const allData = useTableEditData(scope);

// Good: Only re-renders when rowDrafts change
const rowDrafts = useTableEditScope(
  scope,
  (state) => state?.domains.data.rowDrafts,
);
```

## Next Steps

1. Start with one component (recommend TableDataGridV2)
2. Test thoroughly before moving to next component
3. Document any issues or edge cases
4. Update other components using the same pattern
5. Remove old code once migration is complete

## Support

If you encounter issues:

1. Check scope key consistency
2. Verify connection is active
3. Check browser console for store state
4. Use React DevTools to inspect store subscriptions
5. Add logging to track state changes

## Resources

- Store implementation: `src/stores/tableEditStore.ts`
- Hooks documentation: `src/stores/tableEditStore.selectors.ts`
- Apply service: `src/services/applyChangesService.ts`
- SQL preview: `src/services/sqlPreviewService.ts`
