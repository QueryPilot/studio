import { type TableMeta, type FunctionMeta } from '@/services/databaseService';
import useWorkbenchStore from '@/stores/workbenchStore';
import { usePanelStore } from '@/stores/panelStore';

type TableViewType = 'data' | 'structure' | 'indexes';

interface OpenTableParams {
  table: TableMeta;
  connectionId: string;
  database: string;
  viewType?: TableViewType;
}

interface OpenFunctionParams {
  func: FunctionMeta;
  connectionId: string;
  database: string;
}

export function openTableObject({
  table,
  connectionId,
  database,
  viewType = 'data',
}: OpenTableParams): void {
  const {
    focusedPanelId,
    addTab,
    panelContents,
    focusPanel,
    setActiveTab,
    updateTabMetadata,
  } = useWorkbenchStore.getState();

  const tabId = `table-${table.schema}-${table.name}`;

  for (const [panelId, content] of panelContents.entries()) {
    if (content.tabIds.includes(tabId)) {
      setActiveTab(panelId, tabId);
      updateTabMetadata(panelId, tabId, {
        type: 'table',
        title: table.name,
        connectionId,
        database,
        schema: table.schema,
        table: table.name,
        isView: table.kind !== 'Table',
        kind: table.kind,
        viewType,
      });
      focusPanel(panelId);
      return;
    }
  }

  let targetPanelId = focusedPanelId;

  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (targetPanelId) {
    addTab(targetPanelId, tabId, {
      type: 'table',
      title: table.name,
      connectionId,
      database,
      schema: table.schema,
      table: table.name,
      isView: table.kind !== 'Table',
      kind: table.kind,
      viewType,
    });
    return;
  }

  const {
    getPrimaryPanel,
    addTabToPanel,
    setActiveTabInPanel,
    updateTabInPanel,
  } = usePanelStore.getState();

  const primaryPanel = getPrimaryPanel();
  if (!primaryPanel) {
    return;
  }

  const existingTab = Array.from(primaryPanel.tabs.values()).find(
    (tab) =>
      tab.type === 'table' &&
      tab.payload.tableName === table.name &&
      tab.payload.schema === table.schema
  );

  if (existingTab) {
    setActiveTabInPanel(primaryPanel.id, existingTab.id);
    updateTabInPanel(primaryPanel.id, existingTab.id, {
      payload: {
        ...existingTab.payload,
        database,
        activeView: viewType,
        kind: table.kind,
      },
    });
  } else {
    addTabToPanel(primaryPanel.id, {
      type: 'table',
      connectionId,
      title: table.name,
      payload: {
        database,
        schema: table.schema,
        tableName: table.name,
        isView: table.kind !== 'Table',
        kind: table.kind,
        activeView: viewType,
      },
    });
  }
}

export function openFunctionObject({
  func,
  connectionId,
  database,
}: OpenFunctionParams): void {
  const { focusedPanelId, addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = focusedPanelId;
  if (!targetPanelId) {
    const firstPanel = Array.from(panelContents.entries())[0];
    if (firstPanel) {
      targetPanelId = firstPanel[0];
      focusPanel(targetPanelId);
    }
  }

  if (targetPanelId) {
    const tabId = `function-${func.schema}-${func.name}`;
    addTab(targetPanelId, tabId, {
      type: 'function',
      title: func.name,
      connectionId,
      database,
      schema: func.schema,
      functionName: func.name,
    });
    return;
  }

  const {
    getPrimaryPanel,
    addTabToPanel,
    setActiveTabInPanel,
  } = usePanelStore.getState();

  const primaryPanel = getPrimaryPanel();
  if (!primaryPanel) {
    return;
  }

  const existingTab = Array.from(primaryPanel.tabs.values()).find(
    (tab) =>
      tab.type === 'function' &&
      tab.payload.functionName === func.name &&
      tab.payload.schema === func.schema
  );

  if (existingTab) {
    setActiveTabInPanel(primaryPanel.id, existingTab.id);
    return;
  }

  addTabToPanel(primaryPanel.id, {
    type: 'function',
    connectionId,
    title: func.name,
    payload: {
      database,
      schema: func.schema,
      functionName: func.name,
    },
  });
}
