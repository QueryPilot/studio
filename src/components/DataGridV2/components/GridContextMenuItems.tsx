import { useCallback } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
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
import { useToast } from "@/hooks/use-toast";

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
  onDeleteRows,
  onPaste,
}: GridContextMenuItemsProps) {
  const { toast } = useToast();
  const hasSelection = selectedRows.length > 0;

  // Copy handlers
  const handleCopyJSON = useCallback(async () => {
    try {
      const content = copyAsJSON(selectedRows, columns);
      await navigator.clipboard.writeText(content);
      toast({ description: "Copied as JSON" });
    } catch (error) {
      toast({
        description: `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, toast]);

  const handleCopyCSV = useCallback(async () => {
    try {
      const content = copyAsCSV(selectedRows, columns);
      await navigator.clipboard.writeText(content);
      toast({ description: "Copied as CSV" });
    } catch (error) {
      toast({
        description: `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, toast]);

  const handleCopyTSV = useCallback(async () => {
    try {
      const content = copyAsTSV(selectedRows, columns);
      await navigator.clipboard.writeText(content);
      toast({ description: "Copied as TSV" });
    } catch (error) {
      toast({
        description: `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, toast]);

  const handleCopyInsert = useCallback(async () => {
    try {
      const content = copyAsInsert(
        selectedRows,
        columns,
        tableName,
        databaseType,
        schema,
      );
      await navigator.clipboard.writeText(content);
      toast({ description: "Copied as INSERT statement" });
    } catch (error) {
      toast({
        description: `Failed to copy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, tableName, databaseType, schema, toast]);

  // Export handlers
  const handleExportCSV = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      exportToCSV(selectedRows, columns, filename);
      toast({ description: "Exported as CSV" });
    } catch (error) {
      toast({
        description: `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, tableName, toast]);

  const handleExportJSON = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "json");
      exportToJSON(selectedRows, columns, filename);
      toast({ description: "Exported as JSON" });
    } catch (error) {
      toast({
        description: `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, tableName, toast]);

  const handleExportTSV = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "tsv");
      exportToTSV(selectedRows, columns, filename);
      toast({ description: "Exported as TSV" });
    } catch (error) {
      toast({
        description: `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, tableName, toast]);

  const handleExportExcel = useCallback(() => {
    try {
      const filename = getSuggestedFilename(tableName, "csv");
      exportToExcel(selectedRows, columns, filename);
      toast({ description: "Exported as Excel-compatible CSV" });
    } catch (error) {
      toast({
        description: `Failed to export: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        variant: "destructive",
      });
    }
  }, [selectedRows, columns, tableName, toast]);

  // Pin/unpin handlers
  const handlePinRows = useCallback(() => {
    if (selectedUnpinnedKeys.length === 0) return;
    const maxPinnedRows = 5;
    const rowsToPin = selectedUnpinnedKeys.slice(
      0,
      maxPinnedRows - pinnedRowKeys.length,
    );
    onPinRows?.(rowsToPin);
    toast({
      description: `Pinned ${rowsToPin.length} row${
        rowsToPin.length === 1 ? "" : "s"
      }`,
    });
  }, [selectedUnpinnedKeys, pinnedRowKeys.length, onPinRows, toast]);

  const handleUnpinRows = useCallback(() => {
    if (selectedPinnedKeys.length === 0) return;
    onUnpinRows?.(selectedPinnedKeys);
    toast({
      description: `Unpinned ${selectedPinnedKeys.length} row${
        selectedPinnedKeys.length === 1 ? "" : "s"
      }`,
    });
  }, [selectedPinnedKeys, onUnpinRows, toast]);

  if (!hasSelection) {
    return (
      <>
        {/* No selection - show minimal menu */}
        <ContextMenuItem
          onClick={onAddRow}
          className="text-xs py-1 px-2 outline-none"
        >
          <Plus className="mr-1.5 h-3 w-3 text-foreground" />
          <span className="flex-1">Add Row</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onPaste}
          className="text-xs py-1 px-2 outline-none"
        >
          <ClipboardPaste className="mr-3.5 h-3 w-3" />
          <span className="flex-1">Paste</span>
        </ContextMenuItem>
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
            onClick={handleCopyJSON}
            className="text-xs py-1 px-2 outline-none"
          >
            <Copy className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Copy as JSON</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyCSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <Copy className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Copy as CSV</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleCopyTSV}
            className="text-xs py-1 px-2 outline-none"
          >
            <Copy className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Copy as TSV</span>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1" />
          <ContextMenuItem
            onClick={handleCopyInsert}
            className="text-xs py-1 px-2 outline-none"
          >
            <Database className="mr-1.5 h-3 w-3 text-foreground" />
            <span className="flex-1">Copy as INSERT</span>
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

      <ContextMenuSeparator className="my-1" />

      {/* Paste */}
      <ContextMenuItem
        onClick={onPaste}
        className="text-xs py-1 px-2 outline-none"
      >
        <ClipboardPaste className="mr-1.5 h-3 w-3 text-foreground" />
        <span className="flex-1">Paste</span>
      </ContextMenuItem>

      {/* Add Row */}
      <ContextMenuItem
        onClick={onAddRow}
        className="text-xs py-1 px-2 outline-none"
      >
        <Plus className="mr-1.5 h-3 w-3 text-foreground" />
        <span className="flex-1">Add Row</span>
      </ContextMenuItem>

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
        <Trash2 className="mr-1.5 h-3 w-3 text-foreground" />
        <span className="flex-1">Delete</span>
      </ContextMenuItem>
    </>
  );
}
