/**
 * AI Command / Capability Types
 *
 * Defines all structured action blocks that the assistant can emit.
 * Canonical transport format: fenced `qp-action` JSON blocks.
 */

// ============================================================================
// Base Types
// ============================================================================

export type AiCommandName =
  | "workspace.listTabs"
  | "workspace.getFocusedTab"
  | "workspace.getTabContext"
  | "tab.create"
  | "tab.focus"
  | "tab.updateContent"
  | "editor.insert"
  | "query.run"
  | "grid.setFilter"
  | "grid.setSort"
  | "grid.setView"
  | "crud.stage"
  | "crud.unstage";

export type CapabilityId = AiCommandName;

export type CommandApprovalLevel = "auto" | "approve" | "dangerous";

export interface ParamSchema {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
}

export interface AiCommandMeta {
  name: AiCommandName;
  paradigm: "sql" | "document" | "keyvalue" | "universal";
  approvalLevel: CommandApprovalLevel;
  description: string;
  params?: ParamSchema[];
}

/**
 * Executable assistant action block payload.
 */
export interface QpActionBlock {
  id: string;
  name: CapabilityId;
  params: Record<string, unknown>;
  approval: CommandApprovalLevel;
}

// ============================================================================
// Command Metadata
// ============================================================================

export const COMMAND_META: Record<AiCommandName, AiCommandMeta> = {
  "workspace.listTabs": {
    name: "workspace.listTabs",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "List open tabs in the workspace",
    params: [],
  },
  "workspace.getFocusedTab": {
    name: "workspace.getFocusedTab",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Get focused tab context",
    params: [],
  },
  "workspace.getTabContext": {
    name: "workspace.getTabContext",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Get context for a specific tab",
    params: [
      {
        name: "tabId",
        type: "string",
        required: true,
        description: "Target tab ID",
      },
    ],
  },
  "tab.create": {
    name: "tab.create",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Create a new query tab",
    params: [
      {
        name: "connectionId",
        type: "string",
        required: true,
        description: "Database connection ID",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Tab title",
      },
      {
        name: "content",
        type: "string",
        required: false,
        description: "Initial query text",
      },
      {
        name: "database",
        type: "string",
        required: false,
        description: "Database name",
      },
      {
        name: "schema",
        type: "string",
        required: false,
        description: "Schema name",
      },
    ],
  },
  "tab.focus": {
    name: "tab.focus",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Focus an existing tab",
    params: [
      {
        name: "tabId",
        type: "string",
        required: true,
        description: "Target tab ID",
      },
    ],
  },
  "tab.updateContent": {
    name: "tab.updateContent",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Update tab content/title",
    params: [
      {
        name: "tabId",
        type: "string",
        required: false,
        description: "Target tab ID (defaults to focused tab)",
      },
      {
        name: "content",
        type: "string",
        required: false,
        description: "New editor content",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Tab title",
      },
      {
        name: "mode",
        type: "string",
        required: false,
        description: "replace|append|prepend",
      },
    ],
  },
  "editor.insert": {
    name: "editor.insert",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Insert text into the active editor",
    params: [
      {
        name: "text",
        type: "string",
        required: true,
        description: "Text to insert",
      },
      {
        name: "position",
        type: "string",
        required: false,
        description: "cursor|end|replace",
      },
    ],
  },
  "query.run": {
    name: "query.run",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Execute a read-only query/operation and return data",
    params: [
      {
        name: "connectionId",
        type: "string",
        required: true,
        description: "Database connection ID",
      },
      {
        name: "query",
        type: "string",
        required: true,
        description: "Read query (SQL) or read operation payload (MongoDB/Redis)",
      },
      {
        name: "language",
        type: "string",
        required: false,
        description: "Optional query language hint: sql|mongo|redis",
      },
      {
        name: "title",
        type: "string",
        required: false,
        description: "Tab title",
      },
      {
        name: "database",
        type: "string",
        required: false,
        description: "Database name",
      },
      {
        name: "schema",
        type: "string",
        required: false,
        description: "Schema name",
      },
    ],
  },
  "grid.setFilter": {
    name: "grid.setFilter",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Set table/grid filter",
    params: [
      {
        name: "tabId",
        type: "string",
        required: false,
        description: "Target tab ID (defaults to focused tab)",
      },
      {
        name: "filter",
        type: "string",
        required: true,
        description: "Filter expression",
      },
    ],
  },
  "grid.setSort": {
    name: "grid.setSort",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Set table/grid sort",
    params: [
      {
        name: "tabId",
        type: "string",
        required: false,
        description: "Target tab ID (defaults to focused tab)",
      },
      {
        name: "column",
        type: "string",
        required: true,
        description: "Sort column",
      },
      {
        name: "direction",
        type: "string",
        required: true,
        description: "asc|desc",
      },
    ],
  },
  "grid.setView": {
    name: "grid.setView",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Set table tab view mode",
    params: [
      {
        name: "tabId",
        type: "string",
        required: false,
        description: "Target tab ID (defaults to focused tab)",
      },
      {
        name: "view",
        type: "string",
        required: true,
        description: "data|structure|indexes|triggers|aggregation|validation|explain",
      },
    ],
  },
  "crud.stage": {
    name: "crud.stage",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Stage a database mutation",
    params: [
      {
        name: "connectionId",
        type: "string",
        required: true,
        description: "Database connection ID",
      },
      {
        name: "operation",
        type: "string",
        required: true,
        description: "insert|update|delete",
      },
      {
        name: "database",
        type: "string",
        required: false,
        description: "Database name",
      },
      {
        name: "schema",
        type: "string",
        required: false,
        description: "Schema name (SQL)",
      },
      {
        name: "table",
        type: "string",
        required: false,
        description: "Table name (SQL)",
      },
      {
        name: "collection",
        type: "string",
        required: false,
        description: "Collection name (MongoDB)",
      },
      {
        name: "document",
        type: "object",
        required: false,
        description: "Insert document",
      },
      {
        name: "filter",
        type: "object",
        required: false,
        description: "Update/delete filter",
      },
      {
        name: "update",
        type: "object",
        required: false,
        description: "Update payload",
      },
      {
        name: "primaryKeys",
        type: "object",
        required: false,
        description: "Delete/update primary keys",
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Human-readable description",
      },
    ],
  },
  "crud.unstage": {
    name: "crud.unstage",
    paradigm: "universal",
    approvalLevel: "auto",
    description: "Unstage CRUD commands",
    params: [
      {
        name: "scope",
        type: "string",
        required: true,
        description: "id|table|all",
      },
      {
        name: "commandId",
        type: "string",
        required: false,
        description: "Command ID when scope=id",
      },
      {
        name: "table",
        type: "string",
        required: false,
        description: "Table name when scope=table",
      },
      {
        name: "connectionId",
        type: "string",
        required: false,
        description: "Optional connection filter",
      },
    ],
  },
};

