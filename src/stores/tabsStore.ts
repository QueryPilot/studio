import { create } from 'zustand';

export interface Tab {
  id: string;
  name: string;
  type: 'query' | 'table' | 'view' | 'function';
  content?: string;
}

interface TabsStore {
  tabs: Tab[];
  activeTab: string;
  addTab: (tab: Omit<Tab, 'id'>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

export const useTabsStore = create<TabsStore>((set) => ({
  tabs: [
    { id: 'query1', name: 'Query 1', type: 'query' },
    { id: 'users', name: 'users', type: 'table' },
  ],
  activeTab: 'query1',
  
  addTab: (tab) => {
    const id = `${tab.type}-${Date.now()}`;
    set((state) => ({
      tabs: [...state.tabs, { ...tab, id }],
      activeTab: id,
    }));
  },
  
  removeTab: (id) => {
    set((state) => {
      const filteredTabs = state.tabs.filter((tab) => tab.id !== id);
      const lastTab = filteredTabs[filteredTabs.length - 1];
      const newActiveTab = state.activeTab === id && filteredTabs.length > 0 && lastTab
        ? lastTab.id
        : state.activeTab;
      
      return {
        tabs: filteredTabs,
        activeTab: newActiveTab,
      };
    });
  },
  
  setActiveTab: (id) => {
    set({ activeTab: id });
  },
}));