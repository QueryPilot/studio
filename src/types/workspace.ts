/**
 * TypeScript types for workspace and tab management
 */

import type { ConnectionProfile } from "@/types/connection";

// ============================================================================
// Named Multi-Root Workspace Types (NEW)
// ============================================================================

/**
 * Workspace configuration - persistable to vault or .qpworkspace files.
 * A workspace bundles multiple connections with their state and tab layout.
 */
export interface WorkspaceConfig {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name, e.g., "Production Stack", "Local Dev" */
  name: string;
  /** Optional emoji or icon name */
  icon?: string;
  /** Optional tags for organization */
  tags?: string[];
  /** Whether this workspace was auto-created (e.g., from a single connection open) */
  autoCreated?: boolean;

  /** Ordered list of connection profile IDs (supports drag-reorder) */
  connectionIds: string[];

  /** Per-connection saved state (database/schema selection) */
  connectionStates: Record<
    string,
    {
      database: string;
      schema: string;
    }
  >;

  /** Metadata */
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

/**
 * Runtime connection state - in-memory only, tracks live connection status.
 */
export interface OpenConnection {
  /** Same as profile.id */
  id: string;
  /** Full connection profile */
  profile: ConnectionProfile;
  /** Current connection status */
  status: "connecting" | "connected" | "error" | "disconnected";
  /** Currently selected database */
  database: string;
  /** Currently selected schema */
  schema: string;
  /** Error message if status is "error" */
  error?: string;
  /** Trino: which catalogs are currently visible in the sidebar (undefined = all visible) */
  trinoCatalogFilter?: string[];
}

/**
 * Active workspace runtime state - represents a currently open workspace.
 */
export interface ActiveWorkspace {
  /** The persisted workspace configuration */
  config: WorkspaceConfig;
  /** Map of connectionId -> OpenConnection runtime state */
  connections: Map<string, OpenConnection>;
  /** ID of the connection currently focused in sidebar */
  focusedConnectionId: string | null;
}

// ============================================================================
// Legacy Workspace Types (existing)
// ============================================================================

export interface ColumnFilter {
  column: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "starts_with"
    | "ends_with"
    | "greater_than"
    | "less_than"
    | "is_null"
    | "is_not_null";
  value: string | number | boolean | null;
}

export interface SortConfig {
  column: string;
  direction: "asc" | "desc";
}

export type TabType = "query" | "table" | "schema" | "result";

export interface TabState {
  id: string;
  type: TabType;
  connectionId: string; // REQUIRED: Each tab must have a connection
  title: string;
  icon?: string;

  // Tab-specific data
  payload: {
    // For query tabs
    sql?: string;
    cursorId?: string;

    // For table tabs
    schema?: string;
    tableName?: string;
    filters?: ColumnFilter[];
    sort?: SortConfig;
    initialViewMode?: "data" | "structure" | "indexes" | "triggers";

    // For result tabs
    resultId?: string;
    parentQueryId?: string;

    // For schema tabs
    selectedSchema?: string;

    // Additional flexible properties
    title?: string;
    tableType?: "table" | "view";
    objectName?: string;
    objectType?:
      | "function"
      | "procedure"
      | "package"
      | "package_body"
      | "sequence"
      | "synonym";
  };

  // UI state
  ui: {
    scrollTop: number;
    scrollLeft: number;
    columnWidths: Record<string, number>;
    selectedRows: Set<string>;
    expandedRows: Set<string>;
    hiddenColumns: Set<string>;
    columnOrder: string[];
  };

  // Metadata
  isDirty: boolean;
  isLoading: boolean;
  error?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface WorkspaceSettings {
  defaultPageSize: number;
  autoSave: boolean;
  confirmOnClose: boolean;
  theme: "light" | "dark" | "system";
  maxTabsOpen: number;
}

export interface WorkspaceState {
  id: string;
  name: string;
  path: string;

  // Connections in this workspace
  connectionIds: string[];
  activeConnectionId: string | null;

  // Tabs in this workspace
  tabs: Map<string, TabState>;
  tabOrder: string[]; // For maintaining tab order
  activeTabId: string | null;

