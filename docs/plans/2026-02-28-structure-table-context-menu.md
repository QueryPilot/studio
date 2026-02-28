# Structure Table Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-click context menu to the TableStructure grid with column operations: Add, Duplicate, Nullable toggle, Copy Name/DDL, and Delete/Discard/Undo.

**Architecture:** Wrap the DataGridBase in the TableStructure component with shadcn ContextMenu. Track hovered row via a ref updated by `onItemHovered`. Snapshot the ref into state on menu open via `onOpenChange` (prevents null when mouse moves to popup). Menu items dispatch existing handlers or stage commands directly via crudStore.

**Tech Stack:** shadcn/ui ContextMenu, Tabler Icons, existing crudStore + commandFactory, `writeClipboardText` from `@/lib/clipboard`

**Reference:** `src/components/TableIndexes/IndexTableContextMenu.tsx` (same pattern)

---

### Task 1: Create StructureTableContextMenu component

**Files:**
- Create: `src/components/TableStructure/StructureTableContextMenu.tsx`

**Step 1: Create the context menu component**

Create the file with this implementation:

```tsx
import { useCallback, useState, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconPlus,
  IconCopyPlus,
  IconCheck,
  IconCopy,
  IconCode,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { StructureGridRow } from "./types";

interface StructureTableContextMenuProps {
  children: React.ReactNode;
  /** Ref tracking the currently hovered row (updated by onItemHovered) */
  hoveredRowRef: RefObject<StructureGridRow | null>;
  tableName: string;
  schemaName?: string;
  onAddColumn: () => void;
  onDuplicate: (row: StructureGridRow) => void;
  onSetNullable: (row: StructureGridRow, value: "YES" | "NO") => void;
  onDeleteColumn: (row: StructureGridRow) => void;
  onUndoDelete: (row: StructureGridRow) => void;
  onShowDeleteConfirm: (row: StructureGridRow) => void;
}

/**
 * Build a column DDL fragment like: column_name VARCHAR(255) NOT NULL DEFAULT ''
 */
function buildColumnDDL(row: StructureGridRow): string {
  const parts: string[] = [row.column_name, row.db_type];

  if (row.nullable === "NO") {
    parts.push("NOT NULL");
  }

  if (row.default != null && row.default !== "") {
    parts.push(`DEFAULT ${row.default}`);
  }

  if (row.check_constraint) {
    parts.push(`CHECK (${row.check_constraint})`);
  }

  return parts.join(" ");
}

export function StructureTableContextMenu({
  children,
  hoveredRowRef,
  tableName,
  schemaName,
  onAddColumn,
  onDuplicate,
  onSetNullable,
  onDeleteColumn,
  onUndoDelete,
  onShowDeleteConfirm,
}: StructureTableContextMenuProps) {
  // Snapshot the hovered row when the menu opens — this prevents the row
  // from going null when the mouse moves to the context menu popup.
  const [row, setRow] = useState<StructureGridRow | null>(null);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setRow(hoveredRowRef.current ?? null);
      } else {
        setRow(null);
      }
    },
    [hoveredRowRef],
  );

  const isPendingDelete = row?._isPendingDelete ?? false;
  const isPending = row?._isPending ?? false;
  const isEditDisabled = isPendingDelete;

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.column_name).then(() => {
      toast.success("Copied column name");
    });
  }, [row]);

  const handleCopyDDL = useCallback(() => {
    if (!row) return;
    const ddl = buildColumnDDL(row);
    void writeClipboardText(ddl).then(() => {
      toast.success("Copied column DDL");
    });
  }, [row]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else if (isPending) {
      onDeleteColumn(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, isPending, onUndoDelete, onDeleteColumn, onShowDeleteConfirm]);

  const deleteLabel = isPendingDelete
    ? "Undo Delete"
    : isPending
      ? "Discard"
      : "Delete Column";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {/* Add Column - always available */}
        <ContextMenuItem onClick={onAddColumn}>
          <IconPlus className="text-foreground" />
          <span className="flex-1">Add Column</span>
        </ContextMenuItem>

        {row && (
          <>
            <ContextMenuSeparator />

            {/* Duplicate Column */}
            <ContextMenuItem
              onClick={() => { onDuplicate(row); }}
              disabled={isEditDisabled}
            >
              <IconCopyPlus className="text-foreground" />
              <span className="flex-1">Duplicate Column</span>
            </ContextMenuItem>

            {/* Nullable submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={isEditDisabled}>
                <span className="flex-1">Nullable</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="text-xs p-1">
                <ContextMenuItem
                  onClick={() => { onSetNullable(row, "YES"); }}
                >
                  <span className="flex-1">YES</span>
                  {row.nullable === "YES" && (
                    <IconCheck className="ml-auto text-foreground" />
                  )}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => { onSetNullable(row, "NO"); }}
                >
                  <span className="flex-1">NO</span>
                  {row.nullable === "NO" && (
                    <IconCheck className="ml-auto text-foreground" />
                  )}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {/* Copy Column Name */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="text-foreground" />
              <span className="flex-1">Copy Column Name</span>
            </ContextMenuItem>

            {/* Copy Column DDL */}
            <ContextMenuItem onClick={handleCopyDDL}>
              <IconCode className="text-foreground" />
              <span className="flex-1">Copy Column DDL</span>
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Delete / Discard / Undo Delete */}
            {isPendingDelete ? (
              <ContextMenuItem onClick={handleDelete}>
                <IconArrowBackUp className="text-foreground" />
                <span className="flex-1">{deleteLabel}</span>
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                variant="destructive"
                onClick={handleDelete}
              >
                <IconTrash />
                <span className="flex-1">{deleteLabel}</span>
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

**Step 2: Verify no type errors**

Run: `pnpm typecheck 2>&1 | grep StructureTableContextMenu`
Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/TableStructure/StructureTableContextMenu.tsx
git commit -m "feat(table-structure): add StructureTableContextMenu component"
```

