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
  CrudUnstageParams,
  CrudUnstageResult,
  TabUpdateParams,
  TabUpdateResult,
  TabCreateParams,
  TabCreateResult,
  TabFocusParams,
  TabFocusResult,
  EditorInsertParams,
  EditorInsertResult,
  QueryRunParams,
  QueryRunResult,
} from "@/types/aiCommands";
import { tableStreamingService } from "@/services/tableStreamingService";

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
      case "crud.unstage":
        return executeCrudUnstage(command.params as CrudUnstageParams);
      case "tab.update":
        return executeTabUpdate(command.params as TabUpdateParams);
      case "tab.create":
        return executeTabCreate(command.params as TabCreateParams);
      case "tab.focus":
        return executeTabFocus(command.params as TabFocusParams);
      case "editor.insert":
        return executeEditorInsert(command.params as EditorInsertParams);
      case "query.run":
        return await executeQueryRun(command.params as QueryRunParams);
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

function executeCrudUnstage(params: CrudUnstageParams): CommandResult {
  const { scope, commandId, table, connectionId } = params;

  const store = useCrudStore.getState();
  let unstagedCount = 0;

  switch (scope) {
    case "id": {
      // Unstage a single command by ID
      if (!commandId) {
        return { success: false, error: "Missing required parameter: commandId (required when scope = id)" };
      }

      // Check if the command exists in the index
      const tableKey = store.commandIndex.get(commandId);
      if (!tableKey) {
        return { success: false, error: `Command not found: ${commandId}` };
      }

      store.unstageCommand(commandId);
      unstagedCount = 1;
      break;
    }

    case "table": {
      // Unstage all commands for a specific table
      if (!table) {
        return { success: false, error: "Missing required parameter: table (required when scope = table)" };
      }

      // Find matching table keys
      // Table keys have format: connectionId:database:schema:table
      const matchingTableKeys: string[] = [];

      for (const [tableKey] of store.stagedCommands) {
        const parts = tableKey.split(":");
        const keyTable = parts[3]; // table is the 4th part
        const keyConnectionId = parts[0]; // connectionId is the 1st part

        // Match table name, and optionally filter by connectionId
        if (keyTable === table) {
          if (connectionId) {
            if (keyConnectionId === connectionId) {
              matchingTableKeys.push(tableKey);
            }
          } else {
            matchingTableKeys.push(tableKey);
          }
        }
      }

      if (matchingTableKeys.length === 0) {
        return { success: false, error: `No staged changes found for table: ${table}` };
      }

      // Discard all matching tables
      for (const tableKey of matchingTableKeys) {
        const commands = store.stagedCommands.get(tableKey) ?? [];
        unstagedCount += commands.length;
        store.discardChanges(tableKey);
      }
      break;
    }

    case "all": {
      // Unstage all commands, optionally filtered by connectionId
      if (connectionId) {
        // Filter by connectionId - find all table keys for this connection
        const matchingTableKeys: string[] = [];

        for (const [tableKey] of store.stagedCommands) {
          const parts = tableKey.split(":");
          const keyConnectionId = parts[0];

          if (keyConnectionId === connectionId) {
            matchingTableKeys.push(tableKey);
          }
        }

        if (matchingTableKeys.length === 0) {
          return { success: false, error: `No staged changes found for connection: ${connectionId}` };
        }

        for (const tableKey of matchingTableKeys) {
          const commands = store.stagedCommands.get(tableKey) ?? [];
          unstagedCount += commands.length;
          store.discardChanges(tableKey);
        }
      } else {
        // Discard all staged changes
        for (const [, commands] of store.stagedCommands) {
          unstagedCount += commands.length;
        }
        store.discardAll();
      }
      break;
    }

    default:
      return { success: false, error: `Unknown scope: ${scope}. Valid values are: id, table, all` };
  }

  const data: CrudUnstageResult = {
    unstaged: true,
    count: unstagedCount,
  };

  return { success: true, data };
}

// ============================================================================
// Tab Executors
// ============================================================================

