import { useCallback, useMemo } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { IconCopy, IconCopyPlus, IconDownload, IconEye, IconPin, IconPinnedOff, IconPlus, IconTrash, IconClipboardText, IconKey } from '@tabler/icons-react';
import type { GridColumnV2, GridRowModel } from "../types";
import type { DatabaseType } from "@/types";
import {
  copyAsJSON,
  copyAsCSV,
  copyAsTSV,
  copyAsInsert,
  copyAsRedisGet,
  copyAsRedisSet,
  copyAsRedisDel,
  copyRedisKeys,
  copyAsMongoFind,
  copyAsMongoInsert,
  copyAsMongoUpdate,
  copyAsMongoDelete,
  type DataParadigm,
} from "../utils/copyUtils";
import {
  exportToCSV,
  exportToJSON,
  exportToTSV,
  exportToExcel,
  exportToMarkdown,
  getSuggestedFilename,
} from "../utils/exportUtils";
import { toast } from "sonner";
import { writeTextToClipboard } from "../hooks/useClipboardBridge";
import { normalizeKeybindingLabel } from "@/lib/keyboardDispatch";

export interface GridContextMenuItemsProps {
  selectedRows: GridRowModel[];
  selectedRowKeys: string[];
  /** All visible columns (for "Copy rows") */
  columns: GridColumnV2[];
  /** Columns in the current cell selection (for "Copy cells" - may be subset) */
  selectedColumns?: GridColumnV2[];
  pinnedRowKeys: string[];
  selectedPinnedKeys: string[];
  selectedUnpinnedKeys: string[];
  canPinMore: boolean;
  tableName: string;
  schema?: string;
  databaseType: DatabaseType;
  /** Data paradigm for context-aware copy options */
  paradigm?: DataParadigm;
  onViewDetails?: () => void;
  onPinRows?: (rowKeys: string[]) => void;
  onUnpinRows?: (rowKeys: string[]) => void;
  onAddRow?: () => void;
  onInsertRowAbove?: () => void;
  onInsertRowBelow?: () => void;
  onDuplicateRows?: () => void;
  onDeleteRows?: () => void;
  onBestEffortEditRows?: () => void;
  onBestEffortDeleteRows?: () => void;
  onSelectIdentifierColumns?: () => void;
  onPaste?: () => void;
}

