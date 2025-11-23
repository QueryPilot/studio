import { forwardRef, type Ref, useMemo } from "react";
import DataEditor, {
  type DataEditorProps,
  type DataEditorRef,
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

  const { width = "100%", height = "100%", className, ...editorProps } = rest;

  // Create theme based on app theme (use resolvedTheme to get actual "dark" or "light" even when "system" is selected)
  const theme = useMemo(
    () => createDataGridTheme(resolvedTheme || "light"),
    [resolvedTheme],
  );

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
        getRowThemeOverride={rest.getRowThemeOverride}
        highlightRegions={rest.highlightRegions}
        keybindings={rest.keybindings} // Undefined by default = Glide's native copy/paste enabled
        columnSelect="multi"
        rowSelect="multi"
        editOnType={false}
        fixedShadowX={false}
        fixedShadowY={false}
        fillHandle
        getCellsForSelection={true} // Enable copy functionality
        {...editorProps}
      />
    </div>
  );
});

DataGridBase.displayName = "DataGridBase";
