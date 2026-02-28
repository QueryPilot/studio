# Index Table Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-click context menu to the Table Indexes grid with full index operations.

**Architecture:** Wrap the DataGridBase in the TableIndexes component with shadcn ContextMenu (Base UI). Track hovered row via `onItemHovered` callback. Menu items dispatch existing handlers or stage commands directly via crudStore. Editor-triggering actions (Rename, Edit Columns, Edit Condition) are not included — they're already accessible by clicking/double-clicking cells.

**Tech Stack:** shadcn/ui ContextMenu (@base-ui/react), Tabler Icons, existing crudStore + commandFactory

---

### Task 1: Create IndexTableContextMenu component

**Files:**
- Create: `src/components/TableIndexes/IndexTableContextMenu.tsx`

**Step 1: Create the context menu component**

Create the file with this implementation:

```tsx
import { useCallback } from "react";
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
  IconCheck,
  IconCopy,
  IconCode,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { IndexGridRow } from "./types";

interface IndexTableContextMenuProps {
  children: React.ReactNode;
  row: IndexGridRow | null;
  tableName: string;
  schemaName?: string;
  availableIndexTypes: string[];
  onAddIndex: () => void;
  onDeleteIndex: (row: IndexGridRow) => void;
  onUndoDelete: (row: IndexGridRow) => void;
  onChangeType: (row: IndexGridRow, newType: string) => void;
  onToggleUnique: (row: IndexGridRow) => void;
  onShowDeleteConfirm: (row: IndexGridRow) => void;
}

export function IndexTableContextMenu({
  children,
  row,
  tableName,
  schemaName,
  availableIndexTypes,
  onAddIndex,
  onDeleteIndex,
  onUndoDelete,
  onChangeType,
  onToggleUnique,
  onShowDeleteConfirm,
}: IndexTableContextMenuProps) {
  const isLocked = row?.name_meta.primary ?? false;
  const isPendingDelete = row?._isPendingDelete ?? false;
  const isPending = row?._isPending ?? false;

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void navigator.clipboard.writeText(row.name);
    toast.success("Copied index name");
  }, [row]);

  const handleCopyDDL = useCallback(() => {
    if (!row) return;
    const unique = row.unique === "YES" ? "UNIQUE " : "";
    const using = row.index_type ? ` USING ${row.index_type}` : "";
    const cols = row.columns_array.join(", ");
    const qualifiedTable = schemaName ? `${schemaName}.${tableName}` : tableName;
    const condition = row.condition ? ` WHERE ${row.condition}` : "";
    const ddl = `CREATE ${unique}INDEX ${row.name} ON ${qualifiedTable}${using} (${cols})${condition};`;
    void navigator.clipboard.writeText(ddl);
    toast.success("Copied DDL");
  }, [row, tableName, schemaName]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else if (isPending || !row._original) {
      onDeleteIndex(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, isPending, onUndoDelete, onDeleteIndex, onShowDeleteConfirm]);

  return (
    <ContextMenu>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Add Index — always enabled */}
        <ContextMenuItem onClick={onAddIndex}>
          <IconPlus className="mr-2" />
          Add Index
        </ContextMenuItem>

        {row && (
          <>
            <ContextMenuSeparator />

            {/* Change Type submenu */}
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={isLocked || isPendingDelete}>
                Change Type
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {availableIndexTypes.map((type) => (
                  <ContextMenuItem
                    key={type}
                    onClick={() => onChangeType(row, type)}
                  >
                    <span className="flex-1">{type}</span>
                    {row.index_type === type && (
                      <IconCheck className="ml-2 text-primary" />
                    )}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* Toggle Unique */}
            <ContextMenuItem
              disabled={isLocked || isPendingDelete}
              onClick={() => onToggleUnique(row)}
            >
              {row.unique === "YES" ? "Remove Unique" : "Make Unique"}
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Copy actions — always enabled */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="mr-2" />
              Copy Index Name
            </ContextMenuItem>
            <ContextMenuItem onClick={handleCopyDDL}>
              <IconCode className="mr-2" />
              Copy DDL
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Delete / Undo */}
            {isPendingDelete ? (
              <ContextMenuItem onClick={handleDelete}>
                <IconArrowBackUp className="mr-2" />
                Undo Delete
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                variant="destructive"
                disabled={isLocked}
                onClick={handleDelete}
              >
                <IconTrash className="mr-2" />
                {isPending ? "Discard" : "Delete Index"}
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

Run: `pnpm typecheck 2>&1 | grep IndexTableContextMenu`
Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/TableIndexes/IndexTableContextMenu.tsx
git commit -m "feat(table-indexes): add IndexTableContextMenu component"
```

---

### Task 2: Integrate context menu into TableIndexes component

**Files:**
- Modify: `src/components/TableIndexes/index.tsx`

**Step 1: Add imports and hover tracking state**

At the top of the file, add the import:
```tsx
import { IndexTableContextMenu } from "./IndexTableContextMenu";
```

Inside the component, add state for tracking the hovered row:
```tsx
const [contextMenuRow, setContextMenuRow] = useState<IndexGridRow | null>(null);
```

Add an `onItemHovered` handler:
```tsx
const handleItemHovered = useCallback(
  (args: GridMouseEventArgs) => {
    if (args.kind === "cell") {
      const row = gridRows[args.location[1]];
      setContextMenuRow(row ?? null);
    } else {
      setContextMenuRow(null);
    }
  },
  [gridRows],
);
```

**Step 2: Add handler callbacks for context menu actions**

Add handlers for Change Type and Toggle Unique (these stage commands directly without opening cell editors):

