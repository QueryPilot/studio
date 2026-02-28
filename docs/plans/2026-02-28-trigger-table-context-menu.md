# Trigger Table Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-click context menu to the TableTriggers grid with enable/disable toggle, copy actions, and delete/undo.

**Architecture:** Wrap the DataGridBase in the TableTriggers component with shadcn ContextMenu. Track hovered row via a `useRef` updated by `onItemHovered`. Snapshot the ref into state on menu open (prevents null when mouse moves to popup). Menu items dispatch existing handlers or stage commands via crudStore.

**Reference:** `src/components/TableIndexes/IndexTableContextMenu.tsx` — identical pattern (ref-based hover, snapshot on open, state-aware delete).

---

### Task 1: Create TriggerTableContextMenu component

**Files:**
- Create: `src/components/TableTriggers/TriggerTableContextMenu.tsx`

**Step 1: Create the context menu component**

```tsx
import { useCallback, useState, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  IconCheck,
  IconCopy,
  IconCode,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { TriggerGridRow } from "./types";

interface TriggerTableContextMenuProps {
  children: React.ReactNode;
  /** Ref tracking the currently hovered row (updated by onItemHovered) */
  hoveredRowRef: RefObject<TriggerGridRow | null>;
  onToggleEnabled: (row: TriggerGridRow) => void;
  onDeleteTrigger: (row: TriggerGridRow) => void;
  onUndoDelete: (row: TriggerGridRow) => void;
  onShowDeleteConfirm: (row: TriggerGridRow) => void;
}

export function TriggerTableContextMenu({
  children,
  hoveredRowRef,
  onToggleEnabled,
  onDeleteTrigger,
  onUndoDelete,
  onShowDeleteConfirm,
}: TriggerTableContextMenuProps) {
  // Snapshot the hovered row when the menu opens — this prevents the row
  // from going null when the mouse moves to the context menu popup.
  const [row, setRow] = useState<TriggerGridRow | null>(null);

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

  const handleCopyName = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.name).then(() => {
      toast.success("Copied trigger name");
    });
  }, [row]);

  const handleCopyDefinition = useCallback(() => {
    if (!row) return;
    void writeClipboardText(row.definition || "").then(() => {
      toast.success("Copied trigger definition");
    });
  }, [row]);

  const handleDelete = useCallback(() => {
    if (!row) return;
    if (isPendingDelete) {
      onUndoDelete(row);
    } else {
      onShowDeleteConfirm(row);
    }
  }, [row, isPendingDelete, onUndoDelete, onShowDeleteConfirm]);

  const deleteLabel = isPendingDelete ? "Undo Delete" : "Delete Trigger";

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {row && (
          <>
            {/* Toggle Enabled — disabled when pending delete */}
            <ContextMenuItem
              onClick={() => { onToggleEnabled(row); }}
              disabled={isPendingDelete}
            >
              <span className="flex-1">Enabled</span>
              {row.enabled === "YES" && (
                <IconCheck className="ml-auto text-foreground" />
              )}
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Copy Trigger Name */}
            <ContextMenuItem onClick={handleCopyName}>
              <IconCopy className="text-foreground" />
              <span className="flex-1">Copy Trigger Name</span>
            </ContextMenuItem>

            {/* Copy Definition */}
            <ContextMenuItem
              onClick={handleCopyDefinition}
              disabled={!row.definition}
            >
              <IconCode className="text-foreground" />
              <span className="flex-1">Copy Definition</span>
            </ContextMenuItem>

            <ContextMenuSeparator />

            {/* Delete / Undo Delete */}
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

**Step 2: Verify**

Run: `pnpm typecheck 2>&1 | grep TriggerTableContextMenu`
Expected: No output (no errors)

**Step 3: Commit**

```bash
git add src/components/TableTriggers/TriggerTableContextMenu.tsx
git commit -m "feat(table-triggers): add TriggerTableContextMenu component"
```

---

### Task 2: Integrate context menu into TableTriggers component

**Files:**
- Modify: `src/components/TableTriggers/index.tsx`

**Step 1: Add imports**

Add to existing imports at the top of the file:

```tsx
import { useRef } from "react"; // add useRef to the existing react import
import { type GridMouseEventArgs } from "@glideapps/glide-data-grid"; // add to existing glide import
import { TriggerTableContextMenu } from "./TriggerTableContextMenu";
```

The react import on line 1 already imports `memo, useCallback, useEffect, useMemo, useState`. Add `useRef` to that list.

The glide-data-grid import on line 2 already imports `GridCellKind, Item, CustomCell, CustomRenderer, EditableGridCell`. Add `GridMouseEventArgs` to that list.

**Step 2: Add ref and hover handler**

Inside the component, after the dialog state declarations (after line 70), add:

```tsx
// Context menu hover tracking
const contextMenuRowRef = useRef<TriggerGridRow | null>(null);
```

After the `handleCellActivated` callback (after line 553), add the hover handler:

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

After the `handleItemHovered` callback, add:

```tsx
// Context menu: toggle enabled
const handleContextToggleEnabled = useCallback(
  (row: TriggerGridRow) => {
    const target: CrudCommandTarget = { connectionId, database, schema, table };
    const originalName = row._original.name;
    const currentlyEnabled = row.enabled === "YES";
    const originalEnabled = row._original.enabled;

    // Check for existing toggle command
    const existingToggle = pendingCommands.find(
      (cmd) =>
        (cmd.type === "trigger.enable" || cmd.type === "trigger.disable") &&
        (cmd.payload as TriggerTogglePayload).triggerName === originalName,
    );

    if (existingToggle) {
      // Toggling back to original state — remove the command
      if (!currentlyEnabled === originalEnabled) {
        unstageCommand(existingToggle.id);
        return;
      }
      // Replace with new toggle command
      unstageCommand(existingToggle.id);
    }

    // Don't create command if same as original
    if (!currentlyEnabled === originalEnabled) {
      return;
    }

    // Toggle: if currently YES → disable, if currently NO → enable
    const toggleCmd = currentlyEnabled
      ? createTriggerDisableCommand(target, originalName)
      : createTriggerEnableCommand(target, originalName);
    stageCommand(toggleCmd);
  },
  [connectionId, database, schema, table, pendingCommands, stageCommand, unstageCommand],
);

