/**
 * AI Command Executor
 *
 * Executes AI mutation and UI capability actions.
 * Canonical mutation targets: workbenchStore + tabStateStore (+ grid preferences).
 * DB writes/deletes are stage-only via crudStore.
 */

import { nanoid } from "nanoid";
import { invoke } from "@tauri-apps/api/core";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import { editorRegistry } from "@/services/editorRegistry";
import { BackendAPI } from "@/services/backend";
import { databaseService } from "@/services/databaseService";
import { isReadOnlyStatement } from "@/utils/selfCorrection";
import { getParadigm } from "@/types/connection";
import type { DbType } from "@/types/connection";
import type {
  DocumentOperation,
  DocumentResult,
  KeyValueOperation,
  KeyValueResult,
} from "@/adapters/types/ipc";
import type {
  ParsedCommand,
  CrudStageParams,
  CrudStageResult,
  CrudUnstageParams,
  CrudUnstageResult,
  TabUpdateContentParams,
  TabUpdateResult,
  TabCreateParams,
  TabCreateResult,
  TabFocusParams,
  TabFocusResult,
  EditorInsertParams,
  EditorInsertResult,
  QueryRunParams,
  QueryRunResult,
  GridSetFilterParams,
  GridSetSortParams,
  GridSetViewParams,
  WorkspaceGetTabContextParams,
  WorkspaceTabSummary,
  WorkspaceTabContextResult,
} from "@/types/aiCommands";
import type { TabMetadata } from "@/types/workbench";

export type CommandResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

export interface BatchedCommandResult {
  commandId: string;
  commandName: string;
  result: CommandResult;
  executionTimeMs: number;
}

export interface BatchExecutionResult {
  results: BatchedCommandResult[];
  totalTimeMs: number;
  successCount: number;
  failureCount: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_QUERY_RESULT_ROWS = 200;

const READ_ONLY_MONGO_OPERATIONS = new Set([
  "find",
  "findpage",
  "aggregate",
  "count",
  "sampleschema",
  "listcollections",
]);

const READ_ONLY_REDIS_RAW_COMMANDS = new Set([
  "PING",
  "ECHO",
  "INFO",
  "DBSIZE",
  "TIME",
  "COMMAND",
  "GET",
  "MGET",
  "KEYS",
  "SCAN",
  "RANDOMKEY",
  "OBJECT",
  "TYPE",
  "TTL",
  "PTTL",
  "EXISTS",
  "STRLEN",
  "DUMP",
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "HSCAN",
  "LRANGE",
  "LLEN",
  "LINDEX",
  "LPOS",
  "SMEMBERS",
  "SCARD",
  "SISMEMBER",
  "SMISMEMBER",
  "SRANDMEMBER",
  "SSCAN",
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZRANGEBYLEX",
  "ZREVRANGE",
  "ZREVRANGEBYSCORE",
  "ZCARD",
  "ZSCORE",
  "ZMSCORE",
  "ZRANK",
  "ZREVRANK",
  "ZCOUNT",
  "ZLEXCOUNT",
  "ZSCAN",
  "XLEN",
  "XRANGE",
  "XREVRANGE",
  "XINFO",
  "XPENDING",
  "MEMORY",
  "CLUSTER",
  "LATENCY",
  "GEORADIUS_RO",
  "GEORADIUSBYMEMBER_RO",
  "GEOSEARCH",
  "GEOPOS",
  "GEODIST",
  "PFCOUNT",
  "BITCOUNT",
  "BITPOS",
  "GETBIT",
  "GETRANGE",
  "PUBSUB",
]);

class QueryRunTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "QueryRunTimeoutError";
  }
}

function resolveQueryRunTimeoutMs(timeoutSecs?: number): number {
  if (typeof timeoutSecs === "number" && Number.isFinite(timeoutSecs) && timeoutSecs > 0) {
    return Math.min(Math.round(timeoutSecs * 1000), 300_000);
  }
  return DEFAULT_TIMEOUT_MS;
}

async function withQueryRunTimeout<T>(
  operation: string,
  timeoutMs: number,
  work: Promise<T>,
): Promise<T> {
  let clearTimer = () => undefined;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new QueryRunTimeoutError(operation, timeoutMs));
      }, timeoutMs);
      clearTimer = () => {
        clearTimeout(timer);
      };
    });

    return await Promise.race([
      work,
      timeoutPromise,
    ]);
  } finally {
    clearTimer();
  }
}

type LocatedTab = {
  panelId: string;
  tabId: string;
  metadata: TabMetadata;
};

function getFirstPanelId(): string | null {
  const panelContents = useWorkbenchStore.getState().panelContents;
  const first = panelContents.keys().next().value;
  return typeof first === "string" ? first : null;
}

function ensureWorkbenchInitialized(): void {
  const workbench = useWorkbenchStore.getState();
  if (workbench.panelContents.size === 0) {
    workbench.initializeLayout();
  }
}

function getFocusedPanelId(): string | null {
  const focused = usePanelFocusStore.getState().focusedPanelId;
  return focused ?? getFirstPanelId();
}

function locateTab(targetTabId?: string): LocatedTab | null {
  const workbench = useWorkbenchStore.getState();
  const panelContents = workbench.panelContents;

  if (targetTabId) {
    for (const [panelId, panel] of panelContents) {
      if (!panel.tabIds.includes(targetTabId)) continue;
      const metadata = panel.metadata?.[targetTabId] ?? {};
      return { panelId, tabId: targetTabId, metadata };
    }
    return null;
  }

  const focusedPanelId = getFocusedPanelId();
  if (!focusedPanelId) return null;

  const focusedPanel = panelContents.get(focusedPanelId);
  if (!focusedPanel) return null;

  const tabId = focusedPanel.activeTabId || focusedPanel.tabIds[0];
  if (!tabId) return null;

  const metadata = focusedPanel.metadata?.[tabId] ?? {};
  return { panelId: focusedPanelId, tabId, metadata };
}