  // Workspace settings
  settings: WorkspaceSettings;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastOpened: Date;
}

export interface WorkspaceStore {
  // State
  workspaces: Map<string, WorkspaceState>;
  activeWorkspaceId: string | null;
  lastActiveTabByConnection: Map<string, Map<string, string>>; // workspaceId -> connectionId -> tabId

  // Workspace actions
  addWorkspace: (
    workspace: Omit<
      WorkspaceState,
      "id" | "createdAt" | "updatedAt" | "tabs" | "tabOrder"
    >,
  ) => string;
  removeWorkspace: (id: string) => void;
  updateWorkspace: (id: string, updates: Partial<WorkspaceState>) => void;
  setActiveWorkspace: (id: string | null) => void;

  // Connection actions
  addConnectionToWorkspace: (workspaceId: string, connectionId: string) => void;
  removeConnectionFromWorkspace: (
    workspaceId: string,
    connectionId: string,
  ) => void;
  setActiveConnection: (workspaceId: string, connectionId: string) => void;

  // Tab actions
  addTab: (workspaceId: string, tab: Partial<TabState>) => string;
  updateTab: (
    workspaceId: string,
    tabId: string,
    updates: Partial<TabState>,
  ) => void;
  closeTab: (workspaceId: string, tabId: string) => void;
  setActiveTab: (workspaceId: string, tabId: string | null) => void;
  reorderTabs: (workspaceId: string, newOrder: string[]) => void;
  duplicateTab: (workspaceId: string, tabId: string) => string;
  closeOtherTabs: (workspaceId: string, tabId: string) => void;
  closeTabsToRight: (workspaceId: string, tabId: string) => void;

  // Tab state actions
  updateTabUI: (
    workspaceId: string,
    tabId: string,
    ui: Partial<TabState["ui"]>,
  ) => void;
  setTabDirty: (workspaceId: string, tabId: string, isDirty: boolean) => void;
  setTabLoading: (
    workspaceId: string,
    tabId: string,
    isLoading: boolean,
  ) => void;
  setTabError: (workspaceId: string, tabId: string, error?: string) => void;

  // Tab content actions
  updateTabPayload: (
    workspaceId: string,
    tabId: string,
    payload: Partial<TabState["payload"]>,
  ) => void;

  // Getters
  getActiveWorkspace: () => WorkspaceState | null;
  getWorkspace: (workspaceId: string) => WorkspaceState | null;
  getActiveTab: () => TabState | null;
  getTabsByConnection: (connectionId: string) => TabState[];
  getWorkspaceByConnectionId: (
    connectionId: string,
  ) => WorkspaceState | undefined;
  getDirtyTabs: (workspaceId: string) => TabState[];

  // Aliases for compatibility
  removeTab: (workspaceId: string, tabId: string) => void;

  // Utility actions
  ensureUncategorizedWorkspace: () => void;
  updateLastOpened: (id: string) => void;
  cleanupClosedTabs: (workspaceId: string) => void;
}

// Serializable versions for persistence
export interface SerializableTabState
  extends Omit<TabState, "ui" | "createdAt" | "lastAccessedAt"> {
  ui: {
    scrollTop: number;
    scrollLeft: number;
    columnWidths: Record<string, number>;
    selectedRows: string[];
    expandedRows: string[];
    hiddenColumns: string[];
    columnOrder: string[];
  };
  createdAt: string;
  lastAccessedAt: string;
}

export interface SerializableWorkspaceState
  extends Omit<
    WorkspaceState,
    "tabs" | "createdAt" | "updatedAt" | "lastOpened"
  > {
  tabs: [string, SerializableTabState][];
  createdAt: string;
  updatedAt: string;
  lastOpened: string;
}

export interface SerializableWorkspaceStore {
  workspaces: [string, SerializableWorkspaceState][];
  activeWorkspaceId: string | null;
  lastActiveTabByConnection?: [string, [string, string][]][]; // [workspaceId, [connectionId, tabId][]][]
}
