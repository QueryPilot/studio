/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { memo, useCallback, useState, useRef, useMemo, useEffect } from "react";
import DataEditor, {
  type GridCell,
  type GridColumn,
  type Item,
  type Rectangle,
  type GridSelection,
  GridCellKind,
  type DataEditorRef,
  type Theme,
  type GridMouseEventArgs,
  CompactSelection,
  type DrawCellCallback,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import "./glide-overrides.css";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useCopy } from "@/hooks/useCopy";
import { useToast } from "@/hooks/use-toast";
import { CellValuePopup } from "./CellValuePopup";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Copy,
  FileJson,
  Table,
  Search,
  Filter,
  SortAsc,
  SortDesc,
  Eye,
} from "lucide-react";

interface EnhancedGlideWrapperProps {
  columns: GridColumn[];
  rows: number;
  getCellContent: (cell: Item) => GridCell;
  getCellValue?: (cell: Item) => unknown;
  onCellClicked?: (cell: Item) => void;
  onCellDoubleClick?: (cell: Item) => void;
  onCellEdited?: (cell: Item, newValue: GridCell) => void;
  onColumnResize?: (
    column: GridColumn,
    newSize: number,
    colIndex: number,
  ) => void;
  onColumnResizeEnd?: (
    column: GridColumn,
    newSize: number,
    colIndex: number,
  ) => void;
  onColumnMoved?: (startIndex: number, endIndex: number) => void;
  onRowAppended?: () => void;
  onVisibleRegionChanged?: (range: Rectangle) => void;
  onSelectionChange?: (selectedRowCount: number) => void;
  className?: string;
  freezeColumns?: number;
  rowMarkers?: "none" | "number" | "checkbox" | "both";
  headerHeight?: number;
  rowHeight?: number;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  estimatedTotal?: number;
}