function splitEditorId(editorId: string): { panelId: string; tabId: string } | null {
  const idx = editorId.indexOf(":");
  if (idx <= 0 || idx === editorId.length - 1) return null;
  return {
    panelId: editorId.slice(0, idx),
    tabId: editorId.slice(idx + 1),
  };
}

function connectionExists(connectionId: string): boolean {
  const store = useConnectionStore.getState();
  if (typeof store.getConnection === "function") {
    return Boolean(store.getConnection(connectionId));
  }
  return store.connections.some((conn) => conn.profile.id === connectionId);
}

function getConnectionDbType(connectionId: string): DbType | null {
  const store = useConnectionStore.getState();
  const byGetter =
    typeof store.getConnection === "function"
      ? store.getConnection(connectionId)
      : undefined;
  const profile =
    byGetter?.profile ??
    store.connections.find((conn) => conn.profile.id === connectionId)?.profile;

  if (!profile?.db_type) {
    return null;
  }

  return profile.db_type;
}

function resolveQueryMode(
  dbType: DbType | null,
  language?: QueryRunParams["language"],
): "sql" | "document" | "keyvalue" | null {
  if (language === "sql") return "sql";
  if (language === "mongo") return "document";
  if (language === "redis") return "keyvalue";

  if (!dbType) return null;
  return getParadigm(dbType);
}

function computeGridId(tabId: string, metadata: TabMetadata): string | null {
  const connectionId =
    typeof metadata.connectionId === "string" ? metadata.connectionId : null;
  const type = typeof metadata.type === "string" ? metadata.type : "";

  if (!connectionId) return null;

  if (type === "table") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    const table = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !table) return null;
    return `${connectionId}:${database}:${schema}:${table}`;
  }

  if (type === "mongo-collection") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const collection = typeof metadata.table === "string" ? metadata.table : "";
    if (!database || !collection) return null;
    return `document:${connectionId}:${database}:${collection}`;
  }

  if (type === "redis-key") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "0";
    const keyName =
      typeof metadata.table === "string" && metadata.table.length > 0
        ? metadata.table
        : "browser";
    return `keyvalue:${connectionId}:${database}:${keyName}`;
  }

  if (type === "query") {
    const database =
      typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";
    return `query:${connectionId}:${database}:${schema}:${tabId}`;
  }

  return null;
}

function buildTabSummary(panelId: string, tabId: string, metadata: TabMetadata): WorkspaceTabSummary {
  return {
    tabId,
    panelId,
    type: typeof metadata.type === "string" ? metadata.type : "unknown",
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    connectionId:
      typeof metadata.connectionId === "string" ? metadata.connectionId : undefined,
    database: typeof metadata.database === "string" ? metadata.database : undefined,
    schema: typeof metadata.schema === "string" ? metadata.schema : undefined,
  };
}

function buildTabContext(located: LocatedTab | null): WorkspaceTabContextResult {
  if (!located) {
    return { tab: null };
  }

  const { panelId, tabId, metadata } = located;
  const queryState = useTabStateStore.getState().getQueryState(tabId);
  const summary = buildTabSummary(panelId, tabId, metadata);
  const gridId = computeGridId(tabId, metadata);

  let filter: string | undefined;
  let sort: { column: string; direction: "asc" | "desc" } | undefined;

  if (gridId) {
    const prefs = useGridPreferencesStore.getState().preferences[gridId];
    if (prefs?.quickFilter?.value) {
      filter = prefs.quickFilter.value;
    }

    const firstSort = prefs?.sortColumns[0];
    if (firstSort && firstSort.columnId) {
      sort = {
        column: firstSort.columnId,
        direction: firstSort.direction,
      };
    }
  }

  const sqlFromState = queryState?.query;
  const sqlFromMeta = typeof metadata.sql === "string" ? metadata.sql : undefined;

  return {
    tab: summary,
    sql: sqlFromState ?? sqlFromMeta,
    filter,
    sort,
    viewType:
      queryState?.tableViewType ??
      (typeof metadata.viewType === "string" ? metadata.viewType : undefined),
  };
}

/**
 * Execute an AI command and return the result.
 */
