import {
  forwardRef,
  type Ref,
  useMemo,
  useCallback,
  useRef,
  useImperativeHandle,
} from "react";
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

  // Internal grid ref for updateCells
  const internalGridRef = useRef<DataEditorRef>(null);

  // Expose internal ref via forwarded ref
  useImperativeHandle(ref, () => internalGridRef.current as DataEditorRef, []);

  // Use ref instead of state to avoid re-renders on every mouse move
  // Glide DataGrid calls getRowThemeOverride during draw, so ref access works
  const hoveredRowRef = useRef<number | null>(null);

  // Destructure props that we handle explicitly to prevent them from being overridden by editorProps spread
  const {
    width = "100%",
    height = "100%",
    className,
    getRowThemeOverride: externalGetRowThemeOverride,
    highlightRegions: externalHighlightRegions,
    onItemHovered: externalOnItemHovered,
    ...editorProps
  } = rest;

  // Create theme based on app theme (use resolvedTheme to get actual "dark" or "light" even when "system" is selected)
  const theme = useMemo(
    () => createDataGridTheme(resolvedTheme || "light"),
    [resolvedTheme],
  );

  // Handle item hover - update ref and trigger redraw for affected rows
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      const newRow = args.kind === "cell" ? args.location[1] : null;
      const prevRow = hoveredRowRef.current;

      // Only update if row changed
      if (prevRow !== newRow) {
        hoveredRowRef.current = newRow;

        // Damage the affected rows to trigger redraw with new hover state
        const cellsToDamage: { cell: [number, number] }[] = [];
        const colCount = columns.length;

        // Damage all cells in the previous hovered row
        if (prevRow !== null) {
          for (let col = 0; col < colCount; col++) {
            cellsToDamage.push({ cell: [col, prevRow] });
          }
        }

        // Damage all cells in the new hovered row
        if (newRow !== null) {
          for (let col = 0; col < colCount; col++) {
            cellsToDamage.push({ cell: [col, newRow] });
          }
        }

        // Trigger redraw
        if (cellsToDamage.length > 0) {
          internalGridRef.current?.updateCells(cellsToDamage);
        }
      }

      externalOnItemHovered?.(args);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalOnItemHovered, columns.length],
  );

  // Merge row hover with external getRowThemeOverride
  // This is called during draw, so ref access is fine
  const mergedGetRowThemeOverride = useCallback(
    (rowIndex: number) => {
      // Get external override first
      const externalOverride = externalGetRowThemeOverride?.(rowIndex);

      // Apply hover highlight (merge with external override)
      if (rowIndex === hoveredRowRef.current) {
        // Use primary color oklch(0.75 0.16 70) = #ED990E for hover
        // Light: #FAF8F5 base + 8% primary = #F9F0E3
        // Dark: #110F0C base + 12% primary = #2B200C
        const hoverBgCell =
          resolvedTheme === "dark"
            ? "#2B200C"
            : "#F9F0E3";

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
    [externalGetRowThemeOverride, resolvedTheme],
  );

  // Pass through highlight regions - cell highlight handled by Glide's native hover
  const cellHighlightRegions = externalHighlightRegions;

  const containerClasses = cn(
    "relative h-full w-full overflow-hidden bg-background",
    containerClassName,
  );

  const editorClasses = cn("gdg-style", className);

  return (
    <div className={containerClasses}>
      <DataEditor
        ref={internalGridRef}
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
        editOnType={true}
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
