import { forwardRef, type Ref, useMemo, useState, useCallback } from "react";
import DataEditor, {
  type DataEditorProps,
  type DataEditorRef,
  type GridMouseEventArgs,
  type Rectangle,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import "../styles/datagrid-overrides.css";
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
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);

  const { width = "100%", height = "100%", className, ...editorProps } = rest;

  // Create theme based on app theme (use resolvedTheme to get actual "dark" or "light" even when "system" is selected)
  const theme = useMemo(
    () => createDataGridTheme(resolvedTheme || "light"),
    [resolvedTheme],
  );

  // Handle item hover to track row and cell
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind === "cell") {
        setHoveredRow(args.location[1]);
        setHoveredCell([args.location[0], args.location[1]]);
      } else {
        setHoveredRow(null);
        setHoveredCell(null);
      }
      // Call external handler if provided
      rest.onItemHovered?.(args);
    },
    [rest.onItemHovered]
  );

  // Merge row hover with external getRowThemeOverride
  const mergedGetRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Get external override first
      const externalOverride = rest.getRowThemeOverride?.(rowIndex);

      // Apply hover highlight (merge with external override)
      if (rowIndex === hoveredRow) {
        const hoverBgCell = resolvedTheme === "dark"
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
    [rest.getRowThemeOverride, hoveredRow, resolvedTheme]
  );

  // Create cell highlight region for hovered cell
  const cellHighlightRegions = useMemo(() => {
    const regions: { color: string; range: Rectangle }[] = [];

    // Add external highlight regions if provided
    if (rest.highlightRegions) {
      regions.push(...rest.highlightRegions);
    }

    // Add hovered cell highlight
    if (hoveredCell) {
      regions.push({
        color: resolvedTheme === "dark"
          ? "rgba(255, 255, 255, 0.08)"
          : "rgba(0, 0, 0, 0.05)",
        range: {
          x: hoveredCell[0],
          y: hoveredCell[1],
          width: 1,
          height: 1,
        },
      });
    }

    return regions.length > 0 ? regions : undefined;
  }, [hoveredCell, resolvedTheme, rest.highlightRegions]);

  const containerClasses = cn(
    "relative h-full w-full overflow-hidden rounded-md bg-background",
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
