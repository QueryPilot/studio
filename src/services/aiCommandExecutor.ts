/**
 * AI Command Executor
 *
 * Executes approved AI commands against the database.
 * Returns results for injection back into conversation.
 */

import { nanoid } from "nanoid";
import { invoke } from "@tauri-apps/api/core";
import { useCrudStore } from "@/stores/crudStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import type {
  ParsedCommand,
  SqlExecuteParams,
  SqlExecuteResult,
  SqlExplainParams,
  SqlExplainResult,
  MongodbFindParams,
  MongodbFindResult,
  MongodbAggregateParams,
  MongodbAggregateResult,
  MongodbCountParams,
  MongodbCountResult,
  RedisGetParams,
  RedisGetResult,
  RedisKeysParams,
  RedisKeysResult,
  RedisScanParams,
  RedisScanResult,
  CrudStageParams,
  CrudStageResult,
  TabUpdateParams,
  TabUpdateResult,
  TabCreateParams,
  TabCreateResult,
  EditorInsertParams,
  EditorInsertResult,
} from "@/types/aiCommands";

export type CommandResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Execute an AI command and return the result.
 */
export async function executeCommand(command: ParsedCommand): Promise<CommandResult> {
  try {
    switch (command.name) {
      case "sql.execute":
        return await executeSqlQuery(command.params as SqlExecuteParams);
      case "sql.explain":
        return await executeSqlExplain(command.params as SqlExplainParams);
      case "mongodb.find":
        return await executeMongoFind(command.params as MongodbFindParams);
      case "mongodb.aggregate":
        return await executeMongoAggregate(command.params as MongodbAggregateParams);
      case "mongodb.count":
        return await executeMongoCount(command.params as MongodbCountParams);
      case "redis.get":
        return await executeRedisGet(command.params as RedisGetParams);
      case "redis.keys":
        return await executeRedisKeys(command.params as RedisKeysParams);
      case "redis.scan":
        return await executeRedisScan(command.params as RedisScanParams);
      case "crud.stage":
        return executeCrudStage(command.params as CrudStageParams);
      case "tab.update":
        return executeTabUpdate(command.params as TabUpdateParams);
      case "tab.create":
        return executeTabCreate(command.params as TabCreateParams);
      case "editor.insert":
        return executeEditorInsert(command.params as EditorInsertParams);
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

// ============================================================================
// SQL Executors
// ============================================================================

async function executeSqlQuery(params: SqlExecuteParams): Promise<CommandResult> {
  const { connectionId, sql, limit = 100 } = params;

  // Validate read-only
  const sqlUpper = sql.trim().toUpperCase();
  const isReadOnly =
    sqlUpper.startsWith("SELECT") ||
    sqlUpper.startsWith("WITH") ||
    sqlUpper.startsWith("SHOW") ||
    sqlUpper.startsWith("DESCRIBE") ||
    sqlUpper.startsWith("EXPLAIN");

  if (!isReadOnly) {
    return { success: false, error: "Only SELECT queries are allowed. Use crud.stage for mutations." };
  }

  // Add LIMIT if not present
  const limitedSql = sqlUpper.includes("LIMIT")
    ? sql
    : `${sql.trim().replace(/;$/, "")} LIMIT ${Math.min(limit, 1000)}`;

  const startTime = performance.now();

  try {
    const result = await invoke<{ columns: Array<{ name: string }>; rows: unknown[][] }>(
      "execute_query",
      { connectionId, sql: limitedSql }
    );
    const executionTimeMs = Math.round(performance.now() - startTime);

    const data: SqlExecuteResult = {
      columns: result.columns.map((c) => c.name),
      rows: result.rows,
      rowCount: result.rows.length,
      executionTimeMs,
      truncated: result.rows.length >= limit,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeSqlExplain(params: SqlExplainParams): Promise<CommandResult> {
  const { connectionId, sql } = params;
  const explainSql = `EXPLAIN ${sql}`;

  const startTime = performance.now();

  try {
    const result = await invoke<{ columns: Array<{ name: string }>; rows: unknown[][] }>(
      "execute_query",
      { connectionId, sql: explainSql }
    );
    const executionTimeMs = Math.round(performance.now() - startTime);

    const data: SqlExplainResult = {
      plan: result.rows.map((r) => r.join(" ")).join("\n"),
      executionTimeMs,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// MongoDB Executors
// ============================================================================

async function executeMongoFind(params: MongodbFindParams): Promise<CommandResult> {
  const { connectionId, collection, filter = {}, projection, sort, limit = 20 } = params;

  const startTime = performance.now();

  try {
    // Call MongoDB find via backend
    const documents = await invoke<Record<string, unknown>[]>("mongodb_find", {
      connectionId,
      collection,
      filter: JSON.stringify(filter),
      projection: projection ? JSON.stringify(projection) : null,
      sort: sort ? JSON.stringify(sort) : null,
      limit: Math.min(limit, 100),
    });
    const executionTimeMs = Math.round(performance.now() - startTime);

    const data: MongodbFindResult = {
      documents,
      count: documents.length,
      executionTimeMs,
      truncated: documents.length >= limit,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeMongoAggregate(params: MongodbAggregateParams): Promise<CommandResult> {
  const { connectionId, collection, pipeline } = params;

  const startTime = performance.now();

  try {
    const results = await invoke<Record<string, unknown>[]>("mongodb_aggregate", {
      connectionId,
      collection,
      pipeline: JSON.stringify(pipeline),
    });
    const executionTimeMs = Math.round(performance.now() - startTime);

    const data: MongodbAggregateResult = {
      results,
      executionTimeMs,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeMongoCount(params: MongodbCountParams): Promise<CommandResult> {
  const { connectionId, collection, filter = {} } = params;

  const startTime = performance.now();

  try {
    const count = await invoke<number>("mongodb_count", {
      connectionId,
      collection,
      filter: JSON.stringify(filter),
    });
    const executionTimeMs = Math.round(performance.now() - startTime);

    const data: MongodbCountResult = {
      count,
      executionTimeMs,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Redis Executors
// ============================================================================

async function executeRedisGet(params: RedisGetParams): Promise<CommandResult> {
  const { connectionId, key } = params;

  try {
    const [typeResult, valueResult, ttlResult] = await Promise.all([
      invoke<string>("redis_type", { connectionId, key }),
      invoke<unknown>("redis_get", { connectionId, key }),
      invoke<number>("redis_ttl", { connectionId, key }),
    ]);

    const data: RedisGetResult = {
      key,
      type: typeResult as RedisGetResult["type"],
      value: valueResult,
      ttl: ttlResult,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeRedisKeys(params: RedisKeysParams): Promise<CommandResult> {
  const { connectionId, pattern = "*", limit = 100 } = params;

  try {
    const keys = await invoke<string[]>("redis_keys", {
      connectionId,
      pattern,
      limit: Math.min(limit, 1000),
    });

    const data: RedisKeysResult = {
      keys,
      count: keys.length,
      truncated: keys.length >= limit,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeRedisScan(params: RedisScanParams): Promise<CommandResult> {
  const { connectionId, pattern = "*", count = 100, cursor = "0" } = params;

  try {
    const result = await invoke<{ keys: string[]; cursor: string }>("redis_scan", {
      connectionId,
      pattern,
      cursor,
      count,
    });

    const data: RedisScanResult = {
      keys: result.keys,
      cursor: result.cursor,
      done: result.cursor === "0",
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// CRUD Executor
// ============================================================================

function executeCrudStage(params: CrudStageParams): CommandResult {
  const { connectionId, database, schema, table, collection, operation, document, filter, update, primaryKeys, description } = params;

  const target = {
    connectionId,
    database,
    schema,
    table: table ?? collection,
  };

  let type: "data.insert" | "data.update" | "data.delete";
  let payload: Record<string, unknown>;

  switch (operation) {
    case "insert":
      type = "data.insert";
      payload = { values: document ?? {} };
      break;
    case "update":
      type = "data.update";
      payload = { primaryKeys: primaryKeys ?? filter, ...update };
      break;
    case "delete":
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

// ============================================================================
// Tab Executors
// ============================================================================

function executeTabUpdate(params: TabUpdateParams): CommandResult {
  const { tabId, content, title } = params;
  const store = useWorkspaceScreenStore.getState();

  // Find the tab
  const panels = store.getPanels();
  let targetPanelId: string | null = null;
  let targetTabId = tabId;

  for (const [panelId, panel] of panels) {
    if (tabId && panel.tabs.has(tabId)) {
      targetPanelId = panelId;
      break;
    } else if (!tabId && panel.activeTabId) {
      targetPanelId = panelId;
      targetTabId = panel.activeTabId;
      break;
    }
  }

  if (!targetPanelId || !targetTabId) {
    return { success: false, error: "Tab not found" };
  }

  const updates: Record<string, unknown> = {};
  if (title) updates.title = title;
  if (content) updates.payload = { sql: content };

  store.updateTab(targetPanelId, targetTabId, updates);

  const data: TabUpdateResult = {
    success: true,
    tabId: targetTabId,
  };

  return { success: true, data };
}

function executeTabCreate(params: TabCreateParams): CommandResult {
  const { connectionId, type, title, content } = params;
  const store = useWorkspaceScreenStore.getState();

  const panelId = store.getActivePanelId();
  const tabId = store.addTab(panelId, {
    type,
    connectionId,
    title: title ?? "New Query",
    payload: { sql: content ?? "" },
  });

  const data: TabCreateResult = {
    success: true,
    tabId,
  };

  return { success: true, data };
}

function executeEditorInsert(params: EditorInsertParams): CommandResult {
  const { text, position = "cursor" } = params;
  const store = useWorkspaceScreenStore.getState();

  const panels = store.getPanels();
  for (const [panelId, panel] of panels) {
    if (panel.activeTabId) {
      const tab = panel.tabs.get(panel.activeTabId);
      if (tab?.payload?.sql !== undefined) {
        const currentSql = (tab.payload.sql as string) ?? "";
        let newSql: string;

        switch (position) {
          case "replace":
            newSql = text;
            break;
          case "end":
            newSql = currentSql + "\n" + text;
            break;
          case "cursor":
          default:
            // Without cursor position, append
            newSql = currentSql + "\n" + text;
            break;
        }

        store.updateTab(panelId, panel.activeTabId, { payload: { sql: newSql } });

        const data: EditorInsertResult = { success: true };
        return { success: true, data };
      }
    }
  }

  return { success: false, error: "No active editor tab" };
}

// ============================================================================
// Result Formatter
// ============================================================================

/**
 * Format command result for display in conversation.
 */
export function formatResultForConversation(
  command: ParsedCommand,
  result: CommandResult
): string {
  if (!result.success) {
    return `**Error:** ${result.error}`;
  }

  const data = result.data as Record<string, unknown>;

  switch (command.name) {
    case "sql.execute": {
      const sqlResult = data as SqlExecuteResult;
      if (sqlResult.rowCount === 0) {
        return `**Query returned no results** (${sqlResult.executionTimeMs}ms)`;
      }
      return formatTableResult(sqlResult.columns, sqlResult.rows, sqlResult.rowCount, sqlResult.truncated, sqlResult.executionTimeMs);
    }
    case "sql.explain": {
      const explainResult = data as SqlExplainResult;
      return `**Query Plan** (${explainResult.executionTimeMs}ms)\n\`\`\`\n${explainResult.plan}\n\`\`\``;
    }
    case "mongodb.find": {
      const mongoResult = data as MongodbFindResult;
      if (mongoResult.count === 0) {
        return `**No documents found** (${mongoResult.executionTimeMs}ms)`;
      }
      return `**Found ${mongoResult.count} documents** (${mongoResult.executionTimeMs}ms)${mongoResult.truncated ? " (truncated)" : ""}\n\`\`\`json\n${JSON.stringify(mongoResult.documents, null, 2)}\n\`\`\``;
    }
    case "mongodb.aggregate": {
      const aggResult = data as MongodbAggregateResult;
      return `**Aggregation Result** (${aggResult.executionTimeMs}ms)\n\`\`\`json\n${JSON.stringify(aggResult.results, null, 2)}\n\`\`\``;
    }
    case "mongodb.count": {
      const countResult = data as MongodbCountResult;
      return `**Document count: ${countResult.count}** (${countResult.executionTimeMs}ms)`;
    }
    case "redis.get": {
      const redisResult = data as RedisGetResult;
      if (redisResult.type === "none") {
        return `**Key not found:** ${redisResult.key}`;
      }
      const ttlInfo = redisResult.ttl === -1 ? "no expiry" : redisResult.ttl === -2 ? "expired" : `TTL: ${redisResult.ttl}s`;
      return `**${redisResult.key}** (${redisResult.type}, ${ttlInfo})\n\`\`\`json\n${JSON.stringify(redisResult.value, null, 2)}\n\`\`\``;
    }
    case "redis.keys": {
      const keysResult = data as RedisKeysResult;
      return `**Found ${keysResult.count} keys**${keysResult.truncated ? " (truncated)" : ""}\n\`\`\`\n${keysResult.keys.join("\n")}\n\`\`\``;
    }
    case "redis.scan": {
      const scanResult = data as RedisScanResult;
      return `**Scanned ${scanResult.keys.length} keys** (cursor: ${scanResult.cursor}, done: ${scanResult.done})\n\`\`\`\n${scanResult.keys.join("\n")}\n\`\`\``;
    }
    case "crud.stage": {
      const stageResult = data as CrudStageResult;
      return `**Change staged** (ID: ${stageResult.commandId})\nReview in the Changes panel and commit when ready.`;
    }
    case "tab.update":
    case "tab.create":
    case "editor.insert":
      return `**Done**`;
    default:
      return `**Result:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}

function formatTableResult(
  columns: string[],
  rows: unknown[][],
  rowCount: number,
  truncated: boolean,
  executionTimeMs: number
): string {
  const maxRows = 20;
  const displayRows = rows.slice(0, maxRows);
  const header = `**${rowCount} rows** (${executionTimeMs}ms)${truncated ? " - truncated" : ""}`;

  // Build markdown table
  const headerRow = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const dataRows = displayRows.map((row) =>
    `| ${row.map((cell) => formatCell(cell)).join(" | ")} |`
  ).join("\n");

  let result = `${header}\n\n${headerRow}\n${separator}\n${dataRows}`;

  if (rows.length > maxRows) {
    result += `\n\n*... and ${rows.length - maxRows} more rows*`;
  }

  return result;
}

function formatCell(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 50);
}
