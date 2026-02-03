/**
 * AI Command Executor
 *
 * Executes approved AI mutation and UI commands.
 *
 * Note: Read commands (sql.execute, mongodb.find, redis.get, etc.) have been removed.
 * The AI agent now accesses database data through MCP tools instead.
 */

import { nanoid } from "nanoid";
import { useCrudStore } from "@/stores/crudStore";
import { useWorkspaceScreenStore } from "@/stores/workspaceScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type {
  ParsedCommand,
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
 *
 * Note: Only mutation and UI commands are supported.
 * Read commands have been removed - AI uses MCP tools for database reads.
 */
export async function executeCommand(command: ParsedCommand): Promise<CommandResult> {
  try {
    switch (command.name) {
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
// CRUD Executor
// ============================================================================
// Note: SQL, MongoDB, and Redis read executors have been removed.
// The AI agent now uses MCP tools for database reads.

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
 *
 * Note: Read command formatters have been removed - AI uses MCP tools for reads.
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
