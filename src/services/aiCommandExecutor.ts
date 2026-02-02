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
import { useConnectionStore } from "@/stores/connectionStoreNew";
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

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

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

// Unique symbol to identify timeout errors
const TIMEOUT_ERROR_MARKER = Symbol("timeout");

interface TimeoutError extends Error {
  [TIMEOUT_ERROR_MARKER]: true;
}

function isTimeoutError(err: unknown): err is TimeoutError {
  return err !== null && typeof err === "object" && TIMEOUT_ERROR_MARKER in err;
}

/**
 * Execute a command with a timeout.
 * @param command - The parsed command to execute
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 */
export async function executeCommandWithTimeout(
  command: ParsedCommand,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  const startTime = performance.now();

  // Use object wrapper to safely track timeoutId across promise boundary
  const timer: { id: ReturnType<typeof setTimeout> | null } = { id: null };

  const timeoutPromise = new Promise<CommandResult>((_, reject) => {
    timer.id = setTimeout(() => {
      const err = new Error(`Command timed out after ${timeoutMs}ms`) as TimeoutError;
      err[TIMEOUT_ERROR_MARKER] = true;
      reject(err);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      executeCommand(command),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startTime);
    if (isTimeoutError(error)) {
      return {
        success: false,
        error: `Timeout: ${command.name} exceeded ${timeoutMs}ms (ran for ${elapsed}ms)`,
      };
    }
    // Non-timeout errors
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Always clear the timeout to prevent memory leaks
    if (timer.id !== null) {
      clearTimeout(timer.id);
    }
  }
}

/**
 * Execute multiple commands in parallel with individual timeouts.
 * @param commands - Array of parsed commands to execute
 * @param timeoutMs - Timeout per command in milliseconds (default: 30s)
 */
export async function executeCommandsInParallel(
  commands: ParsedCommand[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
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
    })
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

/**
 * Format batched results for sending back to the AI agent.
 * Returns a structured summary suitable for conversation injection.
 */
export function formatBatchedResultsForAgent(
  batchResult: BatchExecutionResult
): string {
  const lines: string[] = [];

  lines.push(
    `## Batch Execution Complete (${batchResult.totalTimeMs}ms total)`
  );
  lines.push(
    `**${batchResult.successCount}** succeeded, **${batchResult.failureCount}** failed\n`
  );

  for (const item of batchResult.results) {
    const statusIcon = item.result.success ? "✓" : "✗";
    lines.push(`### ${statusIcon} ${item.commandName} (${item.executionTimeMs}ms)`);

    if (item.result.success) {
      // Format the successful result data concisely
      const data = item.result.data as Record<string, unknown>;
      // For SQL results, show row count
      if ("rowCount" in data) {
        lines.push(`Returned ${data.rowCount} rows`);
      }
      // For MongoDB results
      else if ("count" in data && "documents" in data) {
        lines.push(`Found ${data.count} documents`);
      }
      // For other results, show JSON summary
      else {
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
// SQL Executors
// ============================================================================

/**
 * Strip SQL comments and normalize whitespace for validation.
 * Handles -- comments, /* * / block comments, and leading whitespace.
 */
function normalizeSqlForValidation(sql: string): string {
  let normalized = sql;

  // Remove single-line comments (-- to end of line)
  normalized = normalized.replace(/--[^\n]*/g, "");

  // Remove multi-line block comments (/* ... */)
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, "");

  // Normalize whitespace and trim
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Check if SQL contains mutation keywords that could modify data.
 * This is a defense-in-depth check - the backend should also validate.
 */
function containsMutationKeywords(sql: string): boolean {
  const normalized = normalizeSqlForValidation(sql).toUpperCase();

  // Keywords that indicate mutation operations
  const mutationKeywords = [
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE",
    "GRANT", "REVOKE", "EXEC", "EXECUTE", "CALL", "MERGE", "UPSERT",
    "REPLACE", "LOCK", "UNLOCK"
  ];

  // Check if any mutation keyword appears as a standalone word
  for (const keyword of mutationKeywords) {
    // Match keyword as whole word (not part of identifier)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(normalized)) {
      return true;
    }
  }

  return false;
}

async function executeSqlQuery(params: SqlExecuteParams): Promise<CommandResult> {
  const { connectionId, sql, limit = 100 } = params;

  // Normalize SQL by stripping comments and excess whitespace
  const normalizedSql = normalizeSqlForValidation(sql);
  const sqlUpper = normalizedSql.toUpperCase();

  // Check if it starts with a read-only statement
  const isReadOnly =
    sqlUpper.startsWith("SELECT") ||
    sqlUpper.startsWith("WITH") ||
    sqlUpper.startsWith("SHOW") ||
    sqlUpper.startsWith("DESCRIBE") ||
    sqlUpper.startsWith("EXPLAIN") ||
    sqlUpper.startsWith("TABLE"); // PostgreSQL TABLE command is read-only

  if (!isReadOnly) {
    return { success: false, error: "Only SELECT queries are allowed. Use crud.stage for mutations." };
  }

  // Defense-in-depth: Check for mutation keywords even in CTEs
  // WITH ... AS (UPDATE ...) is dangerous
  if (containsMutationKeywords(normalizedSql)) {
    return {
      success: false,
      error: "Query contains mutation keywords (INSERT, UPDATE, DELETE, etc.). Use crud.stage for mutations."
    };
  }

  // Add LIMIT if not present
  const limitedSql = sqlUpper.includes("LIMIT")
    ? sql
    : `${sql.trim().replace(/;$/, "")} LIMIT ${Math.min(limit, 1000)}`;

  const startTime = performance.now();

  try {
    // Use the simpler 'query' command instead of streaming 'execute_query'
    const result = await invoke<{ columns: Array<{ name: string }>; rows: unknown[][] }>(
      "query",
      { conn_id: connectionId, sql: limitedSql, timeout_secs: null }
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
    // Use the simpler 'query' command instead of streaming 'execute_query'
    const result = await invoke<{ columns: Array<{ name: string }>; rows: unknown[][] }>(
      "query",
      { conn_id: connectionId, sql: explainSql, timeout_secs: null }
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
    // Call MongoDB find via backend - note: uses conn_id not connectionId
    const documents = await invoke<Record<string, unknown>[]>("mongo_find_documents", {
      conn_id: connectionId,
      collection,
      filter, // serde_json::Value, not stringified
      projection: projection ?? null,
      sort: sort ?? null,
      skip: null,
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
    // Call MongoDB aggregate via backend - note: uses conn_id not connectionId
    const results = await invoke<Record<string, unknown>[]>("mongo_aggregate", {
      conn_id: connectionId,
      collection,
      pipeline, // Vec<serde_json::Value>, not stringified
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
    // Call MongoDB count via backend - note: uses conn_id not connectionId
    // filter is Option<serde_json::Value>, pass null for empty filter
    const filterValue = Object.keys(filter).length > 0 ? filter : null;
    const count = await invoke<number>("mongo_count_documents", {
      conn_id: connectionId,
      collection,
      filter: filterValue,
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
    // Backend uses conn_id, not connectionId
    const [typeResult, valueResult, ttlResult] = await Promise.all([
      invoke<string>("redis_type", { conn_id: connectionId, key }),
      invoke<unknown>("redis_get", { conn_id: connectionId, key }),
      invoke<number>("redis_ttl", { conn_id: connectionId, key }),
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
    // Use keyvalue_execute with Scan operation - redis_keys doesn't exist
    // We'll collect keys from scan until we hit the limit
    const keys: string[] = [];
    let cursor = 0;
    const scanLimit = Math.min(limit, 1000);

    do {
      const result = await invoke<{ type: string; data: { keys: string[]; cursor: number } }>(
        "keyvalue_execute",
        {
          conn_id: connectionId,
          operation: { type: "scan", pattern, cursor, count: 100 },
        }
      );

      if (result.type === "scan") {
        keys.push(...result.data.keys);
        cursor = result.data.cursor;
      } else {
        break;
      }
    } while (cursor !== 0 && keys.length < scanLimit);

    // Trim to limit
    const limitedKeys = keys.slice(0, scanLimit);

    const data: RedisKeysResult = {
      keys: limitedKeys,
      count: limitedKeys.length,
      truncated: keys.length >= scanLimit,
    };

    return { success: true, data };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function executeRedisScan(params: RedisScanParams): Promise<CommandResult> {
  const { connectionId, pattern = "*", count = 100, cursor = "0" } = params;

  try {
    // Use keyvalue_execute with Scan operation
    const result = await invoke<{ type: string; data: { keys: string[]; cursor: number } }>(
      "keyvalue_execute",
      {
        conn_id: connectionId,
        operation: { type: "scan", pattern, cursor: parseInt(cursor, 10), count },
      }
    );

    if (result.type !== "scan") {
      return { success: false, error: "Unexpected response from scan operation" };
    }

    const data: RedisScanResult = {
      keys: result.data.keys,
      cursor: String(result.data.cursor),
      done: result.data.cursor === 0,
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

  // Validate required fields
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
      // Validate insert has document with content
      if (!document || (typeof document === "object" && Object.keys(document).length === 0)) {
        return { success: false, error: "Insert operation requires a non-empty document" };
      }
      type = "data.insert";
      payload = { values: document };
      break;
    case "update":
      // Validate update has identifier and update data
      if (!primaryKeys && !filter) {
        return { success: false, error: "Update operation requires primaryKeys or filter to identify rows" };
      }
      if (!update || (typeof update === "object" && Object.keys(update).length === 0)) {
        return { success: false, error: "Update operation requires update data" };
      }
      type = "data.update";
      payload = { primaryKeys: primaryKeys ?? filter, ...update };
      break;
    case "delete":
      // Validate delete has identifier
      if (!primaryKeys && !filter) {
        return { success: false, error: "Delete operation requires primaryKeys or filter to identify rows" };
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

  // Validate connectionId exists if provided
  if (connectionId) {
    const connections = useConnectionStore.getState().connections;
    const connectionExists = connections.some((conn) => conn.profile.id === connectionId);
    if (!connectionExists) {
      return { success: false, error: `Connection not found: ${connectionId}` };
    }
  }

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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Map.get can return undefined at runtime
      const sql = tab?.payload?.sql;
      if (typeof sql === "string") {
        const currentSql = sql;
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

  const data = result.data;

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
  if (typeof value === "string") return value.slice(0, 50);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).slice(0, 50);
  }
  // symbol, function, or other - use JSON for safety
  return JSON.stringify(value);
}
