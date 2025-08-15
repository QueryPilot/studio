import { create } from 'zustand';
import { cacheService } from '@/services/cacheService';

export interface TabState {
  id: string;
  name: string;
  type: 'table' | 'view' | 'function' | 'query';
  schema?: string;
  content?: string;
  isDirty?: boolean;
  scrollPosition?: number;
  selection?: any;
}

interface WorkspaceState {
  id: string;
  tabs: TabState[];
  activeTabId: string | null;
  scrollPositions: Record<string, number>;
  selections: Record<string, any>;
}

interface WorkspaceStateStore {
  // Current workspace states
  workspaces: Map<string, WorkspaceState>;
  currentWorkspaceId: string | null;
  
  // Actions
  setCurrentWorkspace: (workspaceId: string) => void;
  addTab: (workspaceId: string, tab: TabState) => void;
  removeTab: (workspaceId: string, tabId: string) => void;
  setActiveTab: (workspaceId: string, tabId: string) => void;
  updateTab: (workspaceId: string, tabId: string, updates: Partial<TabState>) => void;
  setScrollPosition: (workspaceId: string, tabId: string, position: number) => void;
  setSelection: (workspaceId: string, tabId: string, selection: any) => void;
  
  // State persistence
  saveWorkspaceState: (workspaceId: string) => Promise<void>;
  loadWorkspaceState: (workspaceId: string) => Promise<void>;
  clearWorkspaceState: (workspaceId: string) => void;
  
  // Workspace management
  switchWorkspace: (fromId: string, toId: string) => Promise<void>;
  getCurrentWorkspace: () => WorkspaceState | null;
}

export const useWorkspaceStateStore = create<WorkspaceStateStore>((set, get) => ({
  workspaces: new Map(),
  currentWorkspaceId: null,
  
  setCurrentWorkspace: (workspaceId: string) => {
    set({ currentWorkspaceId: workspaceId });
    
    // Initialize workspace if it doesn't exist
    const { workspaces } = get();
    if (!workspaces.has(workspaceId)) {
      workspaces.set(workspaceId, {
        id: workspaceId,
        tabs: [],
        activeTabId: null,
        scrollPositions: {},
        selections: {},
      });
      set({ workspaces: new Map(workspaces) });
    }
  },
  
  addTab: (workspaceId: string, tab: TabState) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      // Check if tab already exists
      const existingTab = workspace.tabs.find(t => 
        t.name === tab.name && t.type === tab.type && t.schema === tab.schema
      );
      
      if (!existingTab) {
        workspace.tabs.push(tab);
        workspace.activeTabId = tab.id;
        set({ workspaces: new Map(workspaces) });
      } else {
        // Switch to existing tab
        workspace.activeTabId = existingTab.id;
        set({ workspaces: new Map(workspaces) });
      }
    }
  },
  
  removeTab: (workspaceId: string, tabId: string) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      const index = workspace.tabs.findIndex(t => t.id === tabId);
      if (index !== -1) {
        workspace.tabs.splice(index, 1);
        
        // Update active tab if needed
        if (workspace.activeTabId === tabId) {
          workspace.activeTabId = workspace.tabs.length > 0 
            ? workspace.tabs[Math.max(0, index - 1)]?.id || null
            : null;
        }
        
        // Clean up scroll positions and selections
        delete workspace.scrollPositions[tabId];
        delete workspace.selections[tabId];
        
        set({ workspaces: new Map(workspaces) });
      }
    }
  },
  
  setActiveTab: (workspaceId: string, tabId: string) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace && workspace.tabs.some(t => t.id === tabId)) {
      workspace.activeTabId = tabId;
      set({ workspaces: new Map(workspaces) });
    }
  },
  
  updateTab: (workspaceId: string, tabId: string, updates: Partial<TabState>) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      const tab = workspace.tabs.find(t => t.id === tabId);
      if (tab) {
        Object.assign(tab, updates);
        set({ workspaces: new Map(workspaces) });
      }
    }
  },
  
  setScrollPosition: (workspaceId: string, tabId: string, position: number) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      workspace.scrollPositions[tabId] = position;
      set({ workspaces: new Map(workspaces) });
    }
  },
  
  setSelection: (workspaceId: string, tabId: string, selection: any) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      workspace.selections[tabId] = selection;
      set({ workspaces: new Map(workspaces) });
    }
  },
  
  saveWorkspaceState: async (workspaceId: string) => {
    const { workspaces } = get();
    const workspace = workspaces.get(workspaceId);
    
    if (workspace) {
      try {
        await cacheService.setWorkspaceState({
          id: workspaceId,
          tabs: workspace.tabs,
          activeTabId: workspace.activeTabId || '',
          scrollPositions: workspace.scrollPositions,
          selections: workspace.selections,
        });
        console.log(`[WorkspaceStateStore] Saved state for workspace ${workspaceId}`);
      } catch (error) {
        console.error(`[WorkspaceStateStore] Failed to save state:`, error);
      }
    }
  },
  
  loadWorkspaceState: async (workspaceId: string) => {
    try {
      const savedState = await cacheService.getWorkspaceState(workspaceId);
      
      if (savedState) {
        const { workspaces } = get();
        workspaces.set(workspaceId, {
          id: workspaceId,
          tabs: savedState.tabs,
          activeTabId: savedState.activeTabId,
          scrollPositions: savedState.scrollPositions,
          selections: savedState.selections,
        });
        set({ workspaces: new Map(workspaces) });
        console.log(`[WorkspaceStateStore] Loaded state for workspace ${workspaceId}`);
      } else {
        // Initialize empty workspace
        get().setCurrentWorkspace(workspaceId);
      }
    } catch (error) {
      console.error(`[WorkspaceStateStore] Failed to load state:`, error);
      // Initialize empty workspace on error
      get().setCurrentWorkspace(workspaceId);
    }
  },
  
  clearWorkspaceState: (workspaceId: string) => {
    const { workspaces } = get();
    workspaces.delete(workspaceId);
    set({ workspaces: new Map(workspaces) });
  },
  
  switchWorkspace: async (fromId: string, toId: string) => {
    // Save current workspace state
    if (fromId) {
      await get().saveWorkspaceState(fromId);
    }
    
    // Load new workspace state
    await get().loadWorkspaceState(toId);
    
    // Set as current
    set({ currentWorkspaceId: toId });
  },
  
  getCurrentWorkspace: () => {
    const { workspaces, currentWorkspaceId } = get();
    return currentWorkspaceId ? workspaces.get(currentWorkspaceId) || null : null;
  },
}));