import { memo, useCallback, useEffect, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentDataGrid } from "@/components/DataGrid";
import {
  IconTable,
  IconAssembly,
  IconBookmark,
  IconArrowsShuffle,
  IconShieldCheck,
  IconFilter,
} from "@tabler/icons-react";
import { useTabStateStore } from "@/stores/tabStateStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import type { TabMetadata } from "@/types/workbench";
import type { CrudCommandTarget } from "@/types/crud";
import {
  DEFAULT_MONGO_WORKBENCH_STATE,
  type MongoCollectionViewType,
  type MongoWorkbenchState,
} from "@/types/mongoWorkbench";
import { MongoStructureView } from "@/components/MongoStructure";
import { MongoAggregationView } from "@/components/MongoAggregation";
import { MongoIndexesView } from "@/components/MongoIndexes";
import { MongoValidationView } from "@/components/MongoValidation";
import { MongoExplainView } from "@/components/MongoExplain";

interface MongoCollectionWorkbenchProps {
  panelId: string;
  tabId: string;
  metadata: TabMetadata;
  focused?: boolean;
}

function perTabSortGridId(
  baseGridId: string,
  tabId: string,
  syncSort: boolean | undefined,
): string | undefined {
  return syncSort === false ? `${baseGridId}:::tab:::${tabId}` : undefined;
}

function coerceMongoViewType(value: unknown): MongoCollectionViewType {
  switch (value) {
    case "structure":
    case "indexes":
    case "aggregation":
    case "validation":
    case "explain":
      return value;
    case "data":
    default:
      return "data";
  }
}

export const MongoCollectionWorkbench = memo(function MongoCollectionWorkbench({
  panelId,
  tabId,
  metadata,
  focused,
}: MongoCollectionWorkbenchProps) {
  const connectionId =
    typeof metadata.connectionId === "string" ? metadata.connectionId : "";
  const database = typeof metadata.database === "string" ? metadata.database : "";
  const collection = typeof metadata.table === "string" ? metadata.table : "";
  const sortGridId = perTabSortGridId(
    `document:${connectionId}:${database}:${collection}`,
    tabId,
    metadata.syncSort,
  ) ?? `document:${connectionId}:${database}:${collection}`;

  const updateTabMetadata = useWorkbenchStore((state) => state.updateTabMetadata);
  const loadTabStateAsync = useTabStateStore((state) => state.loadTabStateAsync);
  const setQueryState = useTabStateStore((state) => state.setQueryState);
  const persistedState = useTabStateStore(
    (state) => state.queryStates.get(tabId),
  );

  useEffect(() => {
    void loadTabStateAsync(tabId);
  }, [loadTabStateAsync, tabId]);

  const activeView = useMemo<MongoCollectionViewType>(
    () => coerceMongoViewType(metadata.viewType ?? persistedState?.tableViewType),
    [metadata.viewType, persistedState?.tableViewType],
  );

  const handleActiveViewChange = useCallback(
    (value: string) => {
      const nextView = coerceMongoViewType(value);
      if (metadata.viewType !== nextView) {
        updateTabMetadata(panelId, tabId, { viewType: nextView });
      }
      if (persistedState?.tableViewType !== nextView) {
        setQueryState(tabId, { tableViewType: nextView });
      }
    },
    [
      metadata.viewType,
      panelId,
      persistedState?.tableViewType,
      setQueryState,
      tabId,
      updateTabMetadata,
    ],
  );

  const workbenchState = useMemo<MongoWorkbenchState>(
    () => ({
      ...DEFAULT_MONGO_WORKBENCH_STATE,
      ...(persistedState?.mongoWorkbench ?? {}),
    }),
    [persistedState?.mongoWorkbench],
  );

  const updateWorkbenchState = useCallback(
    (updates: Partial<MongoWorkbenchState>) => {
      setQueryState(tabId, {
        mongoWorkbench: {
          ...workbenchState,
          ...updates,
        },
      });
    },
    [setQueryState, tabId, workbenchState],
  );

  // Stable callbacks for DocumentDataGrid props (#2 fix)
  const handleAppliedFilterChange = useCallback(
    (state: { text: string }) => {
      updateWorkbenchState({ filterText: state.text });
    },
    [updateWorkbenchState],
  );

  const handleViewModeChange = useCallback(
    (mode: "table" | "tree" | "json") => {
      updateWorkbenchState({ dataViewMode: mode });
    },
    [updateWorkbenchState],
  );

  const openExplainView = useCallback(() => {
    updateWorkbenchState({ explainSource: "aggregation" });
    handleActiveViewChange("explain");
  }, [handleActiveViewChange, updateWorkbenchState]);

  const target = useMemo<CrudCommandTarget>(
    () => ({
      connectionId,
      database,
      table: collection,
    }),
    [collection, connectionId, database],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none pb-1 pt-1.5 bg-background">
        <div className="flex items-center justify-between px-1">
          <Tabs
            value={activeView}
            onValueChange={handleActiveViewChange}
            enableShortcuts={true}
            tabGroupId={`mongo-views-${tabId}`}
            focused={focused}
          >
            <TabsList>
              <TabsTrigger value="data" tabIndex={0}>
                <IconTable />
                <span>Data</span>
              </TabsTrigger>
              <TabsTrigger value="structure" tabIndex={1}>
                <IconAssembly />
                <span>Structure</span>
              </TabsTrigger>
              <TabsTrigger value="indexes" tabIndex={2}>
                <IconBookmark />
                <span>Indexes</span>
              </TabsTrigger>
              <TabsTrigger value="aggregation" tabIndex={3}>
                <IconArrowsShuffle />
                <span>Aggregation</span>
              </TabsTrigger>
              <TabsTrigger value="validation" tabIndex={4}>
                <IconShieldCheck />
                <span>Validation</span>
              </TabsTrigger>
              <TabsTrigger value="explain" tabIndex={5}>
                <IconFilter />
                <span>Explain</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeView === "data" ? (
          <DocumentDataGrid
            key={`${tabId}:${workbenchState.filterText ?? ""}`}
            gridId={`document:${connectionId}:${database}:${collection}`}
            connectionId={connectionId}
            database={database}
            collection={collection}
            className="h-full"
            focused={focused}
            sortGridId={perTabSortGridId(
              `document:${connectionId}:${database}:${collection}`,
              tabId,
              metadata.syncSort,
            )}
            initialFilterText={workbenchState.filterText}
            onAppliedFilterChange={handleAppliedFilterChange}
            viewMode={workbenchState.dataViewMode}
            onViewModeChange={handleViewModeChange}
          />
        ) : null}

        {activeView === "structure" ? (
          <MongoStructureView
            connectionId={connectionId}
            database={database}
            collection={collection}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
          />
        ) : null}

        {activeView === "indexes" ? (
          <MongoIndexesView target={target} />
        ) : null}

        {activeView === "aggregation" ? (
          <MongoAggregationView
            connectionId={connectionId}
            database={database}
            collection={collection}
            tabId={tabId}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
            onOpenExplain={openExplainView}
          />
        ) : null}

        {activeView === "validation" ? (
          <MongoValidationView
            target={target}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
          />
        ) : null}

        {activeView === "explain" ? (
          <MongoExplainView
            connectionId={connectionId}
            database={database}
            collection={collection}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
            sortGridId={sortGridId}
          />
        ) : null}
      </div>
    </div>
  );
});

