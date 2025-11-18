import { useCallback, useMemo } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Copy,
  Download,
  Eye,
  Pin,
  PinOff,
  Plus,
  Trash2,
  ClipboardPaste,
  Database,
} from "lucide-react";
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types/database";
import {
  copyAsJSON,
  copyAsCSV,
  copyAsTSV,
  copyAsInsert,
} from "../utils/copyUtils";
import {
  exportToCSV,
  exportToJSON,
  exportToTSV,
  exportToExcel,
  getSuggestedFilename,
} from "../utils/exportUtils";
import { toast } from "sonner";
import { writeTextToClipboard } from "../hooks/useClipboardBridge";
import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";

export interface GridContextMenuItemsProps {
  selectedRows: GridRowModel[];
  selectedRowKeys: string[];
  columns: GridColumnV2[];
  pinnedRowKeys: string[];
  selectedPinnedKeys: string[];
  selectedUnpinnedKeys: string[];
  canPinMore: boolean;
  tableName: string;
  schema?: string;
  databaseType: DatabaseType;
  onViewDetails: () => void;
  onPinRows?: (rowKeys: string[]) => void;
  onUnpinRows?: (rowKeys: string[]) => void;
  onAddRow?: () => void;
  onInsertRowBelow?: () => void;
  onDeleteRows?: () => void;
  onPaste?: () => void;
}

