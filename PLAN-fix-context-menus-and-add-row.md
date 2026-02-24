# Plan: Fix Missing Context Menus and Add Row Functionality

## Problem Summary

The `TableDataGrid.tsx` has broken context menu functionality and add row operations:

1. **`onAddRow={undefined}`** - Handler exists but explicitly set to undefined
2. **`onInsertRowAbove={undefined}`** - Handler doesn't exist at all
3. **`onPaste` not passed** - Paste context menu item never appears

## Issues Analysis

### Issue 1: onAddRow is Broken

**Location**: `src/components/DataGrid/adapters/TableDataGrid.tsx:2484`

```tsx
// CURRENT (BROKEN):
onAddRow={undefined}

// EXPECTED:
onAddRow={isTableMode && entityType === "table" ? handleAddRow : undefined}
```

The `handleAddRow` handler exists at lines 1648-1721 and works correctly (stages INSERT command, shows toast, auto-focuses new row). It's just not being passed to UnifiedContextMenu.

### Issue 2: onInsertRowAbove Handler Missing

**Location**: `src/components/DataGrid/adapters/TableDataGrid.tsx:2485`

```tsx
// CURRENT:
onInsertRowAbove={undefined}

// NEEDED:
onInsertRowAbove={isTableMode && entityType === "table" ? handleInsertRowAbove : undefined}
```

The `handleInsertRowBelow` handler exists (lines 1836-1942), but there's no corresponding `handleInsertRowAbove`. Need to create it.

### Issue 3: onPaste Not Passed

**Location**: `src/components/DataGrid/adapters/TableDataGrid.tsx:2471-2521`

The `onPaste` prop is completely missing from UnifiedContextMenu props. The GridContextMenuItems component expects this callback (line 52 of GridContextMenuItems.tsx).

## Implementation Plan

### Step 1: Fix onAddRow - Wire Up Existing Handler

**File**: `src/components/DataGrid/adapters/TableDataGrid.tsx`
**Line**: ~2484

Change:
```tsx
onAddRow={undefined}
```
To:
```tsx
onAddRow={isTableMode && entityType === "table" ? handleAddRow : undefined}
```

### Step 2: Create handleInsertRowAbove Handler

**File**: `src/components/DataGrid/adapters/TableDataGrid.tsx`
**Location**: After `handleInsertRowBelow` (around line 1942)

Create new handler similar to `handleInsertRowBelow` but:
- Get the **first** selected row index (not last)
- Insert **before** that row instead of after
- Use `insertBeforeRowKey` metadata instead of `insertAfterRowKey`

```tsx
// Handler: Insert row above selected row
const handleInsertRowAbove = useCallback(() => {
  if (!isTableMode || selectedRowsSet.size === 0) {
    return;
  }

  try {
    // Get the first selected row index
    const selectedIndices = Array.from(selectedRowsSet).sort((a, b) => a - b);
    const firstSelectedIndex = selectedIndices[0] ?? 0;

    // Get the current active cell column (preserve column position)
    const currentColumn = gridSelection?.current?.cell[0] ?? 0;

    // Get the row key for the selected row (stable identifier)
    const selectedRow = rowsRef.current[firstSelectedIndex];
    const selectedRowKey = selectedRow
      ? getRowKey(selectedRow, firstSelectedIndex)
      : undefined;

    // Create a draft row with default values
    const draftRow = finalColumns.reduce<GridRowModel>((acc, column) => {
      const cell: GridCellValue = {
        value: null,
        db_type: column.meta?.db_type ?? column.type ?? "text",
        value_type: "Null",
        is_truncated: false,
      };
      acc[column.field] = cell;
      return acc;
    }, {});

    // Stage the insert command with position metadata
    const target = createCrudTarget(connectionId, database, schema, table);
    const baseCommand = createInsertCommand(draftRow, target, finalColumns);

    // Add position metadata so optimistic updates can place it correctly
    const command: typeof baseCommand = {
      ...baseCommand,
      metadata: {
        ...baseCommand.metadata,
        insertBeforeRowKey: selectedRowKey,
      },
    };

    stageCommand(command);

    // Auto-focus on the newly inserted row at the same column
    // The new row will be at firstSelectedIndex after optimistic update
    const newRowIndex = firstSelectedIndex;

    // Determine which column to focus (preserve current column or use first editable)
    let targetColumn = currentColumn;

    // If current column is a primary key, find first non-PK column
    const currentColumnMeta = finalColumns[targetColumn]?.meta;
    if (currentColumnMeta?.is_pk) {
      const firstEditableCol = finalColumns.findIndex(
        (col) => !col.meta?.is_pk,
      );
      if (firstEditableCol >= 0) {
        targetColumn = firstEditableCol;
      }
    }

    // Wait for the grid to update with optimistic changes
    setTimeout(() => {
      if (gridRef.current && "setFocus" in gridRef.current) {
        // Focus on the cell
        (gridRef.current as any).setFocus([targetColumn, newRowIndex]);

        // Trigger edit mode by simulating Enter key press
        setTimeout(() => {
          const gridElement =
            containerRef.current?.querySelector(".dvn-scroller");
          if (gridElement) {
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              bubbles: true,
              cancelable: true,
            });
            gridElement.dispatchEvent(enterEvent);
          }
        }, 10);
      }
    }, 50);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error("Failed to stage row", {
      description: message,
    });
  }
}, [
  isTableMode,
  selectedRowsSet,
  finalColumns,
  connectionId,
  database,
  schema,
  table,
  stageCommand,
  getRowKey,
  gridSelection,
]);
```

