import { create } from 'zustand';

interface WorkspaceSelectionState {
  activeConnectionId: string | null;
  selectedDatabases: Record<string, string>;
  setActiveConnection: (connectionId: string | null) => void;
  setSelectedDatabase: (connectionId: string, database: string) => void;
  getSelectedDatabase: (connectionId: string | null) => string;
}

export const useWorkspaceSelectionStore = create<WorkspaceSelectionState>((set, get) => ({
  activeConnectionId: null,
  selectedDatabases: {},
  setActiveConnection: (connectionId) => set({ activeConnectionId: connectionId }),
  setSelectedDatabase: (connectionId, database) =>
    set((state) => ({
      selectedDatabases: { ...state.selectedDatabases, [connectionId]: database },
    })),
  getSelectedDatabase: (connectionId) => {
    if (!connectionId) {
      return '';
    }
    return get().selectedDatabases[connectionId] ?? '';
  },
}));