export function GridContextMenuItems({
  selectedRows,
  // selectedRowKeys,
  columns,
  pinnedRowKeys,
  selectedPinnedKeys,
  selectedUnpinnedKeys,
  canPinMore,
  tableName,
  schema,
  databaseType,
  onViewDetails,
  onPinRows,
  onUnpinRows,
  onAddRow,
  onInsertRowBelow,
  onDeleteRows,
  onPaste,
}: GridContextMenuItemsProps) {
  const hasSelection = selectedRows.length > 0;

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
            return [...kbds, <span key={`then-${chordIndex}`} className="text-muted-foreground text-xs mx-1">then</span>];
          }
          return kbds;
        })}
      </KbdGroup>
    );
  }, []);

  const shortcuts = useMemo(
    () => ({
      copy: renderShortcut("cmd+c"),
      copyJson: renderShortcut("cmd+shift+c"),
      paste: renderShortcut("cmd+v"),
      insertAbove: renderShortcut("cmd+shift+enter"),
      insertBelow: renderShortcut("cmd+enter"),
      deleteRows: renderShortcut("cmd+backspace"),
    }),
    [renderShortcut],
  );

  // Copy handlers
  const handleCopyJSON = useCallback(async () => {
    try {
      const content = copyAsJSON(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied as JSON");
    } catch (error) {
      toast.error(
        `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyCSV = useCallback(async () => {
    try {
      const content = copyAsCSV(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied as CSV");
    } catch (error) {
      toast.error(
        `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyTSV = useCallback(async () => {
    try {
      const content = copyAsTSV(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied as TSV");
    } catch (error) {
      toast.error(
        `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyInsert = useCallback(async () => {
    try {
      const content = copyAsInsert(
        selectedRows,
        columns,
        tableName,
        databaseType,
        schema,
      );
      await writeTextToClipboard(content);
      toast("Copied as INSERT statement");
    } catch (error) {
      toast.error(
        `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns, tableName, databaseType, schema]);

  // Export handlers
  const handleExportCSV = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      exportToCSV(selectedRows, columns, filename);
      toast("Exported as CSV");
    } catch (error) {
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportJSON = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "json");
      exportToJSON(selectedRows, columns, filename);
      toast("Exported as JSON");
    } catch (error) {
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportTSV = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "tsv");
      exportToTSV(selectedRows, columns, filename);
      toast("Exported as TSV");
    } catch (error) {
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportExcel = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      exportToExcel(selectedRows, columns, filename);
      toast("Exported as Excel-compatible CSV");
    } catch (error) {
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  // Pin/unpin handlers
  const handlePinRows = useCallback(() => {
    if (selectedUnpinnedKeys.length === 0) return;
    const maxPinnedRows = 5;
    const rowsToPin = selectedUnpinnedKeys.slice(
      0,
      maxPinnedRows - pinnedRowKeys.length,
    );
    onPinRows?.(rowsToPin);
    toast(`Pinned ${rowsToPin.length} row${rowsToPin.length === 1 ? "" : "s"}`);
  }, [selectedUnpinnedKeys, pinnedRowKeys.length, onPinRows]);

  const handleUnpinRows = useCallback(() => {
    if (selectedPinnedKeys.length === 0) return;
    onUnpinRows?.(selectedPinnedKeys);
    toast(
      `Unpinned ${selectedPinnedKeys.length} row${
        selectedPinnedKeys.length === 1 ? "" : "s"
      }`,
    );
  }, [selectedPinnedKeys, onUnpinRows]);

  if (!hasSelection) {
    return (
      <>
        {onAddRow && (
          <ContextMenuItem
            onClick={onAddRow}
            className="text-xs py-1 px-2 outline-none"
          >
            <Plus className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Add Row</span>
          </ContextMenuItem>
        )}
        {onPaste && (
          <ContextMenuItem
            onClick={onPaste}
            className="text-xs py-1 px-2 outline-none"
          >
            <ClipboardPaste className="mr-3.5 h-3 w-3" />
            <span className="flex-1">Paste</span>
          </ContextMenuItem>
        )}
      </>
    );
  }

  return (
    <>
      {/* View Details */}
      <ContextMenuItem
        onClick={onViewDetails}
        className="text-xs py-1 px-2 outline-none"
      >
        <Eye className="mr-1.5 h-3 w-3 text-foreground" />
        <span className="flex-1">View Details</span>
      </ContextMenuItem>

      <ContextMenuSeparator className="my-1" />

      {/* Copy submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs py-1 px-2 outline-none">
          <Copy className="mr-3.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Copy</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs p-1">
          <ContextMenuItem
            onClick={handleCopyTSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy cells</span>
            {shortcuts.copy}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyJSON}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy cells as JSON</span>
            {shortcuts.copyJson}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyCSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy cells as CSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyInsert}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy cells as INSERT</span>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1" />
          {/* Copy rows context menus  */}
          <ContextMenuItem
            onClick={handleCopyTSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy rows as TSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyJSON}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy rows as JSON</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyCSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy rows as CSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyInsert}
            className="text-xs py-1 px-2 outline-none"
          >
            <span className="flex-1">Copy rows as INSERT</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      {/* Pin/Unpin */}
      {selectedUnpinnedKeys.length > 0 && (
        <ContextMenuItem
          onClick={handlePinRows}
          disabled={!canPinMore}
          className="text-xs py-1 px-2 outline-none"
        >
          <Pin className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Pin Rows</span>
          {!canPinMore && (
            <span className="text-[10px] text-muted-foreground ml-1">Max</span>
          )}
        </ContextMenuItem>
      )}
      {selectedPinnedKeys.length > 0 && (
        <ContextMenuItem
          onClick={handleUnpinRows}
          className="text-xs py-1 px-2 outline-none"
        >
          <PinOff className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Unpin Rows</span>
        </ContextMenuItem>
      )}

      {onPaste && (
        <>
          <ContextMenuSeparator className="my-1" />
          <ContextMenuItem
            onClick={onPaste}
            className="text-xs py-1 px-2 outline-none"
          >
            <ClipboardPaste className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Paste</span>
            {shortcuts.paste}
          </ContextMenuItem>
        </>
      )}

      {onInsertRowBelow && (
        <ContextMenuItem
          onClick={onInsertRowBelow}
          className="text-xs py-1 px-2 outline-none"
        >
          <Plus className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Add Row</span>
          {shortcuts.insertBelow}
        </ContextMenuItem>
      )}

      {/* Export submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs py-1 px-2 outline-none">
          <Download className="mr-3.5 h-3 w-3" />
          <span className="flex-1">Export</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs p-1">
          <ContextMenuItem
            onClick={handleExportCSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <Download className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as CSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportJSON}
            className="text-xs py-1 px-2 outline-none"
          >
            <Download className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as JSON</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportTSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <Download className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as TSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportExcel}
            className="text-xs py-1 px-2 outline-none"
          >
            <Download className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as Excel</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator className="my-1" />

      {/* Delete */}
      <ContextMenuItem
        variant="destructive"
        onClick={onDeleteRows}
        className="text-xs py-1 px-2 outline-none"
      >
        <Trash2 className="mr-1.5 h-3 w-3 text-destructive" />
        <span className="flex-1">Delete</span>
        {shortcuts.deleteRows}
      </ContextMenuItem>
    </>
  );
}
