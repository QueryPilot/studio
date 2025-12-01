import { type TableMeta, type FunctionMeta } from '@/services/databaseService';
import useWorkbenchStore from '@/stores/workbenchStore';
import { usePanelStore } from '@/stores/panelStore';

type TableViewType = 'data' | 'structure' | 'indexes';

// SQL templates for creating database objects
const SQL_TEMPLATES = {
  schema: (_schema: string) => `CREATE SCHEMA "new_schema_name"
  AUTHORIZATION current_user;

-- Optional: Grant permissions
-- GRANT USAGE ON SCHEMA "new_schema_name" TO some_role;
-- GRANT ALL ON ALL TABLES IN SCHEMA "new_schema_name" TO some_role;`,

  view: (schema: string) => `CREATE VIEW "${schema}"."view_name" AS
SELECT
  column1,
  column2
FROM "${schema}"."table_name"
WHERE condition;`,

  materializedView: (schema: string) => `CREATE MATERIALIZED VIEW "${schema}"."mv_name" AS
SELECT
  column1,
  column2,
  COUNT(*) as count
FROM "${schema}"."table_name"
GROUP BY column1, column2
WITH DATA;

-- To refresh: REFRESH MATERIALIZED VIEW "${schema}"."mv_name";`,

  function: (schema: string) => `CREATE OR REPLACE FUNCTION "${schema}"."function_name"(
  param1 INTEGER,
  param2 TEXT DEFAULT 'default'
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  result TEXT;
BEGIN
  -- Your logic here
  result := param2 || ' ' || param1::TEXT;
  RETURN result;
END;
$$;`,

  procedure: (schema: string) => `CREATE OR REPLACE PROCEDURE "${schema}"."procedure_name"(
  IN param1 INTEGER,
  INOUT param2 TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Your logic here
  param2 := param2 || ' processed';

  -- Example: Insert into a table
  -- INSERT INTO some_table (col1, col2) VALUES (param1, param2);
END;
$$;`,

  trigger: (schema: string) => `-- First create the trigger function
CREATE OR REPLACE FUNCTION "${schema}"."trigger_function_name"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- For INSERT/UPDATE triggers
  NEW.updated_at := NOW();
  RETURN NEW;

  -- For DELETE triggers, use:
  -- RETURN OLD;
END;
$$;

-- Then create the trigger
CREATE TRIGGER "trigger_name"
  BEFORE INSERT OR UPDATE ON "${schema}"."table_name"
  FOR EACH ROW
  EXECUTE FUNCTION "${schema}"."trigger_function_name"();`,
};

export type CreateObjectType = 'schema' | 'table' | 'view' | 'materializedView' | 'function' | 'procedure' | 'trigger';

interface OpenQueryWithTemplateParams {
  connectionId: string;
  database: string | null;
  schema: string | null;
  objectType: CreateObjectType;
}

interface OpenTableDesignerParams {
  connectionId: string;
  database: string | null;
  schema: string | null;
}

export function openQueryWithTemplate({
  connectionId,
  database,
  schema,
  objectType,
}: OpenQueryWithTemplateParams): void {
  const { focusedPanelId, addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  // Type assertion for SQL_TEMPLATES access since 'table' is handled differently
  const templateFn = SQL_TEMPLATES[objectType as keyof typeof SQL_TEMPLATES];
  const template = templateFn?.(schema ?? 'public') ?? '';
  const tabId = `query-new-${objectType}-${Date.now()}`;
  const titles: Record<CreateObjectType, string> = {
    schema: 'New Schema',
    table: 'New Table',
    view: 'New View',
    materializedView: 'New Materialized View',
    function: 'New Function',
    procedure: 'New Procedure',
    trigger: 'New Trigger',
  };

  addTab(targetPanelId, tabId, {
    type: 'query',
    title: titles[objectType],
    connectionId,
    database: database ?? undefined,
    schema: schema ?? undefined,
    sql: template,
  });
}

export function openTableDesigner({
  connectionId,
  database,
  schema,
}: OpenTableDesignerParams): void {
  const { focusedPanelId, addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const tabId = `design-new-table-${Date.now()}`;

  addTab(targetPanelId, tabId, {
    type: 'design',
    title: 'New Table',
    connectionId,
    database: database ?? undefined,
    schema: schema ?? undefined,
  });
}

interface OpenTableParams {
  table: TableMeta;
  connectionId: string;
  database: string;
  viewType?: TableViewType;
  /** Initial WHERE clause filter to apply (without the WHERE keyword) */
  initialFilter?: string;
  /** Source panel ID - if provided, will try to reuse existing table tab in this panel */
  sourcePanelId?: string;
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
  initialFilter,
  sourcePanelId,
}: OpenTableParams): void {
  const {
    focusedPanelId,
    addTab,
    panelContents,
    focusPanel,
    setActiveTab,
    updateTabMetadata,
  } = useWorkbenchStore.getState();

  const baseTabId = `table-${table.schema}-${table.name}`;

  // If sourcePanelId is provided and has a filter, try to reuse existing tab in that panel
  if (sourcePanelId && initialFilter) {
    const panelContent = panelContents.get(sourcePanelId);
    if (panelContent) {
      // Find existing tab for this table in the source panel
      const existingTabId = panelContent.tabIds.find(tabId =>
        tabId === baseTabId || tabId.startsWith(`${baseTabId}-`)
      );

      if (existingTabId) {
        // Reuse existing tab - update filter
        setActiveTab(sourcePanelId, existingTabId);
        updateTabMetadata(sourcePanelId, existingTabId, {
          type: 'table',
          title: table.name,
          connectionId,
          database,
          schema: table.schema,
          table: table.name,
          isView: table.kind !== 'Table',
          kind: table.kind,
          viewType,
          initialFilter,
        });
        focusPanel(sourcePanelId);
        return;
      }
    }
  }

  // For new tabs with filter, use unique ID; otherwise use base ID
  const tabId = initialFilter
    ? `${baseTabId}-${Date.now()}`
    : baseTabId;

  // Check for existing tab (only when no filter and no sourcePanelId)
  if (!initialFilter) {
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
      initialFilter,
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
