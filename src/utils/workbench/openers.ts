import { type TableMeta, type FunctionMeta } from '@/services/databaseService';
import useWorkbenchStore from '@/stores/workbenchStore';
import { usePanelFocusStore } from '@/stores/panelFocusStore';
import { nanoid } from 'nanoid';
import { DbType } from '@/types/connection';
import { buildMongoCollectionMetadataQuery } from '@/screens/workspace/components/sidebarContextMenuHelpers';

type TableViewType = 'data' | 'structure' | 'indexes' | 'triggers' | 'definition' | 'partitions';

// Dialect-aware SQL templates for CREATE DATABASE
export function getCreateDatabaseTemplate(dbType: DbType | null, dbName: string): string {
  switch (dbType) {
    case DbType.PostgreSQL:
      return `CREATE DATABASE "${dbName}"
  WITH
  OWNER = current_user
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE = template0;`;

    case DbType.MySQL:
    case DbType.MariaDB:
      return `CREATE DATABASE \`${dbName}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;`;

    case DbType.SQLServer:
      return `CREATE DATABASE [${dbName}];`;

    default:
      return `CREATE DATABASE ${dbName};`;
  }
}

// Dialect-aware SQL templates for CREATE SCHEMA
export function getCreateSchemaTemplate(dbType: DbType | null, schemaName: string): string {
  switch (dbType) {
    case DbType.PostgreSQL:
      return `CREATE SCHEMA "${schemaName}"
  AUTHORIZATION current_user;

-- Optional: Grant permissions
-- GRANT USAGE ON SCHEMA "${schemaName}" TO some_role;
-- GRANT ALL ON ALL TABLES IN SCHEMA "${schemaName}" TO some_role;`;

    case DbType.MySQL:
    case DbType.MariaDB:
      return `CREATE SCHEMA \`${schemaName}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;`;

    case DbType.SQLServer:
      return `CREATE SCHEMA [${schemaName}];`;

    default:
      return `CREATE SCHEMA ${schemaName};`;
  }
}

// SQL templates for creating database objects (PostgreSQL-specific for now)
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

interface OpenQueryWithSqlParams {
  connectionId: string;
  database: string | null;
  schema: string | null;
  sql: string;
  title: string;
}

/**
 * Open a new query tab with custom SQL content
 */
export function openQueryWithSql({
  connectionId,
  database,
  schema,
  sql,
  title,
}: OpenQueryWithSqlParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const tabId = `query-custom-${Date.now()}`;

  addTab(targetPanelId, tabId, {
    type: 'query',
    title,
    connectionId,
    database: database ?? undefined,
    schema: schema ?? undefined,
    sql,
  });
  focusPanel(targetPanelId);
}

interface OpenTableDesignerParams {
  connectionId: string;
  database: string | null;
  schema: string | null;
}

interface OpenCollectionDesignerParams {
  connectionId: string;
  database: string | null;
}

interface OpenMongoCollectionParams {
  connectionId: string;
  database: string;
  collectionName: string;
}

interface OpenRedisDatabaseParams {
  connectionId: string;
  dbIndex: number;
}

export function openQueryWithTemplate({
  connectionId,
  database,
  schema,
  objectType,
}: OpenQueryWithTemplateParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  // 'table' type uses table designer, so it won't have a SQL template
  const templateFn = objectType in SQL_TEMPLATES
    ? SQL_TEMPLATES[objectType as keyof typeof SQL_TEMPLATES]
    : null;
  const template = templateFn ? templateFn(schema ?? 'public') : '';
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
  focusPanel(targetPanelId);
}

export function openTableDesigner({
  connectionId,
  database,
  schema,
}: OpenTableDesignerParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
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
  focusPanel(targetPanelId);
}

export function openCollectionDesigner({
  connectionId,
  database,
}: OpenCollectionDesignerParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const tabId = `collection-design-${Date.now()}`;

  addTab(targetPanelId, tabId, {
    type: "collection-design",
    title: "New Collection",
    connectionId,
    database: database ?? undefined,
  });
  focusPanel(targetPanelId);
}

export function openMongoCollectionObject({
  connectionId,
  database,
  collectionName,
}: OpenMongoCollectionParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const objectKey = `mongo-${connectionId}-${database}-${collectionName}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;

  addTab(targetPanelId, tabId, {
    type: "mongo-collection",
    title: collectionName,
    connectionId,
    database,
    table: collectionName,
    objectKey,
  });
  focusPanel(targetPanelId);
}

export function openMongoCollectionMetadata({
  connectionId,
  database,
  collectionName,
}: OpenMongoCollectionParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const objectKey = `mongo-meta-${connectionId}-${database}-${collectionName}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;

  addTab(targetPanelId, tabId, {
    type: "mongo-query",
    title: `${collectionName} metadata`,
    connectionId,
    database,
    objectKey,
    initialQuery: buildMongoCollectionMetadataQuery(collectionName),
  });
  focusPanel(targetPanelId);
}

