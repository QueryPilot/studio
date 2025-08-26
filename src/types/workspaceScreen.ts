/**
 * Enhanced types for workspace screen with panel hierarchy
 */

export type TabType = "table" | "query" | "schema" | "function" | "result" | "erd";

export interface TabPayload {
  // Common
  database?: string;
  
  // For query tabs
  sql?: string;
  cursorId?: string;
  
  // For table tabs
  schema?: string;
  tableName?: string;
  isView?: boolean;
  activeView?: "data" | "structure" | "indexes" | "triggers";
  filters?: Array<{
    column: string;
    operator: string;
    value: any;
  }>;
  sort?: {
    column: string;
    direction: "asc" | "desc";
  };
  
  // For result tabs
  resultId?: string;
  parentQueryId?: string;
  
  // For schema tabs
  selectedSchema?: string;
  
  // For function/procedure tabs
  functionName?: string;
  objectName?: string;
  objectType?: "function" | "procedure";
}

export interface TabUIState {
  scrollTop: number;
  scrollLeft: number;
  columnWidths: Record<string, number>;
  selectedRows: Set<string>;
  expandedRows: Set<string>;
  hiddenColumns: Set<string>;
  columnOrder: string[];
}

export interface TabState {
  id: string;
  type: TabType;
  connectionId: string;
  panelId: string; // Which panel owns this tab
  title: string;
  icon?: string;
  payload: TabPayload;
  ui: TabUIState;
  isDirty: boolean;
  isLoading: boolean;
  error?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface PanelState {
  id: string;
  type: "primary" | "secondary";
  tabs: Map<string, TabState>;
  tabOrder: string[];
  activeTabId: string | null;
  width?: number; // For vertical split
  height?: number; // For horizontal split
}

export interface WorkspaceScreenState {
  activeWorkspaceId: string;
  windows: Map<string, string>; // connectionId -> windowLabel
  
  // Panel management
  panels: Map<string, PanelState>;
  activePanelId: string;
  splitMode: "none" | "horizontal" | "vertical";
  splitPosition: number; // 0-1 percentage
  
  // UI state
  sidebars: {
    left: boolean;
    right: boolean;
  };
}

export interface SchemaInfo {
  name: string;
  owner?: string;
  description?: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  type: "table" | "view" | "materialized_view";
  rowCount?: number;
  size?: number;
  description?: string;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  returnType: string;
  arguments: string[];
  language?: string;
  description?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  description?: string;
}