// ============================================================================
// Command Parameter Types
// ============================================================================

export type WorkspaceListTabsParams = Record<string, never>;

export type WorkspaceGetFocusedTabParams = Record<string, never>;

export interface WorkspaceGetTabContextParams {
  tabId: string;
}

export interface CrudStageParams {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
  collection?: string;
  operation: "insert" | "update" | "delete";
  document?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  primaryKeys?: Record<string, unknown>;
  description?: string;
}

export interface TabUpdateContentParams {
  tabId?: string;
  content?: string;
  title?: string;
  mode?: "replace" | "append" | "prepend";
}

export interface TabCreateParams {
  connectionId: string;
  title?: string;
  content?: string;
  database?: string;
  schema?: string;
}

export interface EditorInsertParams {
  text: string;
  position?: "cursor" | "end" | "replace";
}

export interface TabFocusParams {
  tabId: string;
}

export interface CrudUnstageParams {
  scope: "id" | "table" | "all";
  commandId?: string;
  table?: string;
  connectionId?: string;
}

export interface QueryRunParams {
  connectionId: string;
  query: string;
  language?: "sql" | "mongo" | "redis";
  title?: string;
  database?: string;
  schema?: string;
  timeoutSecs?: number;
}

export interface GridSetFilterParams {
  tabId?: string;
  filter: string;
}

