import { create } from "zustand";

interface WorkspaceSelectionState {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  setActiveConnection: (connectionId: string | null) => void;
  setSelectedDatabase: (database: string) => void;
  setSchema: (schema: string) => void;
}

export const useWorkspaceSelectionStore = create<WorkspaceSelectionState>(
  (set) => ({
    connectionId: null,
    database: null,
    schema: null,
    setActiveConnection: (connectionId) => {
      set({ connectionId: connectionId ?? null });
    },
    setSelectedDatabase: (database: string) => {
      set({ database: database });
    },
    setSchema: (schema: string) => {
      set({ schema });
    },
  }),
);