function executeTabUpdate(params: TabUpdateParams): CommandResult {
  const { tabId, content, title, mode = "replace" } = params;
  const store = useWorkspaceScreenStore.getState();

  // Ensure there's an active connection
  const activeConnectionId = store.activeConnectionId;
  if (!activeConnectionId) {
    return { success: false, error: "No active connection. Cannot update tab without an active workspace." };
  }

  // Ensure workspace is initialized
  const workspace = store.workspaces.get(activeConnectionId);
  if (!workspace) {
    return { success: false, error: "Workspace not initialized for this connection." };
  }

  // Find the tab
  const panels = workspace.panels;
  let targetPanelId: string | null = null;
  let targetTabId = tabId;
  let existingTab = null;

  for (const [panelId, panel] of panels) {
    if (tabId && panel.tabs.has(tabId)) {
      targetPanelId = panelId;
      existingTab = panel.tabs.get(tabId);
      break;
    } else if (!tabId && panel.activeTabId) {
      targetPanelId = panelId;
      targetTabId = panel.activeTabId;
      existingTab = panel.tabs.get(panel.activeTabId);
      break;
    }
  }

  if (!targetPanelId || !targetTabId || !existingTab) {
    return { success: false, error: "Tab not found" };
  }

  const updates: Record<string, unknown> = {};
  if (title) updates.title = title;

  if (content !== undefined) {
    // Get existing SQL content for append/prepend modes
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- payload can be undefined at runtime
    const existingSql = typeof existingTab.payload?.sql === "string" ? existingTab.payload.sql : "";

    let newSql: string;
    switch (mode) {
      case "append":
        newSql = existingSql + (existingSql ? "\n" : "") + content;
        break;
      case "prepend":
        newSql = content + (existingSql ? "\n" : "") + existingSql;
        break;
      case "replace":
      default:
        newSql = content;
        break;
    }

    // Preserve existing payload properties and update sql
    updates.payload = { ...existingTab.payload, sql: newSql };
  }

  store.updateTab(targetPanelId, targetTabId, updates);

  const data: TabUpdateResult = {
    success: true,
    tabId: targetTabId,
  };

  return { success: true, data };
}

