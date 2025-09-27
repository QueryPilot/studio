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
}

export const DataGridBase = forwardRef(function DataGridBase(
  props: DataGridBaseProps,
  ref: Ref<DataEditorRef>,
) {
  const { columns, rowCount, getCellContent, containerClassName, ...rest } = props;
  const { theme: appTheme } = useTheme();

  const { width = "100%", height = "100%", ...editorProps } = rest;

  // Create theme based on app theme
  const theme = useMemo(() => createDataGridTheme(appTheme || "light"), [appTheme]);

  return (
    <div className={cn("relative h-full w-full", containerClassName)}>
      <DataEditor
        ref={ref}
        columns={columns}
        rows={rowCount}
        getCellContent={getCellContent}
        width={width}
        height={height}
        theme={theme}
        smoothScrollX={true}
        smoothScrollY={true}
        rowHeight={28}
        headerHeight={28}
        {...editorProps}
      />
    </div>
  );
});

DataGridBase.displayName = "DataGridBase";
