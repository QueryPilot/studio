import { forwardRef, type Ref, useMemo, useCallback, useRef } from "react";
import DataEditor, {
  type DataEditorProps,
  type DataEditorRef,
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import "../styles/datagrid-overrides.css";
import "../styles/datagrid-variables.css";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { createDataGridTheme } from "../theme/gridTheme";
import type { GridColumnV2 } from "../types";

export interface DataGridBaseProps
  extends Omit<DataEditorProps, "rows" | "columns" | "getCellContent"> {
  columns: GridColumnV2[];
  rowCount: number;
  getCellContent: DataEditorProps["getCellContent"];
  /** Optional class name applied to the wrapping div */
  containerClassName?: string;
  /** Optional row override provider for highlighting */
  getRowThemeOverride?: DataEditorProps["getRowThemeOverride"];
  /** Optional rectangular highlight regions */
  highlightRegions?: DataEditorProps["highlightRegions"];
  /** Optional keybindings override */
  keybindings?: DataEditorProps["keybindings"];
  /** Optional header click handler for sorting */
  onHeaderClicked?: DataEditorProps["onHeaderClicked"];
  /** Optional custom header draw function */
  drawHeader?: DataEditorProps["drawHeader"];
  /** Optional header context menu handler */
  onHeaderContextMenu?: DataEditorProps["onHeaderContextMenu"];
  /** Optional item hover handler */
  onItemHovered?: DataEditorProps["onItemHovered"];
  /** Optional custom cell draw function */
  drawCell?: DataEditorProps["drawCell"];
}

export const DataGridBase = forwardRef(function DataGridBase(
  props: DataGridBaseProps,
  ref: Ref<DataEditorRef>,
) {
  const { columns, rowCount, getCellContent, containerClassName, ...rest } =
    props;
  const { resolvedTheme } = useTheme();

  // Use ref instead of state to avoid re-renders on every mouse move
  // Glide DataGrid calls getRowThemeOverride during draw, so ref access works
  const hoveredRowRef = useRef<number | null>(null);

  const { width = "100%", height = "100%", className, ...editorProps } = rest;

  // Create theme based on app theme (use resolvedTheme to get actual "dark" or "light" even when "system" is selected)
  const theme = useMemo(
    () => createDataGridTheme(resolvedTheme || "light"),
    [resolvedTheme],
  );

  // Handle item hover - just update ref, no state changes = no re-renders
  // The theme override callback reads from ref during draw
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      hoveredRowRef.current = args.kind === "cell" ? args.location[1] : null;
      rest.onItemHovered?.(args);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rest.onItemHovered],
  );

  // Merge row hover with external getRowThemeOverride
  // This is called during draw, so ref access is fine
  const mergedGetRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Get external override first
      const externalOverride = rest.getRowThemeOverride?.(rowIndex);

      // Apply hover highlight (merge with external override)
      if (rowIndex === hoveredRowRef.current) {
        const hoverBgCell =
          resolvedTheme === "dark"
            ? "rgba(255, 255, 255, 0.04)"
            : "rgba(0, 0, 0, 0.03)";

        // Merge hover bg with external override if exists
        if (externalOverride) {
          return {
            ...externalOverride,
            // Only apply hover bg if external doesn't have a specific bgCell
            bgCell: externalOverride.bgCell || hoverBgCell,
          };
        }

        return { bgCell: hoverBgCell };
      }

      return externalOverride;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rest.getRowThemeOverride, resolvedTheme],
  );

  // Pass through highlight regions - cell highlight handled by Glide's native hover
  const cellHighlightRegions = rest.highlightRegions;

  const containerClasses = cn(
    "relative h-full w-full overflow-hidden bg-background",
    containerClassName,
  );

  const editorClasses = cn("gdg-style", className);

  return (
    <div className={containerClasses}>
      <DataEditor
        ref={ref}
        columns={columns}
        rows={rowCount}
        getCellContent={getCellContent}
        width={width}
        height={height}
        theme={theme}
        className={editorClasses}
        smoothScrollX={true}
        smoothScrollY={true}
        rowHeight={28}
        headerHeight={28}
        getRowThemeOverride={mergedGetRowThemeOverride}
        highlightRegions={cellHighlightRegions}
        keybindings={rest.keybindings} // Undefined by default = Glide's native copy/paste enabled
        columnSelect="multi"
        rowSelect="multi"
        editOnType={false}
        fixedShadowX={false}
        fixedShadowY={false}
        fillHandle
        getCellsForSelection={true} // Enable copy functionality
        {...editorProps}
        onItemHovered={handleItemHovered}
      />
    </div>
  );
});

DataGridBase.displayName = "DataGridBase";
