import { useCallback, useMemo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { IconCopy, IconTrash } from "@tabler/icons-react";
import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";

// Common SQL data types for the "Set Type" submenu
const COMMON_DATA_TYPES = [
  // String types
  { value: "text", label: "text" },
  { value: "varchar(255)", label: "varchar(255)" },
  // Integer types
  { value: "integer", label: "integer" },
  { value: "bigint", label: "bigint" },
  { value: "smallint", label: "smallint" },
  // Boolean
  { value: "boolean", label: "boolean" },
  // Date/Time types
  { value: "timestamp", label: "timestamp" },
  { value: "timestamptz", label: "timestamptz" },
  { value: "date", label: "date" },
  { value: "time", label: "time" },
  // Numeric types
  { value: "numeric", label: "numeric" },
  { value: "decimal", label: "decimal" },
  { value: "float", label: "float" },
  { value: "double precision", label: "double precision" },
  // UUID
  { value: "uuid", label: "uuid" },
  // JSON types
  { value: "json", label: "json" },
  { value: "jsonb", label: "jsonb" },
] as const;

export interface StructureContextMenuProps {
  children: React.ReactNode;
  /** Currently selected row indices */
  selectedRows: number[];
  /** Callback when duplicating a column */
  onDuplicate: (rowIndex: number) => void;
  /** Callback when deleting column(s) */
  onDelete: (rowIndices: number[]) => void;
  /** Callback when setting nullable value for column(s) */
  onSetNullable: (rowIndices: number[], value: "YES" | "NO") => void;
  /** Callback when setting data type for column(s) */
  onSetType: (rowIndices: number[], dataType: string) => void;
}

export function StructureContextMenu({
  children,
  selectedRows,
  onDuplicate,
  onDelete,
  onSetNullable,
  onSetType,
}: StructureContextMenuProps) {
  const hasSelection = selectedRows.length > 0;
  const isSingleSelection = selectedRows.length === 1;
  const isMultipleSelection = selectedRows.length > 1;

  // Render keyboard shortcut hints
  const renderShortcut = useCallback((binding: string) => {
    const chords = normalizeKeybindingLabel(binding);
    if (chords.length === 0) {
      return null;
    }
    return (
      <KbdGroup className="ml-auto">
        {chords.flatMap((chord, chordIndex) => {
          const parts = chord.split("+");
          const kbds = parts.map((part, partIndex) => (
            <Kbd key={`${chordIndex}-${partIndex}`}>{part}</Kbd>
          ));
          if (chordIndex < chords.length - 1) {
            return [
              ...kbds,
              <span
                key={`then-${chordIndex}`}
                className="text-muted-foreground text-xs mx-1"
              >
                then
              </span>,
            ];
          }
          return kbds;
        })}
      </KbdGroup>
    );
  }, []);

  const shortcuts = useMemo(
    () => ({
      duplicate: renderShortcut("cmd+d"),
      delete: renderShortcut("cmd+backspace"),
    }),
    [renderShortcut],
  );

  // Handlers
  const handleDuplicate = useCallback(() => {
    if (isSingleSelection && selectedRows[0] !== undefined) {
      onDuplicate(selectedRows[0]);
    }
  }, [isSingleSelection, selectedRows, onDuplicate]);

  const handleDelete = useCallback(() => {
    if (hasSelection) {
      onDelete(selectedRows);
    }
  }, [hasSelection, selectedRows, onDelete]);

  const handleSetNullable = useCallback(
    (value: "YES" | "NO") => {
      if (hasSelection) {
        onSetNullable(selectedRows, value);
      }
    },
    [hasSelection, selectedRows, onSetNullable],
  );

  const handleSetType = useCallback(
    (dataType: string) => {
      if (hasSelection) {
        onSetType(selectedRows, dataType);
      }
    },
    [hasSelection, selectedRows, onSetType],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger className="h-full w-full block">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 text-xs p-1">
        {/* Duplicate Column - only available for single selection */}
        <ContextMenuItem
          onClick={handleDuplicate}
          disabled={!isSingleSelection}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconCopy className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Duplicate Column</span>
          {shortcuts.duplicate}
        </ContextMenuItem>

        <ContextMenuSeparator className="my-1" />

        {/* Delete - shows different label based on selection count */}
        <ContextMenuItem
          variant="destructive"
          onClick={handleDelete}
          disabled={!hasSelection}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconTrash className="mr-1.5 h-3 w-3 text-destructive" />
          <span className="flex-1">
            {isMultipleSelection
              ? `Delete Selected (${selectedRows.length})`
              : "Delete Column"}
          </span>
          {shortcuts.delete}
        </ContextMenuItem>

        <ContextMenuSeparator className="my-1" />

        {/* Set Nullable submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger
            disabled={!hasSelection}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Set Nullable</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="text-xs p-1 w-32">
            <ContextMenuItem
              onClick={() => handleSetNullable("YES")}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <span className="flex-1">YES</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleSetNullable("NO")}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <span className="flex-1">NO</span>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Set Type submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger
            disabled={!hasSelection}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Set Type</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="text-xs p-1 w-44 max-h-80 overflow-y-auto">
            {COMMON_DATA_TYPES.map((type) => (
              <ContextMenuItem
                key={type.value}
                onClick={() => handleSetType(type.value)}
                className="text-xs py-1.5 px-3 outline-none font-mono"
              >
                <span className="flex-1">{type.label}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default StructureContextMenu;