export async function executeCommand(command: ParsedCommand): Promise<CommandResult> {
  try {
    switch (command.name) {
      case "workspace.listTabs":
        return executeWorkspaceListTabs();
      case "workspace.getFocusedTab":
        return executeWorkspaceGetFocusedTab();
      case "workspace.getTabContext":
        return executeWorkspaceGetTabContext(
          command.params as WorkspaceGetTabContextParams,
        );
      case "crud.stage":
        return executeCrudStage(command.params as CrudStageParams);
      case "crud.unstage":
        return executeCrudUnstage(command.params as CrudUnstageParams);
      case "tab.updateContent":
        return executeTabUpdateContent(command.params as TabUpdateContentParams);
      case "tab.create":
        return executeTabCreate(command.params as TabCreateParams);
      case "tab.focus":
        return executeTabFocus(command.params as TabFocusParams);
      case "editor.insert":
        return executeEditorInsert(command.params as EditorInsertParams);
      case "query.run":
        return await executeQueryRun(command.params as QueryRunParams);
      case "grid.setFilter":
        return executeGridSetFilter(command.params as GridSetFilterParams);
      case "grid.setSort":
        return executeGridSetSort(command.params as GridSetSortParams);
      case "grid.setView":
        return executeGridSetView(command.params as GridSetViewParams);
      default:
        return { success: false, error: `Unknown command: ${command.name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Unique symbol to identify timeout errors
const TIMEOUT_ERROR_MARKER = Symbol("timeout");

interface TimeoutError extends Error {
  [TIMEOUT_ERROR_MARKER]: true;
}

function isTimeoutError(err: unknown): err is TimeoutError {
  return err !== null && typeof err === "object" && TIMEOUT_ERROR_MARKER in err;
}

export async function executeCommandWithTimeout(
  command: ParsedCommand,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
  const startTime = performance.now();

  const timer: { id: ReturnType<typeof setTimeout> | null } = { id: null };

  const timeoutPromise = new Promise<CommandResult>((_, reject) => {
    timer.id = setTimeout(() => {
      const err = new Error(`Command timed out after ${timeoutMs}ms`) as TimeoutError;
      err[TIMEOUT_ERROR_MARKER] = true;
      reject(err);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([executeCommand(command), timeoutPromise]);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startTime);
    if (isTimeoutError(error)) {
      return {
        success: false,
        error: `Timeout: ${command.name} exceeded ${timeoutMs}ms (ran for ${elapsed}ms)`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer.id !== null) {
      clearTimeout(timer.id);
    }
  }
}

export async function executeCommandsInParallel(
  commands: ParsedCommand[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BatchExecutionResult> {
  const startTime = performance.now();

  const results = await Promise.all(
    commands.map(async (command): Promise<BatchedCommandResult> => {
      const cmdStartTime = performance.now();
      const result = await executeCommandWithTimeout(command, timeoutMs);
      const executionTimeMs = Math.round(performance.now() - cmdStartTime);

      return {
        commandId: command.id,
        commandName: command.name,
        result,
        executionTimeMs,
      };
    }),
  );

  const totalTimeMs = Math.round(performance.now() - startTime);
  const successCount = results.filter((r) => r.result.success).length;
  const failureCount = results.length - successCount;

  return {
    results,
    totalTimeMs,
    successCount,
    failureCount,
  };
}

export function formatBatchedResultsForAgent(batchResult: BatchExecutionResult): string {
  const lines: string[] = [];

  lines.push(`## Batch Execution Complete (${batchResult.totalTimeMs}ms total)`);
  lines.push(`**${batchResult.successCount}** succeeded, **${batchResult.failureCount}** failed\n`);

  for (const item of batchResult.results) {
    const statusIcon = item.result.success ? "✓" : "✗";
    lines.push(`### ${statusIcon} ${item.commandName} (${item.executionTimeMs}ms)`);

    if (item.result.success) {
      const data = item.result.data as Record<string, unknown>;
      if ("rowCount" in data) {
        lines.push(`Returned ${data.rowCount} rows`);
      } else {
        const summary = JSON.stringify(data, null, 2);
        if (summary.length > 500) {
          lines.push("```json\n" + summary.slice(0, 500) + "...\n```");
        } else {
          lines.push("```json\n" + summary + "\n```");
        }
      }
    } else {
      lines.push(`**Error:** ${item.result.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Workspace Context Commands
// ============================================================================

function executeWorkspaceListTabs(): CommandResult {
  const panelContents = useWorkbenchStore.getState().panelContents;
  const tabs: WorkspaceTabSummary[] = [];

  for (const [panelId, panel] of panelContents) {
    for (const tabId of panel.tabIds) {
      const metadata = panel.metadata?.[tabId] ?? {};
      tabs.push(buildTabSummary(panelId, tabId, metadata));
    }
  }

  return {
    success: true,
    data: { tabs },
  };
}

function executeWorkspaceGetFocusedTab(): CommandResult {
  const focused = locateTab();
  return {
    success: true,
    data: buildTabContext(focused),
  };
}

function executeWorkspaceGetTabContext(params: WorkspaceGetTabContextParams): CommandResult {
  if (!params.tabId) {
    return { success: false, error: "Missing required parameter: tabId" };
  }

  const located = locateTab(params.tabId);
  if (!located) {
    return { success: false, error: `Tab not found: ${params.tabId}` };
  }

  return {
    success: true,
    data: buildTabContext(located),
  };
}

// ============================================================================
// CRUD Executor
// ============================================================================

function executeCrudStage(params: CrudStageParams): CommandResult {
  const {
    connectionId,
    database,
    schema,
    table,
    collection,
    operation,
    document,
    filter,
    update,
    primaryKeys,
    description,
  } = params;

  if (!connectionId) {
    return { success: false, error: "Missing required parameter: connectionId" };
  }

  const targetTable = table ?? collection;
  if (!targetTable) {
    return { success: false, error: "Missing required parameter: table or collection" };
  }

  const target = {
    connectionId,
    database,
    schema,
    table: targetTable,
  };

  let type: "data.insert" | "data.update" | "data.delete";
  let payload: Record<string, unknown>;

  switch (operation) {
    case "insert":
      if (!document || (typeof document === "object" && Object.keys(document).length === 0)) {
        return { success: false, error: "Insert operation requires a non-empty document" };
      }
      type = "data.insert";
      payload = { values: document };
      break;
    case "update":
      if (!primaryKeys && !filter) {
        return {
          success: false,
          error: "Update operation requires primaryKeys or filter to identify rows",
        };
      }
      if (!update || (typeof update === "object" && Object.keys(update).length === 0)) {
        return { success: false, error: "Update operation requires update data" };
      }
      type = "data.update";
      payload = { primaryKeys: primaryKeys ?? filter, ...update };
      break;
    case "delete":
      if (!primaryKeys && !filter) {
        return {
          success: false,
          error: "Delete operation requires primaryKeys or filter to identify rows",
        };
      }
      type = "data.delete";
      payload = { primaryKeys: primaryKeys ?? filter };
      break;
    default:
      return { success: false, error: `Unknown operation: ${operation}` };
  }

  const commandId = nanoid();
  const tableKey = useCrudStore.getState().getTableKey(target);

  useCrudStore.getState().stageCommand({
    id: commandId,
    type,
    target,
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description,
      source: "ai",
    },
    state: "staged",
  });

  const data: CrudStageResult = {
    staged: true,
    commandId,
    tableKey,
  };

  return { success: true, data };
}

function executeCrudUnstage(params: CrudUnstageParams): CommandResult {
  const { scope, commandId, table, connectionId } = params;

  const store = useCrudStore.getState();
  let unstagedCount = 0;

  switch (scope) {
    case "id": {
      if (!commandId) {
        return {
          success: false,
          error: "Missing required parameter: commandId (required when scope = id)",
        };
      }

      const tableKey = store.commandIndex.get(commandId);
      if (!tableKey) {
        return { success: false, error: `Command not found: ${commandId}` };
      }

      store.unstageCommand(commandId);
      unstagedCount = 1;
      break;
    }

    case "table": {
      if (!table) {
        return {
          success: false,
          error: "Missing required parameter: table (required when scope = table)",
        };
      }

      const matchingTableKeys: string[] = [];

      for (const [tableKey] of store.stagedCommands) {
        const parts = tableKey.split(":");
        const keyTable = parts[3];
        const keyConnectionId = parts[0];

        if (keyTable === table) {
          if (!connectionId || keyConnectionId === connectionId) {
            matchingTableKeys.push(tableKey);
          }
        }
      }

      if (matchingTableKeys.length === 0) {
        return { success: false, error: `No staged changes found for table: ${table}` };
      }

      for (const tableKey of matchingTableKeys) {
        const commands = store.stagedCommands.get(tableKey) ?? [];
        unstagedCount += commands.length;
        store.discardChanges(tableKey);
      }
      break;
    }

    case "all": {
      if (connectionId) {
        const matchingTableKeys: string[] = [];

        for (const [tableKey] of store.stagedCommands) {
          const parts = tableKey.split(":");
          const keyConnectionId = parts[0];
          if (keyConnectionId === connectionId) {
            matchingTableKeys.push(tableKey);
          }
        }

        if (matchingTableKeys.length === 0) {
          return {
            success: false,
            error: `No staged changes found for connection: ${connectionId}`,
          };
        }

        for (const tableKey of matchingTableKeys) {
          const commands = store.stagedCommands.get(tableKey) ?? [];
          unstagedCount += commands.length;
          store.discardChanges(tableKey);
        }
      } else {
        for (const [, commands] of store.stagedCommands) {
          unstagedCount += commands.length;
        }
        store.discardAll();
      }
      break;
    }

    default:
      return {
        success: false,
        error: `Unknown scope: ${scope}. Valid values are: id, table, all`,
      };
  }

  const data: CrudUnstageResult = {
    unstaged: true,
    count: unstagedCount,
  };

  return { success: true, data };
}

// ============================================================================
// Tab / Editor Executors
// ============================================================================

function executeTabUpdateContent(params: TabUpdateContentParams): CommandResult {
  const { tabId, content, title, mode = "replace" } = params;

  if (content === undefined && title === undefined) {
    return { success: false, error: "Missing required parameter: content or title" };
  }

  const located = locateTab(tabId);
  if (!located) {
    return { success: false, error: "Tab not found" };
  }

  const { panelId, tabId: targetTabId, metadata } = located;
  const workbench = useWorkbenchStore.getState();
  const tabStateStore = useTabStateStore.getState();

  const queryState = tabStateStore.getQueryState(targetTabId);
  const existingSql =
    queryState?.query ??
    (typeof metadata.sql === "string" ? metadata.sql : "");

  let nextSql: string | undefined;
  if (content !== undefined) {
    switch (mode) {
      case "append":
        nextSql = existingSql + (existingSql ? "\n" : "") + content;
        break;
      case "prepend":
        nextSql = content + (existingSql ? "\n" : "") + existingSql;
        break;
      case "replace":
      default:
        nextSql = content;
        break;
    }
  }

  const metadataUpdates: Partial<TabMetadata> = {};
  if (title !== undefined) {
    metadataUpdates.title = title;
  }
  if (nextSql !== undefined) {
    metadataUpdates.sql = nextSql;
  }

  if (Object.keys(metadataUpdates).length > 0) {
    workbench.updateTabMetadata(panelId, targetTabId, metadataUpdates);
  }

  if (nextSql !== undefined) {
    const connectionId = typeof metadata.connectionId === "string" ? metadata.connectionId : "";
    const database = typeof metadata.database === "string" ? metadata.database : "";
    const schema = typeof metadata.schema === "string" ? metadata.schema : "public";

    tabStateStore.setQueryState(
      targetTabId,
      { query: nextSql },
      {
        connectionId,
        database,
        schema,
      },
    );

    const focusedEditor = editorRegistry.getFocusedEditor();
    if (focusedEditor) {
      const split = splitEditorId(focusedEditor.id);
      if (split && split.tabId === targetTabId) {
        focusedEditor.getRef()?.setValue(nextSql);
      }
    }
  }

  const data: TabUpdateResult = {
    success: true,
    tabId: targetTabId,
  };

  return { success: true, data };
}

function executeTabCreate(params: TabCreateParams): CommandResult {
  const { connectionId, title, content, database, schema } = params;

  if (!connectionId) {
    return { success: false, error: "Missing required parameter: connectionId" };
  }

  if (!connectionExists(connectionId)) {
    return { success: false, error: `Connection not found: ${connectionId}` };
  }

  ensureWorkbenchInitialized();

  const panelId = getFocusedPanelId();
  if (!panelId) {
    return { success: false, error: "No panel found in workspace." };
  }

  const tabId = `query-ai-${Date.now()}-${nanoid().slice(0, 8)}`;
  const tabTitle = title ?? "New Query";
  const sql = content ?? "";

  const workbench = useWorkbenchStore.getState();
  workbench.addTab(panelId, tabId, {
    type: "query",
    title: tabTitle,
    connectionId,
    database,
    schema,
    sql,
  });
  workbench.setActiveTab(panelId, tabId);
  workbench.focusPanel(panelId);

  useTabStateStore.getState().setQueryState(
    tabId,
    { query: sql },
    {
      connectionId,
      database: database ?? "",
      schema: schema ?? "public",
    },
  );

  const data: TabCreateResult = {
    success: true,
    tabId,
  };

  return { success: true, data };
}

function executeEditorInsert(params: EditorInsertParams): CommandResult {
  const { text, position = "cursor" } = params;

  if (!text) {
    return { success: false, error: "Missing required parameter: text" };
  }

  const focusedEditor = editorRegistry.getFocusedEditor();
  if (focusedEditor) {
    const ref = focusedEditor.getRef();
    if (ref) {
      if (position === "replace") {
        ref.setValue(text);
      } else if (position === "end") {
        const existing = ref.getValue();
        const next = existing ? `${existing}\n${text}` : text;
        ref.setValue(next);
      } else {
        ref.replaceSelection(text);
      }

      const split = splitEditorId(focusedEditor.id);
      if (split) {
        const located = locateTab(split.tabId);
        const metadata = located?.metadata ?? {};
        const updatedValue = ref.getValue();

        useWorkbenchStore
          .getState()
          .updateTabMetadata(split.panelId, split.tabId, { sql: updatedValue });

        useTabStateStore.getState().setQueryState(
          split.tabId,
          { query: updatedValue },
          {
            connectionId:
              typeof focusedEditor.connectionId === "string"
                ? focusedEditor.connectionId
                : "",
            database:
              typeof focusedEditor.database === "string"
                ? focusedEditor.database
                : (typeof metadata.database === "string" ? metadata.database : ""),
            schema:
              typeof focusedEditor.schema === "string"
                ? focusedEditor.schema
                : (typeof metadata.schema === "string" ? metadata.schema : "public"),
          },
        );
      }

      const data: EditorInsertResult = { success: true };
      return { success: true, data };
    }
  }

  const fallback = executeTabUpdateContent({ content: text, mode: "append" });
  if (!fallback.success) {
    return fallback;
  }

  const data: EditorInsertResult = { success: true };
  return { success: true, data };
}

function executeTabFocus(params: TabFocusParams): CommandResult {
  const { tabId } = params;

  if (!tabId) {
    return { success: false, error: "Missing required parameter: tabId" };
  }

  const located = locateTab(tabId);
  if (!located) {
    return { success: false, error: `Tab not found: ${tabId}` };
  }

  const workbench = useWorkbenchStore.getState();
  workbench.setActiveTab(located.panelId, tabId);
  workbench.focusPanel(located.panelId);

  const data: TabFocusResult = {
    success: true,
    tabId,
    panelId: located.panelId,
  };

  return { success: true, data };
}

// ============================================================================
// Grid Executors
// ============================================================================

function executeGridSetFilter(params: GridSetFilterParams): CommandResult {
  const { tabId, filter } = params;

  if (!filter) {
    return { success: false, error: "Missing required parameter: filter" };
  }

  const located = locateTab(tabId);
  if (!located) {
    return { success: false, error: "Tab not found" };
  }

  const gridId = computeGridId(located.tabId, located.metadata);
  if (!gridId) {
    return { success: false, error: "Target tab does not support grid filtering" };
  }

  useGridPreferencesStore
    .getState()
    .setQuickFilter(gridId, { value: filter, mode: "where" });

  return {
    success: true,
    data: {
      success: true,
      tabId: located.tabId,
    },
  };
}

function executeGridSetSort(params: GridSetSortParams): CommandResult {
  const { tabId, column, direction } = params;

  if (!column) {
    return { success: false, error: "Missing required parameter: column" };
  }
  const normalizedDirection = direction.toLowerCase();
  if (normalizedDirection !== "asc" && normalizedDirection !== "desc") {
    return { success: false, error: "Invalid direction: must be 'asc' or 'desc'" };
  }

  const located = locateTab(tabId);
  if (!located) {
    return { success: false, error: "Tab not found" };
  }

  const gridId = computeGridId(located.tabId, located.metadata);
  if (!gridId) {
    return { success: false, error: "Target tab does not support grid sorting" };
  }

  useGridPreferencesStore.getState().upsert(gridId, (draft) => {
    draft.sortColumns = [
      {
        columnId: column,
        direction: normalizedDirection,
      },
    ];
  });

  return {
    success: true,
    data: {
      success: true,
      tabId: located.tabId,
    },
  };
}

function executeGridSetView(params: GridSetViewParams): CommandResult {
  const { tabId, view } = params;

  if (!view) {
    return { success: false, error: "Missing required parameter: view" };
  }

  const located = locateTab(tabId);
  if (!located) {
    return { success: false, error: "Tab not found" };
  }

  useWorkbenchStore
    .getState()
    .updateTabMetadata(located.panelId, located.tabId, { viewType: view });

  useTabStateStore
    .getState()
    .setQueryState(located.tabId, { tableViewType: view });

  return {
    success: true,
    data: {
      success: true,
      tabId: located.tabId,
    },
  };
}

// ============================================================================
// Query Executor
// ============================================================================

function truncateRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= MAX_QUERY_RESULT_ROWS) {
    return { rows, truncated: false };
  }
  return {
    rows: rows.slice(0, MAX_QUERY_RESULT_ROWS),
    truncated: true,
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseMongoReadOperation(query: string): DocumentOperation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return null;
  }

  const payload = asObjectRecord(parsed);
  if (!payload) return null;

  const opRaw =
    (typeof payload.type === "string" && payload.type) ||
    (typeof payload.operation === "string" && payload.operation) ||
    (typeof payload.op === "string" && payload.op) ||
    "";
  const op = opRaw.trim().toLowerCase();
  if (!READ_ONLY_MONGO_OPERATIONS.has(op)) {
    return null;
  }

  const collection =
    typeof payload.collection === "string" && payload.collection.trim().length > 0
      ? payload.collection.trim()
      : undefined;
  const filter =
    payload.filter && typeof payload.filter === "object" && !Array.isArray(payload.filter)
      ? (payload.filter as Record<string, unknown>)
      : undefined;
  const sort =
    payload.sort && typeof payload.sort === "object" && !Array.isArray(payload.sort)
      ? (payload.sort as Record<string, 1 | -1>)
      : undefined;
  const projection =
    payload.projection &&
    typeof payload.projection === "object" &&
    !Array.isArray(payload.projection)
      ? (payload.projection as Record<string, 0 | 1>)
      : undefined;
  const limit = typeof payload.limit === "number" ? payload.limit : undefined;
  const skip = typeof payload.skip === "number" ? payload.skip : undefined;
  const sampleSize =
    typeof payload.sampleSize === "number" ? payload.sampleSize : undefined;
  const maxDepth =
    typeof payload.maxDepth === "number" ? payload.maxDepth : undefined;

  switch (op) {
    case "find":
      if (!collection) return null;
      return { type: "find", collection, filter: filter ?? {}, limit, skip, sort, projection };
    case "findpage":
      if (!collection) return null;
      return { type: "findPage", collection, filter: filter ?? {}, limit, sort, projection };
    case "aggregate": {
      if (!collection) return null;
      const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : null;
      if (!pipeline) return null;
      return { type: "aggregate", collection, pipeline: pipeline as object[] };
    }
    case "count":
      if (!collection) return null;
      return { type: "count", collection, filter };
    case "sampleschema":
      if (!collection) return null;
      return { type: "sampleSchema", collection, filter, sampleSize, maxDepth };
    case "listcollections":
      return { type: "listCollections" };
    default:
      return null;
  }
}

function parseRedisCommandTokens(query: string): string[] {
  const matcher = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(query)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

function parseRedisReadOperation(query: string): KeyValueOperation | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    const payload = asObjectRecord(parsed);
    if (!payload) return null;
    const type = typeof payload.type === "string" ? payload.type : "";

    switch (type) {
      case "get":
        return typeof payload.key === "string" ? { type: "get", key: payload.key } : null;
      case "exists":
        return Array.isArray(payload.keys)
          ? { type: "exists", keys: payload.keys.map(String) }
          : null;
      case "scan":
        return {
          type: "scan",
          pattern: typeof payload.pattern === "string" ? payload.pattern : "*",
          cursor: typeof payload.cursor === "number" ? payload.cursor : 0,
          count: typeof payload.count === "number" ? payload.count : 200,
        };
      case "scanWithPreviews":
        return {
          type: "scanWithPreviews",
          pattern: typeof payload.pattern === "string" ? payload.pattern : "*",
          cursor: typeof payload.cursor === "number" ? payload.cursor : 0,
          count: typeof payload.count === "number" ? payload.count : 200,
        };
      case "type":
        return typeof payload.key === "string" ? { type: "type", key: payload.key } : null;
      case "ttl":
        return typeof payload.key === "string" ? { type: "ttl", key: payload.key } : null;
      case "dbSize":
        return { type: "dbSize" };
      case "serverInfo":
        return {
          type: "serverInfo",
          section: typeof payload.section === "string" ? payload.section : undefined,
        };
      case "hashGetAll":
        return typeof payload.key === "string" ? { type: "hashGetAll", key: payload.key } : null;
      case "listRange":
        if (typeof payload.key !== "string") return null;
        return {
          type: "listRange",
          key: payload.key,
          start: typeof payload.start === "number" ? payload.start : 0,
          stop: typeof payload.stop === "number" ? payload.stop : 99,
        };
      case "listLen":
        return typeof payload.key === "string" ? { type: "listLen", key: payload.key } : null;
      case "setMembers":
        return typeof payload.key === "string" ? { type: "setMembers", key: payload.key } : null;
      case "zSetRange":
        if (typeof payload.key !== "string") return null;
        return {
          type: "zSetRange",
          key: payload.key,
          start: typeof payload.start === "number" ? payload.start : 0,
          stop: typeof payload.stop === "number" ? payload.stop : 99,
          with_scores: Boolean(payload.withScores),
        };
      case "streamRange":
        if (typeof payload.key !== "string") return null;
        return {
          type: "streamRange",
          key: payload.key,
          start: typeof payload.start === "string" ? payload.start : "-",
          end: typeof payload.end === "string" ? payload.end : "+",
          count: typeof payload.count === "number" ? payload.count : undefined,
        };
      case "streamLen":
        return typeof payload.key === "string" ? { type: "streamLen", key: payload.key } : null;
      case "executeRaw": {
        if (typeof payload.command !== "string") return null;
        const command = payload.command.trim().toUpperCase();
        if (!READ_ONLY_REDIS_RAW_COMMANDS.has(command)) return null;
        const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
        return { type: "executeRaw", command, args };
      }
      default:
        return null;
    }
  }

  const tokens = parseRedisCommandTokens(trimmed);
  if (tokens.length === 0) return null;
  const command = tokens[0]?.trim().toUpperCase();
  if (!command || !READ_ONLY_REDIS_RAW_COMMANDS.has(command)) {
    return null;
  }
  return {
    type: "executeRaw",
    command,
    args: tokens.slice(1),
  };
}

function normalizeRedisValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const payload = value as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type : "";
  const raw = payload.value;

  switch (type) {
    case "nil":
      return null;
    case "string":
    case "integer":
    case "float":
    case "boolean":
      return raw;
    case "bytes":
      return Array.isArray(raw) ? raw.map((n) => Number(n)) : raw;
    case "array":
      return Array.isArray(raw) ? raw.map(normalizeRedisValue) : [];
    case "map": {
      const mapped = asObjectRecord(raw);
      if (!mapped) return {};
      return Object.fromEntries(
        Object.entries(mapped).map(([key, item]) => [key, normalizeRedisValue(item)]),
      );
    }
    default:
      return value;
  }
}

function toDocumentRows(records: Record<string, unknown>[]): { columns: string[]; rows: unknown[][] } {
  const columns = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const rows = records.map((record) => columns.map((column) => record[column]));
  return { columns, rows };
}

async function executeQueryRun(params: QueryRunParams): Promise<CommandResult> {
  const { connectionId, query, title, database, language, timeoutSecs } = params;
  const timeoutMs = resolveQueryRunTimeoutMs(timeoutSecs);

  if (!connectionId) {
    return { success: false, error: "Missing required parameter: connectionId" };
  }

  if (!query) {
    return { success: false, error: "Missing required parameter: query" };
  }

  if (!connectionExists(connectionId)) {
    return { success: false, error: `Connection not found: ${connectionId}` };
  }

  const dbType = getConnectionDbType(connectionId);
  const mode = resolveQueryMode(dbType, language);

  if (!mode) {
    return {
      success: false,
      error: "Unable to resolve connection paradigm for query.run",
    };
  }

  try {
    if (mode === "sql") {
      if (!isReadOnlyStatement(query)) {
        return {
          success: false,
          error:
            "query.run only supports read-only SQL for SQL connections.",
        };
      }

      await withQueryRunTimeout(
        "Connection setup",
        timeoutMs,
        databaseService.connectById(connectionId, database),
      );
      const result = await withQueryRunTimeout(
        "SQL query",
        timeoutMs,
        BackendAPI.query(connectionId, query, timeoutSecs),
      );
      const rows = result.rows;
      const truncated = truncateRows(rows);
      const columns = result.columns.map((column) => column.name);

      const data: QueryRunResult = {
        success: true,
        mode: "sql",
        connectionId,
        query,
        title,
        rowCount: rows.length,
        columns,
        rows: truncated.rows,
        meta: {
          truncated: truncated.truncated,
          totalRows: rows.length,
        },
      };
      return { success: true, data };
    }

    if (mode === "document") {
      const operation = parseMongoReadOperation(query);
      if (!operation) {
        return {
          success: false,
          error:
            "For MongoDB query.run, params.query must be JSON with a read-only operation (find|findPage|aggregate|count|sampleSchema|listCollections).",
        };
      }

      await withQueryRunTimeout(
        "Connection setup",
        timeoutMs,
        databaseService.connectById(connectionId, database),
      );
      const result = await withQueryRunTimeout(
        "MongoDB operation",
        timeoutMs,
        invoke<DocumentResult>("document_execute", {
          connId: connectionId,
          operation,
          database: database ?? null,
        }),
      );

      let records: Record<string, unknown>[] = [];
      let columns: string[] | undefined;
      let rows: unknown[][];
      let rowCount: number;
      const meta: Record<string, unknown> = {};

      switch (result.type) {
        case "documents": {
          const docs = Array.isArray(result.data) ? result.data : [];
          records = docs as Record<string, unknown>[];
          const table = toDocumentRows(records);
          columns = table.columns;
          rows = table.rows;
          rowCount = records.length;
          break;
        }
        case "documentPage": {
          const docs = Array.isArray(result.data.documents)
            ? result.data.documents
            : [];
          records = docs as Record<string, unknown>[];
          const table = toDocumentRows(records);
          columns = table.columns;
          rows = table.rows;
          rowCount = records.length;
          meta.hasMore = result.data.hasMore;
          meta.nextCursor = result.data.nextCursor;
          break;
        }
        case "count": {
          rowCount = result.data;
          columns = ["count"];
          rows = [[rowCount]];
          break;
        }
        case "collections": {
          records = (Array.isArray(result.data) ? result.data : []).map(
            (item) => item as unknown as Record<string, unknown>,
          );
          const table = toDocumentRows(records);
          columns = table.columns;
          rows = table.rows;
          rowCount = records.length;
          break;
        }
        case "schemaSample": {
          records = Array.isArray(result.data.fields)
            ? (result.data.fields as unknown as Record<string, unknown>[])
            : [];
          const table = toDocumentRows(records);
          columns = table.columns;
          rows = table.rows;
          rowCount = records.length;
          meta.sampleSize = result.data.sampleSize;
          meta.scannedCount = result.data.scannedCount;
          break;
        }
        default:
          return {
            success: false,
            error: `Unsupported MongoDB read result for query.run: ${result.type}`,
          };
      }

      const truncatedRows = truncateRows(rows);
      const truncatedRecords = truncateRows(records);
      const data: QueryRunResult = {
        success: true,
        mode: "document",
        connectionId,
        query,
        title,
        rowCount,
        columns,
        rows: truncatedRows.rows,
        records: truncatedRecords.rows,
        meta: {
          ...meta,
          truncated:
            truncatedRows.truncated || truncatedRecords.truncated,
        },
      };

      return { success: true, data };
    }

    const operation = parseRedisReadOperation(query);
    if (!operation) {
      return {
        success: false,
        error:
          "For Redis query.run, params.query must be a read-only Redis command or JSON read operation.",
      };
    }

    await withQueryRunTimeout(
      "Connection setup",
      timeoutMs,
      databaseService.connectById(connectionId, database),
    );
    const result = await withQueryRunTimeout(
      "Redis operation",
      timeoutMs,
      invoke<KeyValueResult>("keyvalue_execute", {
        connId: connectionId,
        operation,
      }),
    );

    let rowCount: number;
    let columns: string[] | undefined;
    let rows: unknown[][] = [];
    let records: Record<string, unknown>[] = [];

    switch (result.type) {
      case "value": {
        columns = ["value"];
        rows = [[normalizeRedisValue(result.data)]];
        rowCount = result.data == null ? 0 : 1;
        break;
      }
      case "count":
        columns = ["count"];
        rows = [[result.data]];
        rowCount = 1;
        break;
      case "bool":
        columns = ["value"];
        rows = [[result.data]];
        rowCount = 1;
        break;
      case "ttl":
        columns = ["ttl"];
        rows = [[result.data]];
        rowCount = 1;
        break;
      case "key_type":
        columns = ["type"];
        rows = [[result.data]];
        rowCount = 1;
        break;
      case "server_info":
        records = Object.entries(result.data).map(([key, value]) => ({ key, value }));
        rowCount = records.length;
        ({ columns, rows } = toDocumentRows(records));
        break;
      case "scan":
      case "scanWithPreviews":
        records = result.data.keys as unknown as Record<string, unknown>[];
        rowCount = records.length;
        ({ columns, rows } = toDocumentRows(records));
        break;
      case "hash":
        records = Object.entries(result.data).map(([field, value]) => ({ field, value }));
        rowCount = records.length;
        ({ columns, rows } = toDocumentRows(records));
        break;
      case "list":
      case "set":
        columns = ["value"];
        rows = result.data.map((value) => [value]);
        rowCount = rows.length;
        break;
      case "zset":
        records = result.data as unknown as Record<string, unknown>[];
        rowCount = records.length;
        ({ columns, rows } = toDocumentRows(records));
        break;
      case "stream":
        records = result.data as unknown as Record<string, unknown>[];
        rowCount = records.length;
        ({ columns, rows } = toDocumentRows(records));
        break;
      case "ok":
        columns = [];
        rows = [];
        rowCount = 0;
        break;
    }

    const truncatedRows = truncateRows(rows);
    const truncatedRecords = truncateRows(records);
    const data: QueryRunResult = {
      success: true,
      mode: "keyvalue",
      connectionId,
      query,
      title,
      rowCount,
      columns,
      rows: truncatedRows.rows,
      records: truncatedRecords.rows,
      meta: {
        truncated: truncatedRows.truncated || truncatedRecords.truncated,
      },
    };

    return { success: true, data };
  } catch (error) {
    if (error instanceof QueryRunTimeoutError) {
      return {
        success: false,
        error: error.message,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// Result Formatter
// ============================================================================

export function formatResultForConversation(
  command: ParsedCommand,
  result: CommandResult,
): string {
  if (!result.success) {
    return `**Error:** ${result.error}`;
  }

  const data = result.data;

  switch (command.name) {
    case "crud.stage": {
      const stageResult = data as CrudStageResult;
      return `**Change staged** (ID: ${stageResult.commandId})\nReview in the Changes panel and commit when ready.`;
    }
    case "crud.unstage": {
      const unstageResult = data as CrudUnstageResult;
      return `**Changes unstaged** (${unstageResult.count} command${unstageResult.count === 1 ? "" : "s"} removed)`;
    }
    case "workspace.listTabs": {
      const tabs = (data as { tabs: WorkspaceTabSummary[] }).tabs;
      return `**Workspace tabs:** ${tabs.length}`;
    }
    case "workspace.getFocusedTab":
    case "workspace.getTabContext": {
      const tabContext = data as WorkspaceTabContextResult;
      if (!tabContext.tab) {
        return "**No tab context available**";
      }
      return `**Focused tab:** ${tabContext.tab.title ?? tabContext.tab.tabId}`;
    }
    case "tab.updateContent":
    case "tab.create":
    case "tab.focus":
    case "editor.insert":
    case "grid.setFilter":
    case "grid.setSort":
    case "grid.setView":
      return `**Done**`;
    case "query.run": {
      const queryResult = data as QueryRunResult;
      const noun = queryResult.rowCount === 1 ? "row" : "rows";
      const preview =
        queryResult.records?.slice(0, 3) ??
        queryResult.rows?.slice(0, 3);
      const previewText =
        preview && preview.length > 0
          ? `\n\`\`\`json\n${JSON.stringify(preview, null, 2)}\n\`\`\``
          : "";
      const truncated =
        queryResult.meta &&
        typeof queryResult.meta.truncated === "boolean" &&
        queryResult.meta.truncated
          ? "\n(Preview truncated)"
          : "";
      return `**Query executed** (${queryResult.mode}) — ${queryResult.rowCount} ${noun}${truncated}${previewText}`;
    }
    default:
      return `**Result:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}
