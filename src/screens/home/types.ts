export type ContentMode = 'browse' | 'form' | 'details';
export type FormMode = 'create' | 'edit' | 'import';

export interface HomeScreenState {
  // Content mode
  contentMode: ContentMode;

  // Selection
  selectedConnectionId: string | null;

  // Form state
  formMode: FormMode;
  formConnectionId: string | null;

  // Filters
  activeEnvFilters: string[];
  searchQuery: string;

  // UI state
  actionBarExpanded: boolean;
  collapsedGroups: string[];

  // Actions
  setContentMode: (mode: ContentMode) => void;
  selectConnection: (id: string | null) => void;
  openConnectionForm: (mode: FormMode, id?: string) => void;
  closeForm: () => void;
  toggleEnvFilter: (env: string) => void;
  setSearchQuery: (query: string) => void;
  toggleActionBar: () => void;
  toggleGroup: (group: string) => void;
}
