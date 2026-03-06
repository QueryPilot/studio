import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import { editorRegistry } from "@/services/editorRegistry";
import type { TabMetadata } from "@/types/workbench";

export interface FocusedTabContextSnapshot {
  panelId: string;
  tabId: string;
  tabType: string;
  title?: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  editor: {
    selection: string | null;
    fullText: string | null;
    isSelection: boolean;
  };
  grid: {
    filter?: string;
    sort?: { column: string; direction: "asc" | "desc" };
    view?: string;
  };
  resultSummary: {
    hasResults: boolean;
    rowCount?: number;
    columnCount?: number;
    executionTime?: number;
    error?: string;
  };
}

function computeGridId(tabId: string, metadata: TabMetadata): string | null {
  const connectionId =
    typeof metadata.connectionId === "string" ? metadata.connectionId : null;
  if (!connectionId) return null;

  const type = typeof metadata.type === "string" ? metadata.type : "";

  if (type === "table") {
    const database = typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    const table = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !table) return null;
    return `${connectionId}:${database}:${schema}:${table}`;
  }

  if (type === "mongo-collection") {
    const database = typeof metadata.database === "string" ? metadata.database : "";
    const collection = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !collection) return null;
    return `document:${connectionId}:${database}:${collection}`;
  }

  if (type === "redis-key") {
    const database = typeof metadata.database === "string" ? metadata.database : "0";
    const keyName =
      typeof metadata.table === "string" && metadata.table.length > 0
        ? metadata.table
        : "browser";
    return `keyvalue:${connectionId}:${database}:${keyName}`;
  }

  if (type === "query") {
    const database = typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    return `query:${connectionId}:${database}:${schema}:${tabId}`;
  }

  return null;
}

export function getFocusedTabContextSnapshot(): FocusedTabContextSnapshot | null {
  const panelContents = useWorkbenchStore.getState().panelContents;
  const focusedPanelId =
    usePanelFocusStore.getState().focusedPanelId ?? panelContents.keys().next().value;

  if (!focusedPanelId || typeof focusedPanelId !== "string") {
    return null;
  }

  const panel = panelContents.get(focusedPanelId);
  if (!panel) return null;

  const tabId = panel.activeTabId || panel.tabIds[0];
  if (!tabId) return null;

  const metadata = panel.metadata?.[tabId] ?? {};
  const queryState = useTabStateStore.getState().getQueryState(tabId);

  const activeContent = editorRegistry.getActiveContent();
  const editorSelection = activeContent?.isSelection ? activeContent.sql : null;
  const editorFullText = activeContent?.isSelection
    ? queryState?.query ?? (typeof metadata.sql === "string" ? metadata.sql : null)
    : (activeContent?.sql ?? queryState?.query ?? (typeof metadata.sql === "string" ? metadata.sql : null));

  const gridId = computeGridId(tabId, metadata);
  const prefs = gridId
    ? useGridPreferencesStore.getState().preferences[gridId]
    : undefined;
  const firstSort = prefs?.sortColumns[0];

  const result = queryState?.result;

  return {
    panelId: focusedPanelId,
    tabId,
    tabType: typeof metadata.type === "string" ? metadata.type : "unknown",
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    connectionId:
      typeof metadata.connectionId === "string" ? metadata.connectionId : undefined,
    database: typeof metadata.database === "string" ? metadata.database : undefined,
    schema: typeof metadata.schema === "string" ? metadata.schema : undefined,
    editor: {
      selection: editorSelection,
      fullText: editorFullText,
      isSelection: Boolean(activeContent?.isSelection),
    },
    grid: {
      filter: prefs?.quickFilter?.value,
      sort: firstSort
        ? { column: firstSort.columnId, direction: firstSort.direction }
        : undefined,
      view:
        queryState?.tableViewType ??
        (typeof metadata.viewType === "string" ? metadata.viewType : undefined),
    },
    resultSummary: {
      hasResults: Boolean(result),
      rowCount: result?.rowCount,
      columnCount: result ? result.columns.length : undefined,
      executionTime: result?.executionTime,
      error: result?.error,
    },
  };
}