export function openRedisDatabaseObject({
  connectionId,
  dbIndex,
}: OpenRedisDatabaseParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const objectKey = `redis-${connectionId}-db${dbIndex}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;

  addTab(targetPanelId, tabId, {
    type: "redis-key",
    title: `db${dbIndex}`,
    connectionId,
    database: String(dbIndex),
    objectKey,
  });
  focusPanel(targetPanelId);
}

export function openRedisCliTab({
  connectionId,
  dbIndex,
}: OpenRedisDatabaseParams): void {
  const { addTab, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }

  if (!targetPanelId) return;

  const objectKey = `redis-cli-${connectionId}-db${dbIndex}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;

  addTab(targetPanelId, tabId, {
    type: "redis-cli",
    title: `Redis CLI - db${dbIndex}`,
    connectionId,
    database: String(dbIndex),
    objectKey,
  });
  focusPanel(targetPanelId);
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

interface OpenInSplitParams {
  table: TableMeta;
  connectionId: string;
  database: string;
  viewType?: TableViewType;
}

interface OpenFunctionInSplitParams {
  func: FunctionMeta;
  connectionId: string;
  database: string;
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
    addTab,
    panelContents,
    focusPanel,
    setActiveTab,
    updateTabMetadata,
  } = useWorkbenchStore.getState();
  const { focusedPanelId } = usePanelFocusStore.getState();

  const objectKey = `table-${connectionId}-${table.schema}-${table.name}`;

  const tableMetadata = {
    type: 'table' as const,
    title: table.name,
    connectionId,
    database,
    schema: table.schema,
    table: table.name,
    isView: table.kind !== 'Table',
    kind: table.kind,
    viewType,
    objectKey,
  };

  // If sourcePanelId is provided and has a filter, try to reuse existing tab in that panel
  if (sourcePanelId && initialFilter) {
    const panelContent = panelContents.get(sourcePanelId);
    if (panelContent) {
      // Find existing tab for this table in the source panel by objectKey
      const existingTabId = panelContent.tabIds.find(tabId => {
        const meta = panelContent.metadata?.[tabId];
        return meta?.objectKey === objectKey;
      });

      if (existingTabId) {
        // Reuse existing tab - update filter
        setActiveTab(sourcePanelId, existingTabId);
        updateTabMetadata(sourcePanelId, existingTabId, {
          ...tableMetadata,
          initialFilter,
        });
        focusPanel(sourcePanelId);
        return;
      }
    }
  }

  // Per-panel dedup: search only the target panel for matching objectKey
  if (!initialFilter) {
    let targetPanelId = focusedPanelId;
    if (!targetPanelId && panelContents.size > 0) {
      const firstPanelId = Array.from(panelContents.keys())[0];
      if (firstPanelId) {
        targetPanelId = firstPanelId;
      }
    }

    if (targetPanelId) {
      const panelContent = panelContents.get(targetPanelId);
      if (panelContent) {
        const existingTabId = panelContent.tabIds.find(tabId => {
          const meta = panelContent.metadata?.[tabId];
          return meta?.objectKey === objectKey;
        });

        if (existingTabId) {
          setActiveTab(targetPanelId, existingTabId);
          updateTabMetadata(targetPanelId, existingTabId, tableMetadata);
          focusPanel(targetPanelId);
          return;
        }
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

  if (!targetPanelId) return;

  const tabId = `${objectKey}:::${nanoid(6)}`;

  addTab(targetPanelId, tabId, {
    ...tableMetadata,
    initialFilter,
  });
  focusPanel(targetPanelId);
}

export function openFunctionObject({
  func,
  connectionId,
  database,
}: OpenFunctionParams): void {
  const { addTab, panelContents, focusPanel, setActiveTab, updateTabMetadata } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId) {
    const firstPanel = Array.from(panelContents.entries())[0];
    if (firstPanel) {
      targetPanelId = firstPanel[0];
      focusPanel(targetPanelId);
    }
  }

  if (!targetPanelId) return;

  const objectType =
    func.routine_type === 'PROCEDURE' ||
    (!func.routine_type && func.return_type === 'void')
      ? 'procedure'
      : 'function';
  const objectKey = `function-${connectionId}-${func.schema}-${func.name}`;

  const funcMetadata = {
    type: 'function' as const,
    title: func.name,
    connectionId,
    database,
    schema: func.schema,
    functionName: func.name,
    returnType: func.return_type,
    objectType,
    objectKey,
  };

  // Per-panel dedup: search only the target panel for matching objectKey
  const panelContent = panelContents.get(targetPanelId);
  if (panelContent) {
    const existingTabId = panelContent.tabIds.find(tabId => {
      const meta = panelContent.metadata?.[tabId];
      return meta?.objectKey === objectKey;
    });

    if (existingTabId) {
      setActiveTab(targetPanelId, existingTabId);
      updateTabMetadata(targetPanelId, existingTabId, funcMetadata);
      focusPanel(targetPanelId);
      return;
    }
  }

  const tabId = `${objectKey}:::${nanoid(6)}`;
  addTab(targetPanelId, tabId, funcMetadata);
  focusPanel(targetPanelId);
}

/**
 * Open a table in a new split panel to the right
 */
export function openTableInSplitRight({
  table,
  connectionId,
  database,
  viewType = 'data',
}: OpenInSplitParams): void {
  const { splitPanelAction, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    targetPanelId = Array.from(panelContents.keys())[0] ?? null;
  }

  if (!targetPanelId) return;

  const objectKey = `table-${connectionId}-${table.schema}-${table.name}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;
  const newPanelId = nanoid(8);

  splitPanelAction({
    targetPanelId,
    direction: 'right',
    newPanelContent: {
      id: newPanelId,
      type: 'editor',
      tabIds: [tabId],
      activeTabId: tabId,
      metadata: {
        [tabId]: {
          type: 'table',
          title: table.name,
          connectionId,
          database,
          schema: table.schema,
          table: table.name,
          isView: table.kind !== 'Table',
          kind: table.kind,
          viewType,
          objectKey,
        },
      },
    },
  });

  // Focus the new panel
  focusPanel(newPanelId);
}

/**
 * Open a function in a new split panel to the right
 */
export function openFunctionInSplitRight({
  func,
  connectionId,
  database,
}: OpenFunctionInSplitParams): void {
  const { splitPanelAction, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    targetPanelId = Array.from(panelContents.keys())[0] ?? null;
  }

  if (!targetPanelId) return;

  const objectKey = `function-${connectionId}-${func.schema}-${func.name}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;
  const newPanelId = nanoid(8);

  const objectType =
    func.routine_type === 'PROCEDURE' ||
    (!func.routine_type && func.return_type === 'void')
      ? 'procedure'
      : 'function';
  splitPanelAction({
    targetPanelId,
    direction: 'right',
    newPanelContent: {
      id: newPanelId,
      type: 'editor',
      tabIds: [tabId],
      activeTabId: tabId,
      metadata: {
        [tabId]: {
          type: 'function',
          title: func.name,
          connectionId,
          database,
          schema: func.schema,
          functionName: func.name,
          returnType: func.return_type,
          objectType,
          objectKey,
        },
      },
    },
  });

  // Focus the new panel
  focusPanel(newPanelId);
}

// ---------------------------------------------------------------------------
// ERD openers
// ---------------------------------------------------------------------------

interface OpenErdParams {
  connectionId: string;
  connectionName: string;
  database?: string;
  schema?: string;
}

/**
 * Open an ERD tab for the given connection. Reuses an existing tab if one
 * is already open in the focused panel (per-panel dedup). Otherwise creates
 * a new tab in the focused panel.
 */
export function openErdView({
  connectionId,
  connectionName,
  database,
  schema,
}: OpenErdParams): void {
  const {
    addTab,
    panelContents,
    focusPanel,
    setActiveTab,
    updateTabMetadata,
  } = useWorkbenchStore.getState();

  const objectKey = `erd-${connectionId}`;

  const erdMetadata = {
    type: 'erd' as const,
    title: `${connectionName} ERD`,
    connectionId,
    database,
    schema,
    objectKey,
  };

  // Per-panel dedup: search only the focused panel for matching objectKey
  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    const firstPanelId = Array.from(panelContents.keys())[0];
    if (firstPanelId) {
      targetPanelId = firstPanelId;
      focusPanel(firstPanelId);
    }
  }
  if (!targetPanelId) return;

  const panelContent = panelContents.get(targetPanelId);
  if (panelContent) {
    const existingTabId = panelContent.tabIds.find(tabId => {
      const meta = panelContent.metadata?.[tabId];
      return meta?.objectKey === objectKey;
    });

    if (existingTabId) {
      setActiveTab(targetPanelId, existingTabId);
      updateTabMetadata(targetPanelId, existingTabId, erdMetadata);
      focusPanel(targetPanelId);
      return;
    }
  }

  const tabId = `${objectKey}:::${nanoid(6)}`;
  addTab(targetPanelId, tabId, erdMetadata);
  focusPanel(targetPanelId);
}

/**
 * Open an ERD in a new split panel to the right. Always creates a new tab
 * with a unique ID so it does not conflict with existing ERD tabs.
 */
export function openErdInSplitRight({
  connectionId,
  connectionName,
  database,
  schema,
}: OpenErdParams): void {
  const { splitPanelAction, panelContents, focusPanel } =
    useWorkbenchStore.getState();

  let targetPanelId = usePanelFocusStore.getState().focusedPanelId;
  if (!targetPanelId && panelContents.size > 0) {
    targetPanelId = Array.from(panelContents.keys())[0] ?? null;
  }
  if (!targetPanelId) return;

  const objectKey = `erd-${connectionId}`;
  const tabId = `${objectKey}:::${nanoid(6)}`;
  const newPanelId = nanoid(8);

  splitPanelAction({
    targetPanelId,
    direction: 'right',
    newPanelContent: {
      id: newPanelId,
      type: 'editor',
      tabIds: [tabId],
      activeTabId: tabId,
      metadata: {
        [tabId]: {
          type: 'erd',
          title: `${connectionName} ERD`,
          connectionId,
          database,
          schema,
          objectKey,
        },
      },
    },
  });

  focusPanel(newPanelId);
}
