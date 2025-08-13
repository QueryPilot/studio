import { create } from "zustand";

interface EditorTab {
  id: string;
  title: string;
  type: "query" | "table" | "view";
  content: string;
  isDirty: boolean;
}

interface Query {
  id: string;
  sql: string;
  timestamp: Date;
  executionTime: number;
  rowCount: number;
}

interface WorkspaceState {
  activeWorkspaceId: string | null;
  openTabs: EditorTab[];
  activeTabId: string | null;
  selectedTable: string | null;
  queryHistory: Query[];
  
  setActiveWorkspace: (workspaceId: string) => void;
  addTab: (tab: Omit<EditorTab, "id">) => void;
  updateTab: (tabId: string, updates: Partial<EditorTab>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  selectTable: (tableName: string | null) => void;
  addQueryToHistory: (query: Omit<Query, "id">) => void;
  clearQueryHistory: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: null,
  openTabs: [],
  activeTabId: null,
  selectedTable: null,
  queryHistory: [],
  
  setActiveWorkspace: (workspaceId) =>
    set({ activeWorkspaceId: workspaceId }),
    
  addTab: (tab) =>
    set((state) => {
      const newTab = {
        ...tab,
        id: `tab-${Date.now()}`,
      };
      return {
        openTabs: [...state.openTabs, newTab],
        activeTabId: newTab.id,
      };
    }),
    
  updateTab: (tabId, updates) =>
    set((state) => ({
      openTabs: state.openTabs.map((tab) =>
        tab.id === tabId ? { ...tab, ...updates } : tab
      ),
    })),
    
  closeTab: (tabId) =>
    set((state) => {
      const filteredTabs = state.openTabs.filter((tab) => tab.id !== tabId);
      const newActiveTabId =
        state.activeTabId === tabId
          ? filteredTabs[filteredTabs.length - 1]?.id || null
          : state.activeTabId;
      return {
        openTabs: filteredTabs,
        activeTabId: newActiveTabId,
      };
    }),
    
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  
  selectTable: (tableName) => set({ selectedTable: tableName }),
  
  addQueryToHistory: (query) =>
    set((state) => ({
      queryHistory: [
        { ...query, id: `query-${Date.now()}` },
        ...state.queryHistory,
      ].slice(0, 100), // Keep last 100 queries
    })),
    
  clearQueryHistory: () => set({ queryHistory: [] }),
}));