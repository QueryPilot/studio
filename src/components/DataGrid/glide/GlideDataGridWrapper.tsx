import { useMemo, useCallback, useState, useRef } from "react";
import DataEditor, {
  type GridCell,
  type GridColumn,
  type Item,
  type Rectangle,
  type GridSelection,
  GridCellKind,
  type DataEditorRef,
  type Theme,
  CompactSelection,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useCopy } from "@/hooks/useCopy";
import { useToast } from "@/hooks/use-toast";

interface GlideDataGridWrapperProps {
  columns: GridColumn[];
  rows: number;
  getCellContent: (cell: Item) => GridCell;
  onCellClicked?: (cell: Item) => void;
  onCellEdited?: (cell: Item, newValue: GridCell) => void;
  onColumnResize?: (column: GridColumn, newSize: number, colIndex: number) => void;
  onRowAppended?: () => void;
  className?: string;
  height?: number;
  showSearch?: boolean;
  freezeColumns?: number;
  smoothScrollX?: boolean;
  smoothScrollY?: boolean;
  rowMarkers?: "none" | "number" | "checkbox" | "both";
  headerHeight?: number;
  rowHeight?: number;
  isLoading?: boolean;
}

export function GlideDataGridWrapper({
  columns,
  rows,
  getCellContent,
  onCellClicked,
  onCellEdited,
  onColumnResize,
  onRowAppended,
  className,
  height = 600,
  showSearch = true,
  freezeColumns = 0,
  smoothScrollX = true,
  smoothScrollY = false,
  rowMarkers = "number",
  headerHeight = 36,
  rowHeight = 34,
  isLoading = false,
}: GlideDataGridWrapperProps) {
  const { theme: appTheme } = useTheme();
  const { copy } = useCopy();
  const { toast } = useToast();
  const gridRef = useRef<DataEditorRef>(null);
  
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });

  // Create theme based on app theme
  const theme = useMemo<Partial<Theme>>(() => {
    const isDark = appTheme === "dark";
    
    return {
      accentColor: isDark ? "#3b82f6" : "#2563eb",
      accentLight: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(37, 99, 235, 0.1)",
      accentFg: "#ffffff",
      
      textDark: isDark ? "#f3f4f6" : "#111827",
      textMedium: isDark ? "#9ca3af" : "#6b7280",
      textLight: isDark ? "#6b7280" : "#9ca3af",
      textBubble: isDark ? "#f3f4f6" : "#111827",
      
      bgIconHeader: isDark ? "#1f2937" : "#f9fafb",
      fgIconHeader: isDark ? "#9ca3af" : "#6b7280",
      textHeader: isDark ? "#d1d5db" : "#374151",
      textHeaderSelected: "#ffffff",
      
      bgCell: isDark ? "#111827" : "#ffffff",
      bgCellMedium: isDark ? "#1f2937" : "#f9fafb",
      bgHeader: isDark ? "#1f2937" : "#f3f4f6",
      bgHeaderHasFocus: isDark ? "#374151" : "#e5e7eb",
      bgHeaderHovered: isDark ? "#374151" : "#e5e7eb",
      
      bgBubble: isDark ? "#374151" : "#f3f4f6",
      bgBubbleSelected: isDark ? "#3b82f6" : "#2563eb",
      
      bgSearchResult: isDark ? "#fbbf24" : "#fef3c7",
      
      borderColor: isDark ? "rgba(75, 85, 99, 0.4)" : "rgba(209, 213, 219, 0.4)",
      horizontalBorderColor: isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.2)",
      drilldownBorder: isDark ? "rgba(75, 85, 99, 0.4)" : "rgba(209, 213, 219, 0.4)",
      
      linkColor: isDark ? "#60a5fa" : "#3b82f6",
      
      cellHorizontalPadding: 8,
      cellVerticalPadding: 3,
      
      headerFontStyle: "600 13px",
      baseFontStyle: "13px",
      editorFontSize: "13px",
      lineHeight: 1.5,
      
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace",
    };
  }, [appTheme]);

  // Handle cell selection for copy
  const handleSelectionChange = useCallback((newSelection: GridSelection | undefined) => {
    if (newSelection) {
      setGridSelection(newSelection);
    }
  }, []);

  // Handle copy operation
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
    [getCellContent]
  );

  // Handle paste operation
  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      if (!onCellEdited) return false;
      
      // For now, just paste the first value to the target cell
      if (values.length > 0 && values[0].length > 0) {
        const newCell = getCellContent(target);
        if (newCell.kind === GridCellKind.Text) {
          onCellEdited(target, { ...newCell, data: values[0][0] });
          return true;
        }
      }
      return false;
    },
    [getCellContent, onCellEdited]
  );

  // Handle keyboard shortcuts
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl/Cmd + F for search
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      // The showSearch prop already handles this
    }
  }, []);

  // Handle cell context menu
  const onCellContextMenu = useCallback(
    (cell: Item, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      
      const cellContent = getCellContent(cell);
      const cellData = cellContent.displayData || cellContent.data;
      
      // Simple copy to clipboard on right-click
      if (cellData) {
        copy(String(cellData));
        toast({
          title: "Copied to clipboard",
          description: `Cell value copied`,
          duration: 2000,
        });
      }
    },
    [getCellContent, copy, toast]
  );

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center", className)} style={{ height }}>
        <div className="text-muted-foreground">Loading data...</div>
      </div>
    );
  }

  return (
    <div 
      className={cn("glide-data-grid-wrapper relative", className)}
      style={{ height }}
      onKeyDown={onKeyDown}
    >
      <DataEditor
        ref={gridRef}
        columns={columns}
        rows={rows}
        getCellContent={getCellContent}
        onCellClicked={onCellClicked}
        onCellEdited={onCellEdited}
        onColumnResize={onColumnResize}
        onRowAppended={onRowAppended}
        getCellsForSelection={getCellsForSelection}
        onPaste={onPaste}
        onCellContextMenu={onCellContextMenu}
        gridSelection={gridSelection}
        onGridSelectionChange={handleSelectionChange}
        theme={theme}
        width={undefined}
        height={height}
        showSearch={showSearch}
        searchResults={[]}
        freezeColumns={freezeColumns}
        smoothScrollX={smoothScrollX}
        smoothScrollY={smoothScrollY}
        rowMarkers={rowMarkers}
        headerHeight={headerHeight}
        rowHeight={rowHeight}
        drawCell={undefined}
        rangeSelect="rect"
        columnSelect="multi"
        rowSelect="multi"
        fillHandle={true}
        allowResize={true}
        maxColumnWidth={500}
        minColumnWidth={50}
        keybindings={{
          search: true,
          downFill: true,
          rightFill: true,
          pageUp: true,
          pageDown: true,
          clear: true,
          copy: true,
          paste: true,
          selectAll: true,
          selectColumn: true,
          selectRow: true,
        }}
      />
    </div>
  );
}