export const EnhancedGlideWrapper = memo(function EnhancedGlideWrapper({
  columns,
  rows,
  getCellContent,
  getCellValue,
  onCellClicked,
  onCellDoubleClick,
  onCellEdited,
  onColumnResize,
  onColumnResizeEnd,
  onColumnMoved,
  onRowAppended,
  onVisibleRegionChanged,
  onSelectionChange,
  className,
  freezeColumns = 0,
  rowMarkers = "none",
  headerHeight = 28,
  rowHeight = 28,
  isLoading = false,
  isLoadingMore = false,
  estimatedTotal,
}: EnhancedGlideWrapperProps) {
  const { theme: appTheme } = useTheme();

  // Custom text cell renderer with optimized ellipsis
  const drawTextCell: DrawCellCallback = useCallback((args, cell, drawContent) => {
    // Only handle text cells
    if (cell.kind !== GridCellKind.Text) return false;
    
    const { ctx, rect, theme } = args;
    const { x, y, width, height } = rect;
    const text = String(cell.displayData || cell.data || "");
    
    // Don't render empty text
    if (!text || text === "NULL") {
      // Use default renderer for NULL values
      return false;
    }
    
    // Save context state
    ctx.save();
    
    // Clear the cell area first
    ctx.fillStyle = theme.bgCell;
    ctx.fillRect(x, y, width, height);
    
    // Set up text rendering
    ctx.fillStyle = theme.textDark;
    ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    
    // Calculate text position
    const padding = 8;
    const textX = x + padding;
    const textY = y + height / 2;
    const maxWidth = width - (padding * 2);
    
    // Measure text
    const textMetrics = ctx.measureText(text);
    
    if (textMetrics.width <= maxWidth) {
      // Text fits - render normally
      ctx.fillText(text, textX, textY);
    } else {
      // Text overflows - add ellipsis
      const ellipsis = '\u2026';
      const ellipsisWidth = ctx.measureText(ellipsis).width;
      const availableWidth = maxWidth - ellipsisWidth;
      
      // Binary search for truncation point
      let left = 0;
      let right = text.length;
      
      while (left < right) {
        const mid = Math.ceil((left + right) / 2);
        const testText = text.substring(0, mid);
        const testWidth = ctx.measureText(testText).width;
        
        if (testWidth <= availableWidth) {
          left = mid;
        } else {
          right = mid - 1;
        }
      }
      
      // Draw truncated text with ellipsis
      const truncatedText = text.substring(0, left);
      ctx.fillText(truncatedText + ellipsis, textX, textY);
    }
    
    // Restore context
    ctx.restore();
    
    return true;
  }, []);
  const { copy } = useCopy();
  const { toast } = useToast();
  const gridRef = useRef<DataEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollOptimizationRef = useRef<{
    lastScroll: number;
    rafId: number | null;
  }>({
    lastScroll: 0,
    rafId: null,
  });

  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  const [popupState, setPopupState] = useState<{
    isOpen: boolean;
    value: unknown;
    columnName: string;
    rowIndex: number;
  }>({
    isOpen: false,
    value: null,
    columnName: "",
    rowIndex: 0,
  });

  const [contextMenuState, setContextMenuState] = useState<{
    cell: Item | null;
    position: { x: number; y: number } | null;
  }>({
    cell: null,
    position: null,
  });

  // Create theme based on app theme matching our color system
  const theme = useMemo<Partial<Theme>>(() => {
    const isDark = appTheme === "dark";

    return {
      // Accent colors using our brand colors
      accentColor: "#FCA311", // Primary brand color
      accentLight: "rgba(252, 163, 17, 0.1)",
      accentFg: "#09090B",

      // Text colors matching our theme
      textDark: isDark ? "#AEACA8" : "#09090B",
      textMedium: isDark ? "rgba(229, 229, 229, 0.7)" : "rgba(0, 0, 0, 0.7)",
      textLight: isDark ? "rgba(229, 229, 229, 0.5)" : "rgba(0, 0, 0, 0.5)",
      textBubble: isDark ? "#AEACA8" : "#09090B",

      // Header colors
      bgIconHeader: isDark ? "#14213D" : "#F5F5F5",
      fgIconHeader: isDark ? "#D1D5DB" : "#111827",
      textHeader: isDark ? "#D1D5DB" : "#111827",
      textHeaderSelected: isDark ? "#F3F4F6" : "#111827",
      bgHeaderSelected: "transparent",

      // Cell backgrounds matching our surface colors
      bgCell: isDark ? "#09090B" : "#FFFFFF",
      bgCellMedium: isDark ? "#0A0A0A" : "#FAFAFA",
      bgHeader: isDark ? "#1C1C21" : "#F5F5F5",
      bgHeaderHasFocus: isDark ? "#1C1C21" : "#F5F5F5",
      bgHeaderHovered: isDark ? "#2A2A30" : "#E8E8E8",

      // Other backgrounds
      bgBubble: isDark ? "#14213D" : "#F5F5F5",
      bgBubbleSelected: "#FCA311",

      // Row selection highlight
      bgCellSelected: isDark
        ? "rgba(252, 163, 17, 0.1)"
        : "rgba(252, 163, 17, 0.05)",
      bgCellSelectedMedium: isDark
        ? "rgba(252, 163, 17, 0.15)"
        : "rgba(252, 163, 17, 0.08)",

      bgSearchResult: "rgba(252, 163, 17, 0.2)",

      // Borders
      borderColor: isDark ? "rgba(229, 229, 229, 0.1)" : "rgba(0, 0, 0, 0.1)",
      horizontalBorderColor: isDark
        ? "rgba(229, 229, 229, 0.05)"
        : "rgba(0, 0, 0, 0.05)",
      drilldownBorder: isDark
        ? "rgba(229, 229, 229, 0.2)"
        : "rgba(0, 0, 0, 0.2)",

      linkColor: "#FCA311",

      cellHorizontalPadding: 6,
      cellVerticalPadding: 3,

      headerFontStyle: "600 12px",
      baseFontStyle: "400 12px",
      editorFontSize: "12px",
      lineHeight: 1.5,

      fontFamily: [
        "Noto Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica",
        "Arial",
        "sans-serif",
      ].join(", "),
    };
  }, [appTheme]);

  // Handle selection change - auto-select row when cell is selected
  const handleSelectionChange = useCallback(
    (newSelection: GridSelection | undefined) => {
      if (newSelection) {
        let updatedRowSelection = CompactSelection.empty();

        // Check for range selection (when dragging)
        if (newSelection.current?.range) {
          // Range selection - add all rows in the range
          const range = newSelection.current.range;
          for (let row = range.y; row < range.y + range.height; row++) {
            updatedRowSelection = updatedRowSelection.add(row);
          }
        } else if (newSelection.current?.cell) {
          // Single cell selection
          const rowIndex = newSelection.current.cell[1];
          updatedRowSelection = updatedRowSelection.add(rowIndex);
        }

        const updatedSelection = {
          ...newSelection,
          rows: updatedRowSelection,
        };
        setGridSelection(updatedSelection);

        // Notify parent of selection count change
        const selectedCount = updatedRowSelection.length;
        onSelectionChange?.(selectedCount);
      }
    },
    [onSelectionChange],
  );

  // Handle cell double click - show popup
  const handleCellDoubleClick = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      if (getCellValue && columns[col]) {
        const value = getCellValue(cell);
        const column = columns[col];

        setPopupState({
          isOpen: true,
          value,
          columnName: column.title,
          rowIndex: row,
        });
      }

      onCellDoubleClick?.(cell);
    },
    [columns, getCellValue, onCellDoubleClick],
  );

  // Handle cell click
  const handleCellClick = useCallback(
    (cell: Item, _event: GridMouseEventArgs) => {
      onCellClicked?.(cell);
    },
    [onCellClicked],
  );

  // Get cells for selection (copy operation)
  const getCellsForSelection = useCallback(
    (selection: Rectangle): (readonly GridCell[])[] => {
      const result: GridCell[][] = [];

      for (let y = selection.y; y < selection.y + selection.height; y++) {
        const row: GridCell[] = [];
        for (let x = selection.x; x < selection.x + selection.width; x++) {
          row.push(getCellContent([x, y]));
        }
        result.push(row);
      }

      return result;
    },
    [getCellContent],
  );

  // Format cells as CSV
  const formatCellsAsCsv = useCallback((cells: (readonly GridCell[])[]) => {
    return cells
      .map((row) =>
        row
          .map((cell) => {
            const value = (cell as any).displayData || (cell as any).data;
            if (
              typeof value === "string" &&
              (value.includes(",") ||
                value.includes('"') ||
                value.includes("\n"))
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return String(value);
          })
          .join(","),
      )
      .join("\n");
  }, []);

  // Format cells as JSON
  const formatCellsAsJson = useCallback((cells: (readonly GridCell[])[]) => {
    const data = cells.map((row) => row.map((cell) => (cell as any).data));
    return JSON.stringify(data, null, 2);
  }, []);

  // Handle copy with format
  const handleCopyWithFormat = useCallback(
    (format: "text" | "csv" | "json") => {
      // Get the current selection
      const selection = gridSelection;
      if (!selection.rows || selection.rows.length === 0) {
        toast({
          title: "No selection",
          description: "Please select cells to copy",
        });
        return;
      }

      // Get selected bounds
      const selectedRows = selection.rows.toArray();
      const selectedCols = selection.columns.toArray();

      // If no columns selected, select all
      const cols =
        selectedCols.length > 0 ? selectedCols : columns.map((_, i) => i);

      // Get cells for selection
      const cells: GridCell[][] = [];
      for (const row of selectedRows) {
        const rowCells: GridCell[] = [];
        for (const col of cols) {
          rowCells.push(getCellContent([col, row]));
        }
        cells.push(rowCells);
      }

      let content: string;

      switch (format) {
        case "csv":
          content = formatCellsAsCsv(cells);
          break;
        case "json":
          content = formatCellsAsJson(cells);
          break;
        default:
          content = cells
            .map((row) =>
              row
                .map((cell) => (cell as any).displayData || (cell as any).data)
                .join("\t"),
            )
            .join("\n");
      }

      void copy(content);
      toast({
        title: "Copied to clipboard",
        description: `Selection copied as ${format.toUpperCase()}`,
      });
    },
    [
      gridSelection,
      columns,
      getCellContent,
      formatCellsAsCsv,
      formatCellsAsJson,
      copy,
      toast,
    ],
  );

  // Handle paste operation
  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!onCellEdited) return false;

      // For now, just paste the first value to the target cell
      if (values.length > 0 && values[0]?.length > 0) {
        const newCell = getCellContent(target);
        if (newCell.kind === GridCellKind.Text) {
          onCellEdited(target, {
            ...newCell,
            data: values[0][0] ?? "",
          } as GridCell);
          return true;
        }
      }
      return false;
    },
    [getCellContent, onCellEdited],
  );

  // Handle context menu
  const onCellContextMenu = useCallback(
    (cell: Item, event: GridMouseEventArgs) => {
      if ("bounds" in event) {
        setContextMenuState({
          cell,
          position: { x: event.bounds.x, y: event.bounds.y },
        });
      }
    },
    [],
  );

  // Handle visible region change with optimization
  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle, _tx: number, _ty: number) => {
      const now = performance.now();

      // Throttle updates to 60fps
      if (now - scrollOptimizationRef.current.lastScroll < 16) {
        return;
      }

      scrollOptimizationRef.current.lastScroll = now;

      // Cancel previous RAF if exists
      if (scrollOptimizationRef.current.rafId) {
        cancelAnimationFrame(scrollOptimizationRef.current.rafId);
      }

      // Use RAF for smooth updates
      scrollOptimizationRef.current.rafId = requestAnimationFrame(() => {
        onVisibleRegionChanged?.(range);
      });
    },
    [onVisibleRegionChanged],
  );

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (scrollOptimizationRef.current.rafId) {
        cancelAnimationFrame(scrollOptimizationRef.current.rafId);
      }
    };
  }, []);

  // Show full loading screen only for initial load (when no data exists)
  if (isLoading && rows === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full w-full",
          className,
        )}
      >
        <div className="text-muted-foreground">
          Loading data...
          {estimatedTotal && (
            <div className="text-xs mt-1">
              Estimated {estimatedTotal.toLocaleString()} rows
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={containerRef}
            className={cn("glide-data-grid-wrapper relative w-full", className)}
            style={{
              height: "100%",
              contain: "paint layout",
              willChange: "transform",
              transform: "translateZ(0)", // Force GPU acceleration
            }}
          >
            <DataEditor
              ref={gridRef}
              columns={columns}
              rows={rows}
              getCellContent={getCellContent}
              onCellClicked={handleCellClick}
              onCellActivated={handleCellDoubleClick}
              onCellEdited={onCellEdited}
              onColumnResize={onColumnResize}
              onColumnResizeEnd={onColumnResizeEnd}
              onColumnMoved={onColumnMoved}
              onHeaderMenuClick={(col, bounds) => {
                // Handle header menu if needed
                console.log("Header menu clicked", col, bounds);
              }}
              onRowAppended={onRowAppended}
              getCellsForSelection={getCellsForSelection}
              onPaste={onPaste}
              onCellContextMenu={onCellContextMenu}
              onVisibleRegionChanged={handleVisibleRegionChanged}
              gridSelection={gridSelection}
              onGridSelectionChange={handleSelectionChange}
              theme={theme}
              width="100%"
              height="100%"
              showSearch={false}
              searchResults={[]}
              freezeColumns={freezeColumns}
              smoothScrollX={true}
              smoothScrollY={true}
              rowMarkers={rowMarkers}
              headerHeight={headerHeight}
              rowHeight={rowHeight}
              // drawCell={drawTextCell} // Disabled - custom renderer breaks text display
              overscrollX={0}
              overscrollY={0}
              rangeSelect="rect"
              columnSelect="single"
              rowSelect="multi"
              fillHandle={false}
              maxColumnWidth={800}
              minColumnWidth={50}
              // getCellsForSelection
              // experimental={
              //   {
              //     renderStrategy: "single-pass",
              //   } as any
              // }
              keybindings={{
                search: false,
                downFill: false,
                rightFill: false,
                pageUp: true,
                pageDown: true,
                clear: false,
                copy: true,
                paste: false,
                selectAll: true,
                selectColumn: true,
                selectRow: true,
              }}
            />
          </div>
        </ContextMenuTrigger>

        {/* Load more indicator - show skeleton at bottom when loading more */}
        {isLoadingMore && (
          <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm border-t p-2">
            <div className="flex items-center justify-center space-x-2 text-muted-foreground text-xs">
              <div className="animate-spin rounded-full h-4 w-4 border-b border-primary"></div>
              <span>Loading more rows...</span>
            </div>
          </div>
        )}

        <ContextMenuContent className="text-xs">
          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("text");
            }}
          >
            <Copy className="mr-2 h-3 w-3" />
            Copy
            <ContextMenuShortcut className="text-[10px]">⌘C</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("csv");
            }}
          >
            <Table className="mr-2 h-3 w-3" />
            Copy as CSV
          </ContextMenuItem>

          <ContextMenuItem
            className="text-xs py-1 px-2 h-7"
            onClick={() => {
              handleCopyWithFormat("json");
            }}
          >
            <FileJson className="mr-2 h-3 w-3" />
            Copy as JSON
          </ContextMenuItem>

          <ContextMenuSeparator className="my-0.5" />

          {getCellValue && contextMenuState.cell && (
            <ContextMenuItem
              className="text-xs py-1 px-2 h-7"
              onClick={() => {
                if (contextMenuState.cell) {
                  handleCellDoubleClick(contextMenuState.cell);
                }
              }}
            >
              <Eye className="mr-2 h-3 w-3" />
              View Cell Value
            </ContextMenuItem>
          )}

          <ContextMenuSeparator className="my-0.5" />

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <Search className="mr-2 h-3 w-3" />
            Search in Column
            <ContextMenuShortcut className="text-[10px]">⌘F</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <Filter className="mr-2 h-3 w-3" />
            Filter Column
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <SortAsc className="mr-2 h-3 w-3" />
            Sort Ascending
          </ContextMenuItem>

          <ContextMenuItem disabled className="text-xs py-1 px-2 h-7">
            <SortDesc className="mr-2 h-3 w-3" />
            Sort Descending
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CellValuePopup
        isOpen={popupState.isOpen}
        onClose={() => {
          setPopupState((prev) => ({ ...prev, isOpen: false }));
        }}
        value={popupState.value}
        columnName={popupState.columnName}
        rowIndex={popupState.rowIndex}
      />
    </>
  );
});