```tsx
const handleChangeType = useCallback(
  (row: IndexGridRow, newType: string) => {
    if (row.index_type === newType) return;

    const target: CrudCommandTarget = { connectionId, database, schema, table };

    if (row._isPending) {
      // Update pending create command
      const command = pendingCommands.find(
        (cmd) =>
          cmd.type === "index.create" &&
          (cmd.payload as IndexCreatePayload).tempId === row._tempId,
      );
      if (command) {
        const payload = command.payload as IndexCreatePayload;
        const updatedCmd = {
          ...command,
          payload: {
            ...payload,
            definition: { ...payload.definition, using: newType },
          },
        };
        unstageCommand(command.id);
        stageCommand(updatedCmd);
      }
    } else {
      // For existing indexes: drop + recreate with new type
      const dropCmd = createIndexDropCommand(target, row.name);
      const createCmd = createIndexCreateCommand(target, {
        name: row.name,
        columns: row.columns_array,
        unique: row.unique === "YES",
        using: newType,
        where: row.condition || undefined,
      });
      // Tag as linked recreate pair
      dropCmd.metadata.tags = [`recreate:${row.name}`];
      createCmd.metadata.tags = [`recreate:${row.name}`];
      stageCommand(dropCmd);
      stageCommand(createCmd);
    }
    toast.success("Index type changed", { description: `${row.name} → ${newType}` });
  },
  [connectionId, database, schema, table, pendingCommands, stageCommand, unstageCommand],
);

const handleToggleUnique = useCallback(
  (row: IndexGridRow) => {
    const newUnique = row.unique !== "YES";
    const target: CrudCommandTarget = { connectionId, database, schema, table };

    if (row._isPending) {
      const command = pendingCommands.find(
        (cmd) =>
          cmd.type === "index.create" &&
          (cmd.payload as IndexCreatePayload).tempId === row._tempId,
      );
      if (command) {
        const payload = command.payload as IndexCreatePayload;
        const updatedCmd = {
          ...command,
          payload: {
            ...payload,
            definition: { ...payload.definition, unique: newUnique },
          },
        };
        unstageCommand(command.id);
        stageCommand(updatedCmd);
      }
    } else {
      const dropCmd = createIndexDropCommand(target, row.name);
      const createCmd = createIndexCreateCommand(target, {
        name: row.name,
        columns: row.columns_array,
        unique: newUnique,
        using: row.index_type || undefined,
        where: row.condition || undefined,
      });
      dropCmd.metadata.tags = [`recreate:${row.name}`];
      createCmd.metadata.tags = [`recreate:${row.name}`];
      stageCommand(dropCmd);
      stageCommand(createCmd);
    }
    toast.success(newUnique ? "Index set to unique" : "Unique removed", {
      description: row.name,
    });
  },
  [connectionId, database, schema, table, pendingCommands, stageCommand, unstageCommand],
);

const handleUndoDelete = useCallback(
  (row: IndexGridRow) => {
    const dropCommand = pendingCommands.find(
      (cmd) =>
        cmd.type === "index.drop" &&
        (cmd.payload as IndexDropPayload).indexName === row._original?.name,
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

const handleShowDeleteConfirm = useCallback(
  (row: IndexGridRow) => {
    setDeleteTarget(row);
    setDeleteDialogOpen(true);
  },
  [],
);
```

**Step 3: Wrap the DataGridBase with IndexTableContextMenu**

Replace the `<div className="flex-1">` wrapper around DataGridBase:

From:
```tsx
<div className="flex-1">
  <DataGridBase
    columns={sizedColumns}
    ...
  />
</div>
```

To:
```tsx
<div className="flex-1">
  <IndexTableContextMenu
    row={contextMenuRow}
    tableName={table}
    schemaName={schema}
    availableIndexTypes={indexTypes}
    onAddIndex={handleAddIndex}
    onDeleteIndex={handleDeleteIndex}
    onUndoDelete={handleUndoDelete}
    onChangeType={handleChangeType}
    onToggleUnique={handleToggleUnique}
    onShowDeleteConfirm={handleShowDeleteConfirm}
  >
    <DataGridBase
      columns={sizedColumns}
      rowCount={gridRows.length}
      getCellContent={getCellContent}
      customRenderers={customRenderers}
      rowSelect="none"
      columnSelect="none"
      onColumnResize={handleColumnResize}
      onColumnResizeEnd={handleColumnResizeEnd}
      onCellClicked={handleCellClick}
      onCellEdited={handleCellEdited}
      onItemHovered={handleItemHovered}
      trailingRowOptions={{
        sticky: false,
        tint: false,
      }}
      onRowAppended={handleAddIndex}
    />
  </IndexTableContextMenu>
</div>
```

**Step 4: Verify**

Run: `pnpm typecheck && pnpm lint --quiet 2>&1 | grep -i "TableIndexes\|IndexTable"`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/components/TableIndexes/index.tsx
git commit -m "feat(table-indexes): integrate context menu with grid"
```

---

### Task 3: Handle edge cases and verify

**Files:**
- Modify: `src/components/TableIndexes/IndexTableContextMenu.tsx` (if needed)
- Modify: `src/components/TableIndexes/index.tsx` (if needed)

**Step 1: Handle the recreate tag deduplication**

Check if existing `handleCellEdited` already uses `recreate:` tags for linking drop+create pairs. If so, match that pattern exactly in `handleChangeType` and `handleToggleUnique`. Read `src/components/TableIndexes/index.tsx` lines 670-850 to verify the recreate tag pattern and adjust if needed.

**Step 2: Verify the full flow**

Run: `pnpm typecheck && pnpm lint --quiet`
Expected: No new errors from our files

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(table-indexes): finalize context menu edge cases"
```