---

### Task 2: Integrate context menu into TableStructure component

**Files:**
- Modify: `src/components/TableStructure/index.tsx`

**Step 1: Add imports and ref**

Add these imports near the top of the file alongside existing imports:

```tsx
import { StructureTableContextMenu } from "./StructureTableContextMenu";
import type { GridMouseEventArgs } from "@glideapps/glide-data-grid";
```

Note: `useRef` is already imported from React. If not, add it to the existing React import.

Add the ref inside the component body, near the other state declarations (around line 238, after `deleteTarget` state):

```tsx
const contextMenuRowRef = useRef<StructureGridRow | null>(null);
```

**Step 2: Add handleItemHovered callback**

Add this callback after the existing handler functions (e.g. after `handleDuplicateColumn`):

```tsx
const handleItemHovered = useCallback(
  (args: GridMouseEventArgs) => {
    if (args.kind === "cell") {
      contextMenuRowRef.current = gridRows[args.location[1]] ?? null;
    } else {
      contextMenuRowRef.current = null;
    }
  },
  [gridRows],
);
```

**Step 3: Add handler callbacks for context menu actions**

These adapt the existing handlers to accept `StructureGridRow` directly (instead of row index). Add them after `handleItemHovered`:

```tsx
// Context menu: Duplicate column by row reference
const handleContextDuplicate = useCallback(
  (row: StructureGridRow) => {
    const rowIndex = gridRows.indexOf(row);
    if (rowIndex >= 0) {
      handleDuplicateColumn(rowIndex);
    }
  },
  [gridRows, handleDuplicateColumn],
);

// Context menu: Set nullable for a single row
const handleContextSetNullable = useCallback(
  (row: StructureGridRow, value: "YES" | "NO") => {
    if (row.nullable === value) return;

    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    if (row._isPending) {
      const command = pendingCommands.find(
        (cmd) =>
          cmd.type === "column.add" &&
          (cmd.payload as ColumnAddPayload).tempId === row._tempId,
      );
      if (command) {
        const payload = command.payload as ColumnAddPayload;
        const updatedCmd = {
          ...command,
          payload: {
            ...payload,
            column: { ...payload.column, nullable: value === "YES" },
          },
        };
        stageCommand(updatedCmd);
      }
    } else {
      const modifyCmd = createColumnModifyCommand(target, row._originalData?.name ?? row.column_name, {
        nullable: value === "YES",
      });
      stageCommand(modifyCmd);
    }

    toast.success(`Set nullable to ${value}`, {
      description: row.column_name,
    });
  },
  [connectionId, database, schema, table, pendingCommands, stageCommand],
);

// Context menu: Undo delete for a single row
const handleContextUndoDelete = useCallback(
  (row: StructureGridRow) => {
    const dropCommand = pendingCommands.find(
      (cmd) =>
        cmd.type === "column.drop" &&
        (cmd.payload as ColumnDropPayload).columnName ===
          row._original?.name,
    );
    if (dropCommand) {
      unstageCommand(dropCommand.id);
      toast.success("Delete undone", {
        description: `${row._original?.name} will no longer be dropped`,
      });
    }
  },
  [pendingCommands, unstageCommand],
);

// Context menu: Show delete confirmation dialog
const handleContextShowDeleteConfirm = useCallback(
  (row: StructureGridRow) => {
    setDeleteTarget(row);
    setDeleteDialogOpen(true);
  },
  [],
);
```

