import { useCallback } from "react";
import type { GridSelection, Item } from "@glideapps/glide-data-grid";
import type { GridCell } from "@glideapps/glide-data-grid";

export interface UseFillOperationsOptions {
  /** Get cell content at a given position */
  getCellContent: (cell: Item) => GridCell;
  /** Callback to apply a batch of cell edits */
  onBatchEdit?: (edits: Array<{ cell: Item; value: unknown }>) => void;
  /** Total number of columns */
  columnCount: number;
  /** Total number of rows */
  rowCount: number;
}

export interface UseFillOperationsResult {
  /**
   * Fill down: Copy value from first row to all rows below in selection
   * Returns true if operation was performed, false if no valid selection
   */
  fillDown: (selection: GridSelection | undefined) => boolean;
  /**
   * Fill right: Copy value from leftmost column to all columns right in selection
   * Returns true if operation was performed, false if no valid selection
   */
  fillRight: (selection: GridSelection | undefined) => boolean;
}

/**
 * Extract the data value from a GridCell
 */
function getCellValue(cell: GridCell): unknown {
  switch (cell.kind) {
    case "text":
    case "number":
    case "uri":
    case "markdown":
      return cell.data;
    case "boolean":
      return cell.data;
    case "image":
    case "bubble":
      return cell.data;
    case "custom":
      // For custom cells, try to extract a value
      if (cell.data && typeof cell.data === "object" && "value" in cell.data) {
        return (cell.data as { value: unknown }).value;
      }
      return cell.data;
    default:
      return null;
  }
}

export function useFillOperations(
  options: UseFillOperationsOptions
): UseFillOperationsResult {
  const { getCellContent, onBatchEdit, columnCount, rowCount } = options;

  const fillDown = useCallback(
    (selection: GridSelection | undefined): boolean => {
      if (!selection?.current?.range || !onBatchEdit) {
        return false;
      }

      const { x: startCol, y: startRow, width, height } = selection.current.range;

      // Need at least 2 rows to fill down
      if (height < 2) {
        return false;
      }

      // Validate bounds
      const endCol = Math.min(startCol + width, columnCount);
      const endRow = Math.min(startRow + height, rowCount);

      const edits: Array<{ cell: Item; value: unknown }> = [];

      // For each column in the selection
      for (let col = startCol; col < endCol; col++) {
        // Get value from first row
        const sourceCell: Item = [col, startRow];
        const cellContent = getCellContent(sourceCell);
        const sourceValue = getCellValue(cellContent);

        // Apply to all rows below
        for (let row = startRow + 1; row < endRow; row++) {
          edits.push({
            cell: [col, row],
            value: sourceValue,
          });
        }
      }

      if (edits.length > 0) {
        onBatchEdit(edits);
        return true;
      }

      return false;
    },
    [getCellContent, onBatchEdit, columnCount, rowCount]
  );

  const fillRight = useCallback(
    (selection: GridSelection | undefined): boolean => {
      if (!selection?.current?.range || !onBatchEdit) {
        return false;
      }

      const { x: startCol, y: startRow, width, height } = selection.current.range;

      // Need at least 2 columns to fill right
      if (width < 2) {
        return false;
      }

      // Validate bounds
      const endCol = Math.min(startCol + width, columnCount);
      const endRow = Math.min(startRow + height, rowCount);

      const edits: Array<{ cell: Item; value: unknown }> = [];

      // For each row in the selection
      for (let row = startRow; row < endRow; row++) {
        // Get value from leftmost column
        const sourceCell: Item = [startCol, row];
        const cellContent = getCellContent(sourceCell);
        const sourceValue = getCellValue(cellContent);

        // Apply to all columns right
        for (let col = startCol + 1; col < endCol; col++) {
          edits.push({
            cell: [col, row],
            value: sourceValue,
          });
        }
      }

      if (edits.length > 0) {
        onBatchEdit(edits);
        return true;
      }

      return false;
    },
    [getCellContent, onBatchEdit, columnCount, rowCount]
  );

  return { fillDown, fillRight };
}
