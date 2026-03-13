export type ContentMode =
  | "browse"
  | "form"
  | "details"
  | "workspace-list"
  | "workspace-detail"
  | "workspace-form";

export type FormMode = "create" | "edit" | "import";

export interface HomeScreenState {
  // Content mode
  contentMode: ContentMode;

  // Selection
  selectedConnectionId: string | null;
  selectedConnectionIds: Set<string>;

  // Form state
  formMode: FormMode;
  formConnectionId: string | null;
  formPreselectedWorkspaceId: string | null;

  // Workspace form state
  workspaceFormMode: "create" | "edit";
  workspaceFormId: string | null;

  // Workspace state
  selectedWorkspaceId: string | null;
  workspaceFilterId: string | null;

  // Filters
  activeEnvFilters: string[];
  searchQuery: string;

  // UI state
  collapsedGroups: string[];

  // Actions
  setContentMode: (mode: ContentMode) => void;
  selectConnection: (id: string | null) => void;
  openConnectionForm: (mode: FormMode, id?: string, workspaceId?: string) => void;
  closeForm: () => void;
  toggleEnvFilter: (env: string) => void;
  setSearchQuery: (query: string) => void;
  toggleGroup: (group: string) => void;

  // Multi-select actions
  toggleConnectionSelection: (id: string) => void;
  setSelectedConnections: (ids: Set<string>) => void;
  addToSelection: (ids: string[]) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;

  // Workspace actions
  showWorkspaceList: () => void;
  showWorkspaceDetail: (workspaceId: string) => void;
  setWorkspaceFilter: (workspaceId: string | null) => void;
  clearWorkspaceFilter: () => void;
  openWorkspaceForm: (mode: "create" | "edit", workspaceId?: string) => void;
  closeWorkspaceForm: () => void;
}
