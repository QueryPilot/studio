import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  addToHistory: (item: Omit<QueryHistoryItem, 'id'>) => void;
  clearHistory: () => void;
  removeFromHistory: (id: string) => void;
  
  // Saved queries
  savedQueries: SavedQuery[];
  saveQuery: (query: SavedQuery) => void;
  updateSavedQuery: (id: string, updates: Partial<SavedQuery>) => void;
  deleteSavedQuery: (id: string) => void;
  
  // Current query state
  currentQuery: string;
  setCurrentQuery: (query: string) => void;
  
  // Results
  lastResults: any;
  setLastResults: (results: any) => void;
}

export const useQueryStore = create<QueryStore>()(
  persist(
    (set) => ({
      // History
      history: [],
      addToHistory: (item) =>
        set((state) => ({
          history: [
            {
              ...item,
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            ...state.history.slice(0, 99), // Keep last 100 queries
          ],
        })),
      clearHistory: () => set({ history: [] }),
      removeFromHistory: (id) =>
        set((state) => ({
          history: state.history.filter((item) => item.id !== id),
        })),
      
      // Saved queries
      savedQueries: [],
      saveQuery: (query) =>
        set((state) => ({
          savedQueries: [...state.savedQueries, query],
        })),
      updateSavedQuery: (id, updates) =>
        set((state) => ({
          savedQueries: state.savedQueries.map((q) =>
            q.id === id ? { ...q, ...updates, updatedAt: new Date().toISOString() } : q
          ),
        })),
      deleteSavedQuery: (id) =>
        set((state) => ({
          savedQueries: state.savedQueries.filter((q) => q.id !== id),
        })),
      
      // Current query
      currentQuery: '',
      setCurrentQuery: (query) => set({ currentQuery: query }),
      
      // Results
      lastResults: null,
      setLastResults: (results) => set({ lastResults: results }),
    }),
    {
      name: 'query-storage',
      partialize: (state) => ({
        history: state.history,
        savedQueries: state.savedQueries,
      }),
    }
  )
);