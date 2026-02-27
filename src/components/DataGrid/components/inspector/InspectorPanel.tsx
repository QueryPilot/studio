import { memo, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InspectorTreeView } from "./InspectorTreeView";
import { InspectorDiffView } from "./InspectorDiffView";
import { InspectorRawView } from "./InspectorRawView";
import { rowsToDocuments, buildLabelToFieldMap } from "./utils";
import type { InspectorPanelProps, InspectorTab } from "./types";

export const InspectorPanel = memo(function InspectorPanel({
  selectedRows,
  columns,
  onCellEdit,
  className,
  defaultTab = "tree",
  onTabChange,
}: InspectorPanelProps) {
  const documents = useMemo(
    () => rowsToDocuments(selectedRows, columns),
    [selectedRows, columns],
  );

  // Translate display labels (used by tree view) back to column field keys
  const labelToFieldMap = useMemo(
    () => buildLabelToFieldMap(columns),
    [columns],
  );

  const handleTreeCellEdit = useCallback(
    (label: string, value: unknown) => {
      if (!onCellEdit) return;
      const field = labelToFieldMap.get(label);
      if (field) {
        onCellEdit(field, value);
      }
    },
    [onCellEdit, labelToFieldMap],
  );

  if (selectedRows.length === 0) {
    return (
      <div
        className={cn(
          "h-full w-full border-l bg-background p-4 text-xs text-muted-foreground",
          className,
        )}
      >
        Select a row or cell to inspect structured data.
      </div>
    );
  }

  const recordCount = selectedRows.length;
  const recordLabel = recordCount === 1 ? "1 record" : `${recordCount} records`;

  return (
    <div
      className={cn(
        "h-full w-full border-l bg-background flex flex-col",
        className,
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <span className="text-xs font-medium">Inspector</span>
        <Badge variant="secondary">{recordLabel}</Badge>
      </div>

      {/* Tabs */}
      <Tabs
        defaultValue={defaultTab}
        className="flex-1 flex flex-col min-h-0"
        onValueChange={(value) => {
          onTabChange?.(value as InspectorTab);
        }}
      >
        <div className="px-3 pt-2">
          <TabsList className="h-8">
            <TabsTrigger value="tree" className="text-[11px]">
              Tree
            </TabsTrigger>
            <TabsTrigger value="raw" className="text-[11px]">
              Raw
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-[11px]">
              Diff
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tree" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          <InspectorTreeView documents={documents} onCellEdit={onCellEdit ? handleTreeCellEdit : undefined} />
        </TabsContent>

        <TabsContent value="raw" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          <InspectorRawView documents={documents} />
        </TabsContent>

        <TabsContent value="diff" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          <InspectorDiffView documents={documents} />
        </TabsContent>
      </Tabs>
    </div>
  );
});
