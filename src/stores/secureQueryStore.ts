import { create } from 'zustand';
import { secureStorage } from '@/services/secureStorage';

export interface QueryHistoryItem {
  id: string;
  query: string;
  connectionId: string;
  connectionName: string;
  executedAt: string;
  duration: number;
  rowCount?: number;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  query: string;
  connectionId?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

interface QueryStore {
  // History
  history: QueryHistoryItem[];
  addToHistory: (item: Omit<QueryHistoryItem, 'id'>) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeFromHistory: (id: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  
  // Saved queries
  savedQueries: SavedQuery[];
  saveQuery: (query: SavedQuery) => Promise<void>;
  updateSavedQuery: (id: string, updates: Partial<SavedQuery>) => Promise<void>;
  deleteSavedQuery: (id: string) => Promise<void>;
  loadSavedQueries: () => Promise<void>;
  
  // Current query state
  currentQuery: string;
  setCurrentQuery: (query: string) => void;
  
  // Results
  lastResults: any;
  setLastResults: (results: any) => void;
  
  // Loading state
  isLoading: boolean;
}

/**
 * Secure Query Store
 * All query history and saved queries are stored encrypted in the backend
 * No localStorage or sessionStorage is used
 */
export const useSecureQueryStore = create<QueryStore>((set, get) => ({
  // History
  history: [],
  isLoading: false,
  
  loadHistory: async () => {
    set({ isLoading: true });
    try {
      const history = await secureStorage.getQueryHistory();
      set({ history, isLoading: false });
    } catch (error) {
      console.error('Failed to load query history:', error);
      set({ isLoading: false });
    }
  },
  
  addToHistory: async (item) => {
    const newItem: QueryHistoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    
    const newHistory = [
      newItem,
      ...get().history.slice(0, 99), // Keep last 100 queries
    ];
    
    set({ history: newHistory });
    
    // Store in secure backend
    try {
      await secureStorage.storeQueryHistory(newHistory);
    } catch (error) {
      console.error('Failed to store query history:', error);
    }
  },
  
  clearHistory: async () => {
    set({ history: [] });
    
    // Clear in secure backend
    try {
      await secureStorage.storeQueryHistory([]);
    } catch (error) {
      console.error('Failed to clear query history:', error);
    }
  },
  
  removeFromHistory: async (id) => {
    const newHistory = get().history.filter((item) => item.id !== id);
    set({ history: newHistory });
    
    // Update in secure backend
    try {
      await secureStorage.storeQueryHistory(newHistory);
    } catch (error) {
      console.error('Failed to update query history:', error);
    }
  },
  
  // Saved queries
  savedQueries: [],
  
  loadSavedQueries: async () => {
    set({ isLoading: true });
    try {
      const queries = await secureStorage.getSavedQueries();
      set({ savedQueries: queries, isLoading: false });
    } catch (error) {
      console.error('Failed to load saved queries:', error);
      set({ isLoading: false });
    }
  },
  
  saveQuery: async (query) => {
    const newQueries = [...get().savedQueries, query];
    set({ savedQueries: newQueries });
    
    // Store in secure backend
    try {
      await secureStorage.storeSavedQueries(newQueries);
    } catch (error) {
      console.error('Failed to save query:', error);
      throw error;
    }
  },
  
  updateSavedQuery: async (id, updates) => {
    const newQueries = get().savedQueries.map((q) =>
      q.id === id ? { ...q, ...updates, updatedAt: new Date().toISOString() } : q
    );
    set({ savedQueries: newQueries });
    
    // Update in secure backend
    try {
      await secureStorage.storeSavedQueries(newQueries);
    } catch (error) {
      console.error('Failed to update saved query:', error);
      throw error;
    }
  },
  
  deleteSavedQuery: async (id) => {
    const newQueries = get().savedQueries.filter((q) => q.id !== id);
    set({ savedQueries: newQueries });
    
    // Update in secure backend
    try {
      await secureStorage.storeSavedQueries(newQueries);
    } catch (error) {
      console.error('Failed to delete saved query:', error);
      throw error;
    }
  },
  
  // Current query
  currentQuery: '',
  setCurrentQuery: (query) => { set({ currentQuery: query }); },
  
  // Results
  lastResults: null,
  setLastResults: (results) => { set({ lastResults: results }); },
}));