**Step 4: Wrap DataGridBase with StructureTableContextMenu**

In the JSX return, find the `<div className="flex-1">` wrapper around DataGridBase (around line 1659). Replace from:

```tsx
<div className="flex-1">
  <DataGridBase
    columns={sizedColumns}
    rowCount={gridRows.length}
    getCellContent={getCellContent}
    customRenderers={customRenderers}
    rowSelect="multi"
    columnSelect="none"
    gridSelection={selection}
    onGridSelectionChange={setSelection}
    onColumnResize={handleColumnResize}
    onColumnResizeEnd={handleColumnResizeEnd}
    onCellActivated={isReadOnly ? undefined : handleCellActivated}
    onCellEdited={isReadOnly ? undefined : handleCellEdited}
    onCellClicked={isReadOnly ? undefined : handleCellClick}
    overscrollX={0}
    overscrollY={300}
    trailingRowOptions={
      isReadOnly
        ? undefined
        : {
            sticky: false,
            tint: false,
          }
    }
    onRowAppended={isReadOnly ? undefined : handleAddColumn}
  />
</div>
```

To:

```tsx
<div className="flex-1">
  {isReadOnly ? (
    <DataGridBase
      columns={sizedColumns}
      rowCount={gridRows.length}
      getCellContent={getCellContent}
      customRenderers={customRenderers}
      rowSelect="multi"
      columnSelect="none"
      gridSelection={selection}
      onGridSelectionChange={setSelection}
      onColumnResize={handleColumnResize}
      onColumnResizeEnd={handleColumnResizeEnd}
      overscrollX={0}
      overscrollY={300}
    />
  ) : (
    <StructureTableContextMenu
      hoveredRowRef={contextMenuRowRef}
      tableName={table}
      schemaName={schema}
      onAddColumn={handleAddColumn}
      onDuplicate={handleContextDuplicate}
      onSetNullable={handleContextSetNullable}
      onDeleteColumn={handleDeleteColumn}
      onUndoDelete={handleContextUndoDelete}
      onShowDeleteConfirm={handleContextShowDeleteConfirm}
    >
      <DataGridBase
        columns={sizedColumns}
        rowCount={gridRows.length}
        getCellContent={getCellContent}
        customRenderers={customRenderers}
        rowSelect="multi"
        columnSelect="none"
        gridSelection={selection}
        onGridSelectionChange={setSelection}
        onColumnResize={handleColumnResize}
        onColumnResizeEnd={handleColumnResizeEnd}
        onCellActivated={handleCellActivated}
        onCellEdited={handleCellEdited}
        onCellClicked={handleCellClick}
        onItemHovered={handleItemHovered}
        overscrollX={0}
        overscrollY={300}
        trailingRowOptions={{
          sticky: false,
          tint: false,
        }}
        onRowAppended={handleAddColumn}
      />
    </StructureTableContextMenu>
  )}
</div>
```

Note: The read-only branch skips the context menu entirely since views/materialized views cannot be edited. The `isReadOnly` ternary checks already existed on individual props; this lifts them to avoid passing unused callbacks.

**Step 5: Ensure `useRef` is in the React import**

Check the existing import at line 3. It currently has:

```tsx
import {
  memo,
  useMemo,
  useCallback,
  useState,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
```

Add `useRef` to it:

```tsx
import {
  memo,
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
```

**Step 6: Verify**

Run: `pnpm typecheck && pnpm lint --quiet`
Expected: No new errors from our files

**Step 7: Commit**

```bash
git add src/components/TableStructure/index.tsx
git commit -m "feat(table-structure): integrate context menu with structure grid"
```

---

### Task 3: Verify and handle edge cases

**Files:**
- Possibly adjust: `src/components/TableStructure/StructureTableContextMenu.tsx`
- Possibly adjust: `src/components/TableStructure/index.tsx`

**Step 1: Verify type imports resolve**

Confirm `ColumnAddPayload` and `ColumnDropPayload` are already imported in `index.tsx` (they are, at line 62-66).

**Step 2: Run full verification**

```bash
pnpm typecheck && pnpm lint --quiet
```

Expected: No new errors. Fix any that appear.

**Step 3: Run existing tests**

```bash
pnpm vitest run src/components/TableStructure/ 2>&1 | tail -20
```

Ensure no regressions.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(table-structure): finalize context menu edge cases"
```