function executeTabCreate(params: TabCreateParams): CommandResult {
  console.log("[executeTabCreate] Called with params:", params);
  const { connectionId, type, title, content } = params;

  // Validate connectionId is provided (required for tab creation)
  if (!connectionId) {
    return { success: false, error: "Missing required parameter: connectionId" };
  }

  // Validate connectionId exists in the connection store
  const connections = useConnectionStore.getState().connections;
  console.log("[executeTabCreate] Checking connection exists:", connectionId, "Available:", connections.map(c => c.profile.id));
  const connectionExists = connections.some((conn) => conn.profile.id === connectionId);
  if (!connectionExists) {
    console.log("[executeTabCreate] Connection not found!");
    return { success: false, error: `Connection not found: ${connectionId}` };
  }

  const store = useWorkspaceScreenStore.getState();

  // The workspace store is connection-scoped. We need to ensure the connection's
  // workspace is active. If the provided connectionId differs from activeConnectionId,
  // we need to either switch or use the provided connection's workspace.
  let activeConnectionId = store.activeConnectionId;

  // If no active connection or different connection, set it to the provided connectionId
  if (!activeConnectionId || activeConnectionId !== connectionId) {
    console.log("[executeTabCreate] Setting active connection to:", connectionId);
    store.setActiveConnection(connectionId);
    activeConnectionId = connectionId;
  }

  // Ensure workspace is initialized (setActiveConnection should do this, but double-check)
  if (!store.workspaces.has(activeConnectionId)) {
    console.log("[executeTabCreate] Initializing workspace for:", activeConnectionId);
    store.initWorkspace(activeConnectionId);
  }

  // Now get the panel ID from the (possibly newly initialized) workspace
  const panelId = store.getActivePanelId();
  console.log("[executeTabCreate] Adding tab to panel:", panelId);

  if (!panelId) {
    return { success: false, error: "No panel found in workspace. This should not happen." };
  }

  const tabId = store.addTab(panelId, {
    type,
    connectionId,
    title: title ?? "New Query",
    payload: { sql: content ?? "" },
  });
  console.log("[executeTabCreate] Tab created:", tabId);

  if (!tabId) {
    return { success: false, error: "Failed to create tab. addTab returned empty." };
  }

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

function executeTabFocus(params: TabFocusParams): CommandResult {
  const { tabId } = params;

  if (!tabId) {
    return { success: false, error: "Missing required parameter: tabId" };
  }

  const store = useWorkspaceScreenStore.getState();

  // Ensure there's an active connection
  const activeConnectionId = store.activeConnectionId;
  if (!activeConnectionId) {
    return { success: false, error: "No active connection. Cannot focus tab without an active workspace." };
  }

  // Ensure workspace is initialized
  const workspace = store.workspaces.get(activeConnectionId);
  if (!workspace) {
    return { success: false, error: "Workspace not initialized for this connection." };
  }

  // Find the panel containing the tab
  const panels = workspace.panels;
  let targetPanelId: string | null = null;

  for (const [panelId, panel] of panels) {
    if (panel.tabs.has(tabId)) {
      targetPanelId = panelId;
      break;
    }
  }

  if (!targetPanelId) {
    return { success: false, error: `Tab not found: ${tabId}` };
  }

  // Set the tab as active within its panel
  store.setActiveTab(targetPanelId, tabId);

  // Also set the panel as the active panel
  store.setActivePanel(targetPanelId);

  const data: TabFocusResult = {
    success: true,
    tabId,
    panelId: targetPanelId,
  };

  return { success: true, data };
}

// ============================================================================
// Query Executors
// ============================================================================

/**
 * Execute a query and display results in a new tab.
 *
 * This creates a new query tab, sets the query content, and auto-executes it.
 * The execution happens via the tableStreamingService for real-time results.
 */
async function executeQueryRun(params: QueryRunParams): Promise<CommandResult> {
  console.log("[executeQueryRun] Starting with params:", params);
  const { connectionId, query, title, database: _database, schema: _schema } = params;

  // Validate required parameters
  if (!connectionId) {
    console.log("[executeQueryRun] Missing connectionId");
    return { success: false, error: "Missing required parameter: connectionId" };
  }

  if (!query) {
    console.log("[executeQueryRun] Missing query");
    return { success: false, error: "Missing required parameter: query" };
  }

  // Validate connectionId exists
  const connections = useConnectionStore.getState().connections;
  console.log("[executeQueryRun] Available connections:", connections.map(c => c.profile.id));
  const connectionExists = connections.some((conn) => conn.profile.id === connectionId);
  if (!connectionExists) {
    console.log("[executeQueryRun] Connection not found:", connectionId);
    return { success: false, error: `Connection not found: ${connectionId}` };
  }

  const store = useWorkspaceScreenStore.getState();

  // Ensure the connection's workspace is active
  let activeConnectionId = store.activeConnectionId;
  if (!activeConnectionId || activeConnectionId !== connectionId) {
    store.setActiveConnection(connectionId);
    activeConnectionId = connectionId;
  }

  // Ensure workspace is initialized
  if (!store.workspaces.has(activeConnectionId)) {
    store.initWorkspace(activeConnectionId);
  }

  // Get the panel ID
  const panelId = store.getActivePanelId();
  if (!panelId) {
    return { success: false, error: "No panel found in workspace." };
  }

  // Generate tab title from query if not provided (first 30 chars)
  const tabTitle = title ?? query.trim().slice(0, 30) + (query.trim().length > 30 ? "..." : "");

  // Create the tab with the query content
  console.log("[executeQueryRun] Creating tab in panel:", panelId);
  const tabId = store.addTab(panelId, {
    type: "query",
    connectionId,
    title: tabTitle,
    payload: { sql: query },
  });

  console.log("[executeQueryRun] Tab created:", tabId);
  if (!tabId) {
    console.log("[executeQueryRun] Failed to create tab");
    return { success: false, error: "Failed to create tab for query execution." };
  }

  // Now execute the query using tableStreamingService
  // Clean up the SQL - remove trailing semicolons
  const cleanedQuery = query.trim().replace(/;\s*$/, "");

  try {
    // Execute the query via streaming service
    const result = await tableStreamingService.streamQuery(
      connectionId,
      tabId,
      cleanedQuery,
      2500, // pageSize - same as QueryPanel uses
      () => {
        // Progress callback - we don't need to do anything here
        // The QueryPanel component will pick up the state from tabStateStore
      },
      (error) => {
        // Error callback
        console.error("[executeQueryRun] Query execution error:", error);
      }
    );

    const data: QueryRunResult = {
      success: true,
      tabId,
      rowCount: result.totalRows ?? result.rows.length,
    };

    return { success: true, data };
  } catch (error) {
    // Even if execution fails, the tab was created - return partial success
    const errorMessage = error instanceof Error ? error.message : String(error);
    const data: QueryRunResult = {
      success: false,
      tabId,
      rowCount: 0,
    };

    // Return success with error info in the data
    // The tab exists and shows the error in the results panel
    return {
      success: true,
      data: {
        ...data,
        error: errorMessage,
      },
    };
  }
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
    case "crud.unstage": {
      const unstageResult = data as CrudUnstageResult;
      return `**Changes unstaged** (${unstageResult.count} command${unstageResult.count === 1 ? "" : "s"} removed)`;
    }
    case "tab.update":
    case "tab.create":
    case "tab.focus":
    case "editor.insert":
      return `**Done**`;
    case "query.run": {
      const queryResult = data as QueryRunResult;
      if (queryResult.success) {
        return `**Query executed** (Tab: ${queryResult.tabId})\nReturned ${queryResult.rowCount ?? 0} rows.`;
      } else {
        return `**Query tab created** (Tab: ${queryResult.tabId})\nExecution error: ${(data as QueryRunResult & { error?: string }).error ?? "Unknown error"}`;
      }
    }
    default:
      return `**Result:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  }
}
