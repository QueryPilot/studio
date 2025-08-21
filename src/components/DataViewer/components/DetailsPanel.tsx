import { memo, useMemo, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import { X, FileJson, TableProperties } from "lucide-react";
import { type DetailViewMode } from "../types";
import { PreviewTable } from "./PreviewTable";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { defineThemes } from "@/components/QueryEditor/monacoTheme";

interface RowData {
  id: string;
  original?: Record<string, unknown>;
  _rowIndex?: number;
  [key: string]: unknown;
}

interface DetailsPanelProps {
  showDetails: boolean;
  getSelectionDetails: Record<string, unknown> | null;
  selectedRow: Record<string, unknown> | null;
  selectedRowIds: Set<string>;
  detailViewMode: DetailViewMode;
  setDetailViewMode: (mode: DetailViewMode) => void;
  setShowDetails: (show: boolean) => void;
  setSelectedRowIds: (selection: Set<string>) => void;
  setSelectedRow: (row: Record<string, unknown> | null) => void;
  rows: RowData[];
}

export const DetailsPanel = memo(
  ({
    showDetails,
    getSelectionDetails,
    selectedRow,
    selectedRowIds,
    detailViewMode,
    setDetailViewMode,
    setShowDetails,
    setSelectedRowIds,
    setSelectedRow,
    rows,
  }: DetailsPanelProps) => {
    if (!showDetails) return null;

    const hasSelection = getSelectionDetails || selectedRow;

    return (
      <div className="flex flex-col h-full bg-muted/10 border-t">
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted/50 border rounded-md p-0.5">
              <ToggleButton
                isActive={detailViewMode === "table"}
                onClick={() => {
                  setDetailViewMode("table");
                }}
              >
                <TableProperties className="h-3 w-3 mr-1" />
                Preview
              </ToggleButton>
              <ToggleButton
                isActive={detailViewMode === "json"}
                onClick={() => {
                  setDetailViewMode("json");
                }}
              >
                <FileJson className="h-3 w-3 mr-1" />
                JSON
              </ToggleButton>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => {
              setShowDetails(false);
              setSelectedRowIds(new Set());
              setSelectedRow(null);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        {hasSelection ? (
          detailViewMode === "table" ? (
            <div className="flex-1 overflow-auto">
              <PreviewTable data={getSelectionDetails || selectedRow || {}} />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <DetailsPanelJSON
                selectedRowIds={selectedRowIds}
                getSelectionDetails={getSelectionDetails}
                selectedRow={selectedRow}
                rows={rows}
              />
            </div>
          )
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground text-xs">
              Select a row to preview
            </p>
          </div>
        )}
      </div>
    );
  },
);

DetailsPanel.displayName = "DetailsPanel";

// Separate component for JSON view to optimize rendering
const DetailsPanelJSON = memo(
  ({
    selectedRowIds,
    getSelectionDetails,
    selectedRow,
    rows,
  }: {
    selectedRowIds: Set<string>;
    getSelectionDetails: Record<string, unknown> | null;
    selectedRow: Record<string, unknown> | null;
    rows: RowData[];
  }) => {
    const { theme } = useTheme();
    // Use deferred value for JSON content to prevent blocking renders
    const deferredSelectedRowIds = useDeferredValue(selectedRowIds);

    // Memoize the expensive JSON calculation with deferred values
    const jsonContent = useMemo(() => {
      const selectedIds = Array.from(deferredSelectedRowIds);

      if (selectedIds.length > 1) {
        const selectedRows = selectedIds
          .map((id) => {
            const row = rows.find((r) => r.id === id);
            return row?.original || row;
          })
          .filter(Boolean)
          .map((row) => {
            const cleanRow = { ...row } as Record<string, unknown>;
            delete cleanRow._rowIndex;
            return cleanRow;
          });
        return JSON.stringify(selectedRows, null, 2);
      } else {
        const data = getSelectionDetails || selectedRow || {};
        const cleanData = Object.fromEntries(
          Object.entries(data).filter(([key]) => key !== "_rowIndex"),
        );
        return JSON.stringify(cleanData, null, 2);
      }
    }, [deferredSelectedRowIds, getSelectionDetails, selectedRow, rows]);

    return (
      <Editor
        height="100%"
        defaultLanguage="json"
        value={jsonContent}
        theme={theme === "dark" ? "devdb-dark" : "devdb-light"}
        beforeMount={(monaco) => {
          defineThemes(monaco);
        }}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: "off",
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          renderLineHighlight: "none",
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    );
  },
);

DetailsPanelJSON.displayName = "DetailsPanelJSON";
