import { memo, useMemo, useDeferredValue } from "react";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, FileJson, TableProperties } from "lucide-react";
import { DetailViewMode } from "../types";
import { PreviewTable } from "./PreviewTable";

interface DetailsPanelProps {
  showDetails: boolean;
  getSelectionDetails: any;
  selectedRow: any;
  selectedRowIds: Set<string>;
  detailViewMode: DetailViewMode;
  setDetailViewMode: (mode: DetailViewMode) => void;
  setShowDetails: (show: boolean) => void;
  setSelectedRowIds: (selection: Set<string>) => void;
  setSelectedRow: (row: any) => void;
  rows: any[];
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
    if (!showDetails || (!getSelectionDetails && !selectedRow)) return null;

    return (
      <div className="flex flex-col h-full bg-muted/10 border-t">
        <div className="flex items-center justify-between px-2 py-1 border-b bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted/50 border rounded-md p-0.5">
              <ToggleButton
                isActive={detailViewMode === "table"}
                onClick={() => setDetailViewMode("table")}
              >
                <TableProperties className="h-3 w-3 mr-1" />
                Preview
              </ToggleButton>
              <ToggleButton
                isActive={detailViewMode === "json"}
                onClick={() => setDetailViewMode("json")}
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
        <ScrollArea className="flex-1 overflow-auto">
          {detailViewMode === "table" ? (
            <PreviewTable data={getSelectionDetails || selectedRow || {}} />
          ) : (
            <div className="p-2">
              <DetailsPanelJSON
                selectedRowIds={selectedRowIds}
                getSelectionDetails={getSelectionDetails}
                selectedRow={selectedRow}
                rows={rows}
              />
            </div>
          )}
        </ScrollArea>
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
    getSelectionDetails: any;
    selectedRow: any;
    rows: any[];
  }) => {
    // Use deferred value for JSON content to prevent blocking renders
    const deferredSelectedRowIds = useDeferredValue(selectedRowIds);

    // Memoize the expensive JSON calculation with deferred values
    const jsonContent = useMemo(() => {
      const selectedIds = Array.from(deferredSelectedRowIds);

      if (selectedIds.length > 1) {
        const selectedRows = selectedIds
          .map((id) => rows.find((r) => r.id === id)?.original)
          .filter(Boolean)
          .map((row) => {
            const cleanRow = { ...row };
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
      <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto whitespace-pre-wrap break-words">
        {jsonContent}
      </pre>
    );
  },
);

DetailsPanelJSON.displayName = "DetailsPanelJSON";