export interface GridSetSortParams {
  tabId?: string;
  column: string;
  direction: "asc" | "desc";
}

export interface GridSetViewParams {
  tabId?: string;
  view: string;
}

export interface CapabilityParamsMap {
  "workspace.listTabs": WorkspaceListTabsParams;
  "workspace.getFocusedTab": WorkspaceGetFocusedTabParams;
  "workspace.getTabContext": WorkspaceGetTabContextParams;
  "tab.create": TabCreateParams;
  "tab.focus": TabFocusParams;
  "tab.updateContent": TabUpdateContentParams;
  "editor.insert": EditorInsertParams;
  "query.run": QueryRunParams;
  "grid.setFilter": GridSetFilterParams;
  "grid.setSort": GridSetSortParams;
  "grid.setView": GridSetViewParams;
  "crud.stage": CrudStageParams;
  "crud.unstage": CrudUnstageParams;
}

// ============================================================================
// Result Types
// ============================================================================

export interface WorkspaceTabSummary {
  tabId: string;
  panelId: string;
  type: string;
  title?: string;
  connectionId?: string;
  database?: string;
  schema?: string;
}

export interface WorkspaceTabContextResult {
  tab: WorkspaceTabSummary | null;
  sql?: string;
  filter?: string;
  sort?: { column: string; direction: "asc" | "desc" };
  viewType?: string;
}

export interface CrudStageResult {
  staged: boolean;
  commandId: string;
  tableKey: string;
}

export interface TabUpdateResult {
  success: boolean;
  tabId: string;
}

export interface TabCreateResult {
  success: boolean;
  tabId: string;
}

export interface EditorInsertResult {
  success: boolean;
}

export interface TabFocusResult {
  success: boolean;
  tabId: string;
  panelId: string;
}

export interface CrudUnstageResult {
  unstaged: boolean;
  count: number;
}

export interface QueryRunResult {
  success: boolean;
  mode: "sql" | "document" | "keyvalue";
  connectionId: string;
  query: string;
  title?: string;
  rowCount: number;
  columns?: string[];
  rows?: unknown[][];
  records?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
}

export interface GridMutationResult {
  success: boolean;
  tabId: string;
}

export interface CapabilityResultMap {
  "workspace.listTabs": { tabs: WorkspaceTabSummary[] };
  "workspace.getFocusedTab": WorkspaceTabContextResult;
  "workspace.getTabContext": WorkspaceTabContextResult;
  "tab.create": TabCreateResult;
  "tab.focus": TabFocusResult;
  "tab.updateContent": TabUpdateResult;
  "editor.insert": EditorInsertResult;
  "query.run": QueryRunResult;
  "grid.setFilter": GridMutationResult;
  "grid.setSort": GridMutationResult;
  "grid.setView": GridMutationResult;
  "crud.stage": CrudStageResult;
  "crud.unstage": CrudUnstageResult;
}

// ============================================================================
// Parsed Command Type
// ============================================================================

export interface ParsedCommand<T = unknown> {
  id: string;
  name: AiCommandName;
  params: T;
  approval?: CommandApprovalLevel;
  raw: string;
  startIndex: number;
  endIndex: number;
  confidence?: "high" | "low";
  error?: string;
}

export type AnyParsedCommand =
  | ParsedCommand<WorkspaceListTabsParams>
  | ParsedCommand<WorkspaceGetFocusedTabParams>
  | ParsedCommand<WorkspaceGetTabContextParams>
  | ParsedCommand<CrudStageParams>
  | ParsedCommand<CrudUnstageParams>
  | ParsedCommand<QueryRunParams>
  | ParsedCommand<TabUpdateContentParams>
  | ParsedCommand<TabCreateParams>
  | ParsedCommand<TabFocusParams>
  | ParsedCommand<EditorInsertParams>
  | ParsedCommand<GridSetFilterParams>
  | ParsedCommand<GridSetSortParams>
  | ParsedCommand<GridSetViewParams>;