// Context menu: undo delete
const handleContextUndoDelete = useCallback(
  (row: TriggerGridRow) => {
    const dropCommand = pendingCommands.find(
      (cmd) =>
        cmd.type === "trigger.drop" &&
        (cmd.payload as TriggerDropPayload).triggerName === row._original.name,
    );
    if (dropCommand) {
      unstageCommand(dropCommand.id);
      toast.success("Delete undone", {
        description: `${row._original.name} will no longer be dropped`,
      });
    }
  },
  [pendingCommands, unstageCommand],
);

// Context menu: show delete confirmation
const handleContextShowDeleteConfirm = useCallback(
  (row: TriggerGridRow) => {
    setDeleteTarget(row);
    setDeleteDialogOpen(true);
  },
  [],
);
```

**Step 4: Wrap DataGridBase with TriggerTableContextMenu**

Replace the `<div className="flex-1">` wrapper around DataGridBase (lines 616-630):

From:
```tsx
<div className="flex-1">
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
    onCellActivated={handleCellActivated}
  />
</div>
```

To:
```tsx
<div className="flex-1">
  <TriggerTableContextMenu
    hoveredRowRef={contextMenuRowRef}
    onToggleEnabled={handleContextToggleEnabled}
    onDeleteTrigger={handleDeleteTrigger}
    onUndoDelete={handleContextUndoDelete}
    onShowDeleteConfirm={handleContextShowDeleteConfirm}
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
      onCellActivated={handleCellActivated}
      onItemHovered={handleItemHovered}
    />
  </TriggerTableContextMenu>
</div>
```

Note: `onDeleteTrigger` is passed as a prop but not used by the current menu (triggers don't have a "pending new" / "discard" state like indexes do). It is included for forward-compatibility if pending-create triggers are added later.

**Step 5: Verify**

Run: `pnpm typecheck && pnpm lint --quiet`
Expected: No new errors from our files

**Step 6: Commit**

```bash
git add src/components/TableTriggers/index.tsx
git commit -m "feat(table-triggers): integrate context menu with grid"
```
