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
  pendingEditFields,
  onUndoCellEdit,
  className,
  defaultTab = "tree",
  onTabChange,
  activeTab,
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

  // Convert field keys → display labels for the tree view
  const pendingEditLabels = useMemo((): Set<string> => {
    if (!pendingEditFields || pendingEditFields.size === 0) return new Set();
    const labels = new Set<string>();
    for (const [label, field] of labelToFieldMap) {
      if (pendingEditFields.has(field)) {
        labels.add(label);
      }
    }
    return labels;
  }, [pendingEditFields, labelToFieldMap]);

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

  const handleTreeCellUndo = useCallback(
    (label: string) => {
      if (!onUndoCellEdit) return;
      const field = labelToFieldMap.get(label);
      if (field) {
        onUndoCellEdit(field);
      }
    },
    [onUndoCellEdit, labelToFieldMap],
  );

  const handleTabChange = useCallback(
    (value: string) => {
      onTabChange?.(value as InspectorTab);
    },
    [onTabChange],
  );

  const isEmpty = selectedRows.length === 0;
  const recordCount = selectedRows.length;
  const recordLabel = recordCount === 1 ? "1 record" : `${recordCount} records`;

  return (
    <div
      className={cn(
        "h-full w-full border-l bg-background flex flex-col",
        className,
      )}
    >
      {/* Tabs + record count — always rendered so subcomponent state is preserved */}
      <Tabs
        value={activeTab ?? defaultTab}
        className="flex-1 flex flex-col min-h-0"
        onValueChange={handleTabChange}
      >
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <TabsList className="h-7">
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
          {!isEmpty && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{recordLabel}</Badge>
          )}
        </div>

        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center p-4 text-xs text-muted-foreground">
            Select a row or cell to inspect structured data.
          </div>
        ) : (
          <>
            <TabsContent value="tree" className="flex-1 min-h-0 mt-2 px-3 pb-3" keepMounted>
              <InspectorTreeView
                documents={documents}
                onCellEdit={onCellEdit ? handleTreeCellEdit : undefined}
                pendingEditLabels={pendingEditLabels}
                onUndoCellEdit={onUndoCellEdit ? handleTreeCellUndo : undefined}
              />
            </TabsContent>

            <TabsContent value="raw" className="flex-1 min-h-0 mt-2 px-3 pb-3" keepMounted>
              <InspectorRawView documents={documents} />
            </TabsContent>

            <TabsContent value="diff" className="flex-1 min-h-0 mt-2 px-3 pb-3" keepMounted>
              <InspectorDiffView documents={documents} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
});