export function GridContextMenuItems({
  selectedRows,
  // selectedRowKeys,
  columns,
  selectedColumns,
  pinnedRowKeys,
  selectedPinnedKeys,
  selectedUnpinnedKeys,
  canPinMore,
  tableName,
  schema,
  databaseType,
  paradigm = "sql",
  onViewDetails,
  onPinRows,
  onUnpinRows,
  onAddRow,
  onInsertRowAbove,
  onInsertRowBelow,
  onDuplicateRows,
  onDeleteRows,
  onBestEffortEditRows,
  onBestEffortDeleteRows,
  onSelectIdentifierColumns,
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
      copy: renderShortcut("cmd+c"),
      copyJson: renderShortcut("cmd+shift+c"),
      paste: renderShortcut("cmd+v"),
      insertAbove: renderShortcut("cmd+shift+enter"),
      insertBelow: renderShortcut("cmd+enter"),
      duplicate: renderShortcut("cmd+d"),
      deleteRows: renderShortcut("cmd+backspace"),
    }),
    [renderShortcut],
  );

  // Columns for cell copy (selected columns if available, otherwise all)
  const cellColumns = selectedColumns ?? columns;

  // Copy cells handlers (uses selected columns only)
  const handleCopyCellsJSON = useCallback(async () => {
    try {
      const content = copyAsJSON(selectedRows, cellColumns);
      await writeTextToClipboard(content);
      toast("Copied cells as JSON");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, cellColumns]);

  const handleCopyCellsCSV = useCallback(async () => {
    try {
      const content = copyAsCSV(selectedRows, cellColumns);
      await writeTextToClipboard(content);
      toast("Copied cells as CSV");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, cellColumns]);

  const handleCopyCellsTSV = useCallback(async () => {
    try {
      const content = copyAsTSV(selectedRows, cellColumns);
      await writeTextToClipboard(content);
      toast("Copied cells");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, cellColumns]);

  const handleCopyCellsInsert = useCallback(async () => {
    try {
      const content = copyAsInsert(selectedRows, cellColumns, tableName, databaseType, schema);
      await writeTextToClipboard(content);
      toast("Copied cells as INSERT");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, cellColumns, tableName, databaseType, schema]);

  // Copy rows handlers (uses all visible columns)
  const handleCopyRowsJSON = useCallback(async () => {
    try {
      const content = copyAsJSON(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied rows as JSON");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyRowsCSV = useCallback(async () => {
    try {
      const content = copyAsCSV(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied rows as CSV");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyRowsTSV = useCallback(async () => {
    try {
      const content = copyAsTSV(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied rows as TSV");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, columns]);

  const handleCopyRowsInsert = useCallback(async () => {
    try {
      const content = copyAsInsert(selectedRows, columns, tableName, databaseType, schema);
      await writeTextToClipboard(content);
      toast("Copied rows as INSERT");
    } catch (error) {
      toast.error(
        `Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [selectedRows, columns, tableName, databaseType, schema]);

  // ============================================================================
  // Redis-specific copy handlers
  // ============================================================================

  const handleCopyRedisGet = useCallback(async () => {
    try {
      const content = copyAsRedisGet(selectedRows);
      await writeTextToClipboard(content);
      toast("Copied Redis GET commands");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows]);

  const handleCopyRedisSet = useCallback(async () => {
    try {
      const content = copyAsRedisSet(selectedRows, columns);
      await writeTextToClipboard(content);
      toast("Copied Redis SET commands");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows, columns]);

  const handleCopyRedisDel = useCallback(async () => {
    try {
      const content = copyAsRedisDel(selectedRows);
      await writeTextToClipboard(content);
      toast("Copied Redis DEL command");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows]);

  const handleCopyRedisKeys = useCallback(async () => {
    try {
      const content = copyRedisKeys(selectedRows);
      await writeTextToClipboard(content);
      toast("Copied Redis keys");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows]);

  // ============================================================================
  // MongoDB-specific copy handlers
  // ============================================================================

  const handleCopyMongoFind = useCallback(async () => {
    try {
      const content = copyAsMongoFind(selectedRows, columns, tableName);
      await writeTextToClipboard(content);
      toast("Copied MongoDB find query");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows, columns, tableName]);

  const handleCopyMongoInsert = useCallback(async () => {
    try {
      const content = copyAsMongoInsert(selectedRows, columns, tableName);
      await writeTextToClipboard(content);
      toast("Copied MongoDB insert command");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows, columns, tableName]);

  const handleCopyMongoUpdate = useCallback(async () => {
    try {
      const content = copyAsMongoUpdate(selectedRows, columns, tableName);
      await writeTextToClipboard(content);
      toast("Copied MongoDB update command");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows, columns, tableName]);

  const handleCopyMongoDelete = useCallback(async () => {
    try {
      const content = copyAsMongoDelete(selectedRows, columns, tableName);
      await writeTextToClipboard(content);
      toast("Copied MongoDB delete command");
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [selectedRows, columns, tableName]);

  // Export handlers
  const handleExportCSV = useCallback(async () => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      await exportToCSV(selectedRows, columns, filename);
      toast("Exported as CSV");
    } catch (error) {
      console.error("Export CSV error:", error);
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportJSON = useCallback(async () => {
    try {
      const filename = getSuggestedFilename(tableName, "json");
      await exportToJSON(selectedRows, columns, filename);
      toast("Exported as JSON");
    } catch (error) {
      console.error("Export JSON error:", error);
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportTSV = useCallback(async () => {
    try {
      const filename = getSuggestedFilename(tableName, "tsv");
      await exportToTSV(selectedRows, columns, filename);
      toast("Exported as TSV");
    } catch (error) {
      console.error("Export TSV error:", error);
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportMarkdown = useCallback(async () => {
    try {
      const filename = getSuggestedFilename(tableName, "md");
      await exportToMarkdown(selectedRows, columns, filename);
      toast("Exported as Markdown");
    } catch (error) {
      console.error("Export Markdown error:", error);
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [selectedRows, columns, tableName]);

  const handleExportExcel = useCallback(async () => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      await exportToExcel(selectedRows, columns, filename);
      toast("Exported as Excel-compatible CSV");
    } catch (error) {
      console.error("Export Excel error:", error);
      toast.error(
        `Failed to export: ${
          error instanceof Error ? error.message : String(error)
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
        {onSelectIdentifierColumns && (
          <ContextMenuItem
            onClick={onSelectIdentifierColumns}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconKey className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Select Identifier Columns</span>
          </ContextMenuItem>
        )}
        {onSelectIdentifierColumns && (onAddRow || onPaste) && (
          <ContextMenuSeparator className="my-1" />
        )}
        {onAddRow && (
          <ContextMenuItem
            onClick={onAddRow}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconPlus className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Add Row</span>
          </ContextMenuItem>
        )}
        {onPaste && (
          <ContextMenuItem
            onClick={onPaste}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconClipboardText className="mr-3.5 h-3 w-3" />
            <span className="flex-1">Paste</span>
          </ContextMenuItem>
        )}
      </>
    );
  }

  return (
    <>
      {onViewDetails && (
        <>
          <ContextMenuItem
            onClick={onViewDetails}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconEye className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">View Details</span>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1" />
        </>
      )}

      {/* Copy submenu - paradigm-aware */}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs py-1.5 px-3 outline-none">
          <IconCopy className="mr-3.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Copy</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs p-1">
          {/* Common copy options */}
          <ContextMenuItem
            onClick={handleCopyCellsTSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy cells</span>
            {shortcuts.copy}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyCellsJSON}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy cells as JSON</span>
            {shortcuts.copyJson}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyCellsCSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy cells as CSV</span>
          </ContextMenuItem>

          {/* SQL-specific copy options */}
          {paradigm === "sql" && (
            <ContextMenuItem
              onClick={handleCopyCellsInsert}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <span className="flex-1">Copy cells as INSERT</span>
            </ContextMenuItem>
          )}

          {/* Redis-specific copy options */}
          {paradigm === "keyvalue" && (
            <>
              <ContextMenuItem
                onClick={handleCopyRedisGet}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as GET command</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyRedisSet}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as SET command</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyRedisDel}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as DEL command</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyRedisKeys}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy key names</span>
              </ContextMenuItem>
            </>
          )}

          {/* MongoDB-specific copy options */}
          {paradigm === "document" && (
            <>
              <ContextMenuItem
                onClick={handleCopyMongoFind}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as find()</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyMongoInsert}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as insertOne()</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyMongoUpdate}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as updateOne()</span>
              </ContextMenuItem>
              <ContextMenuItem
                onClick={handleCopyMongoDelete}
                className="text-xs py-1.5 px-3 outline-none"
              >
                <span className="flex-1">Copy as deleteOne()</span>
              </ContextMenuItem>
            </>
          )}

          <ContextMenuSeparator className="my-1" />

          {/* Copy rows (all visible columns) */}
          <ContextMenuItem
            onClick={handleCopyRowsTSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy rows as TSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyRowsJSON}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy rows as JSON</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyRowsCSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <span className="flex-1">Copy rows as CSV</span>
          </ContextMenuItem>

          {/* SQL row INSERT */}
          {paradigm === "sql" && (
            <ContextMenuItem
              onClick={handleCopyRowsInsert}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <span className="flex-1">Copy rows as INSERT</span>
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      {/* Pin/Unpin */}
      {selectedUnpinnedKeys.length > 0 && (
        <ContextMenuItem
          onClick={handlePinRows}
          disabled={!canPinMore}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconPin className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Pin Rows</span>
          {!canPinMore && (
            <span className="text-xs text-muted-foreground ml-1">Max</span>
          )}
        </ContextMenuItem>
      )}
      {selectedPinnedKeys.length > 0 && (
        <ContextMenuItem
          onClick={handleUnpinRows}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconPinnedOff className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Unpin Rows</span>
        </ContextMenuItem>
      )}

      {onPaste && (
        <>
          <ContextMenuSeparator className="my-1" />
          <ContextMenuItem
            onClick={onPaste}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconClipboardText className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Paste</span>
            {shortcuts.paste}
          </ContextMenuItem>
        </>
      )}

      {onInsertRowAbove && (
        <ContextMenuItem
          onClick={onInsertRowAbove}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconPlus className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Insert Row Above</span>
          {shortcuts.insertAbove}
        </ContextMenuItem>
      )}

      {onInsertRowBelow && (
        <ContextMenuItem
          onClick={onInsertRowBelow}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconPlus className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Insert Row Below</span>
          {shortcuts.insertBelow}
        </ContextMenuItem>
      )}

      {onDuplicateRows && (
        <ContextMenuItem
          onClick={onDuplicateRows}
          className="text-xs py-1.5 px-3 outline-none"
        >
          <IconCopyPlus className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">
            Duplicate Row{selectedRows.length > 1 ? "s" : ""}
          </span>
          {shortcuts.duplicate}
        </ContextMenuItem>
      )}

      {/* Export submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs py-1.5 px-3 outline-none">
          <IconDownload className="mr-3.5 h-3 w-3" />
          <span className="flex-1">Export</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="text-xs p-1">
          <ContextMenuItem
            onClick={handleExportCSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconDownload className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as CSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportJSON}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconDownload className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as JSON</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportTSV}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconDownload className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as TSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportMarkdown}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconDownload className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as Markdown</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleExportExcel}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconDownload className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Export as Excel</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator className="my-1" />

      {/* Delete */}
      <ContextMenuItem
        variant="destructive"
        onClick={onDeleteRows}
        className="text-xs py-1.5 px-3 outline-none"
      >
        <IconTrash className="mr-1.5 h-3 w-3 text-destructive" />
        <span className="flex-1">Delete</span>
        {shortcuts.deleteRows}
      </ContextMenuItem>

      {(onBestEffortEditRows || onBestEffortDeleteRows) && (
        <>
          <ContextMenuSeparator className="my-1" />
          {onBestEffortEditRows && (
            <ContextMenuItem
              onClick={onBestEffortEditRows}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <IconCopyPlus className="mr-1.5 h-3 w-3 text-foreground" />
              <span className="flex-1">Best-effort Edit Row</span>
            </ContextMenuItem>
          )}
          {onBestEffortDeleteRows && (
            <ContextMenuItem
              variant="destructive"
              onClick={onBestEffortDeleteRows}
              className="text-xs py-1.5 px-3 outline-none"
            >
              <IconTrash className="mr-1.5 h-3 w-3 text-destructive" />
              <span className="flex-1">Best-effort Delete</span>
            </ContextMenuItem>
          )}
        </>
      )}

      {onSelectIdentifierColumns && (
        <>
          <ContextMenuSeparator className="my-1" />
          <ContextMenuItem
            onClick={onSelectIdentifierColumns}
            className="text-xs py-1.5 px-3 outline-none"
          >
            <IconKey className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Select Identifier Columns</span>
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