### Step 3: Create handlePasteFromContextMenu Handler

**File**: `src/components/DataGrid/adapters/TableDataGrid.tsx`
**Location**: Near other CRUD handlers (after handleInsertRowAbove)

```tsx
// Handler: Paste from context menu
const handlePasteFromContextMenu = useCallback(async () => {
  if (!isTableMode) return;

  try {
    // Read clipboard content
    const text = await navigator.clipboard.readText();
    if (!text) {
      toast.info("Clipboard is empty");
      return;
    }

    // Focus the grid to enable paste
    if (gridRef.current) {
      gridRef.current.focus();

      // Dispatch paste event to trigger Glide's built-in paste handling
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });

      // Set clipboard data
      (pasteEvent.clipboardData as DataTransfer).setData("text/plain", text);

      // Find the grid element and dispatch
      const gridElement = containerRef.current?.querySelector(".dvn-scroller");
      if (gridElement) {
        gridElement.dispatchEvent(pasteEvent);
      }
    }
  } catch (err) {
    // Clipboard API may fail due to permissions
    const message = err instanceof Error ? err.message : String(err);
    toast.error("Failed to paste", {
      description: message,
    });
  }
}, [isTableMode]);
```

### Step 4: Wire Up All Handlers in UnifiedContextMenu

**File**: `src/components/DataGrid/adapters/TableDataGrid.tsx`
**Location**: UnifiedContextMenu props (~line 2471-2521)

Change from:
```tsx
<UnifiedContextMenu
  ...
  onAddRow={undefined}
  onInsertRowAbove={undefined}
  onInsertRowBelow={isTableMode ? handleInsertRowBelow : undefined}
  ...
>
```

To:
```tsx
<UnifiedContextMenu
  ...
  onAddRow={isTableMode && entityType === "table" ? handleAddRow : undefined}
  onInsertRowAbove={isTableMode && entityType === "table" ? handleInsertRowAbove : undefined}
  onInsertRowBelow={isTableMode && entityType === "table" ? handleInsertRowBelow : undefined}
  onPaste={isTableMode && entityType === "table" ? handlePasteFromContextMenu : undefined}
  ...
>
```

### Step 5: Update useOptimisticRows to Handle insertBeforeRowKey

**File**: `src/components/DataGrid/hooks/useOptimisticRows.ts`

Currently only supports `insertAfterRowKey` (line 212). Need to add `insertBeforeRowKey`:

**Current code (line 211-225):**
```tsx
// Insert at specified position or top
const insertAfterRowKey = cmd.metadata.insertAfterRowKey;
if (insertAfterRowKey) {
  const targetIndex = rowKeyToIndex.get(insertAfterRowKey);
  if (targetIndex !== undefined) {
    result.splice(targetIndex + 1 + insertOffset, 0, row);
    insertOffset++;
  } else {
    result.unshift(row);
    insertOffset++;
  }
} else {
  result.unshift(row);
  insertOffset++;
}
```

**Change to:**
```tsx
// Insert at specified position or top
const insertBeforeRowKey = cmd.metadata.insertBeforeRowKey;
const insertAfterRowKey = cmd.metadata.insertAfterRowKey;

if (insertBeforeRowKey) {
  // Insert BEFORE the specified row
  const targetIndex = rowKeyToIndex.get(insertBeforeRowKey);
  if (targetIndex !== undefined) {
    result.splice(targetIndex + insertOffset, 0, row);
    insertOffset++;
  } else {
    result.unshift(row);
    insertOffset++;
  }
} else if (insertAfterRowKey) {
  // Insert AFTER the specified row
  const targetIndex = rowKeyToIndex.get(insertAfterRowKey);
  if (targetIndex !== undefined) {
    result.splice(targetIndex + 1 + insertOffset, 0, row);
    insertOffset++;
  } else {
    result.unshift(row);
    insertOffset++;
  }
} else {
  result.unshift(row);
  insertOffset++;
}
```

## Files to Modify

1. **`src/components/DataGrid/adapters/TableDataGrid.tsx`**
   - Add `handleInsertRowAbove` handler
   - Add `handlePasteFromContextMenu` handler
   - Wire up `onAddRow`, `onInsertRowAbove`, `onPaste` in UnifiedContextMenu

2. **`src/components/DataGrid/hooks/useOptimisticRows.ts`** (if needed)
   - Add support for `insertBeforeRowKey` metadata

## Testing

1. Right-click on empty grid → should show "Add Row" option
2. Right-click with row selected → should show "Insert Row Above" and "Insert Row Below"
3. Right-click → should show "Paste" option (in table mode only)
4. Test add row functionality - new row appears and is focused for editing
5. Test insert above - new row appears above selected row
6. Test insert below - new row appears below selected row
7. Test paste from context menu - clipboard content is pasted

## Notes

- All CRUD operations should only be available for `entityType === "table"` (not views/materialized views)
- Paste should trigger Glide's built-in paste handling for proper cell updates
- The new row should auto-focus on first editable (non-PK) column
