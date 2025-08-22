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

export interface ActiveQuery {
  id: string;
  connectionId: string;
  sql: string;
  startTime: Date;
  cursorId?: string;
  isCancellable: boolean;
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
  
  // Active queries
  activeQueries: Map<string, ActiveQuery>;
  addActiveQuery: (query: ActiveQuery) => void;
  removeActiveQuery: (queryId: string) => void;
  updateActiveQuery: (queryId: string, updates: Partial<ActiveQuery>) => void;
  getActiveQueriesForConnection: (connectionId: string) => ActiveQuery[];
  cancelQuery: (queryId: string) => Promise<void>;
}

export const useQueryStore = create<QueryStore>()(
  persist(
    (set, get) => ({
      // History
      history: [],
      addToHistory: (item) =>
        { set((state) => ({
          history: [
            {
              ...item,
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            ...state.history.slice(0, 99), // Keep last 100 queries
          ],
        })); },
      clearHistory: () => { set({ history: [] }); },
      removeFromHistory: (id) =>
        { set((state) => ({
          history: state.history.filter((item) => item.id !== id),
        })); },
      
      // Saved queries
      savedQueries: [],
      saveQuery: (query) =>
        { set((state) => ({
          savedQueries: [...state.savedQueries, query],
        })); },
      updateSavedQuery: (id, updates) =>
        { set((state) => ({
          savedQueries: state.savedQueries.map((q) =>
            q.id === id ? { ...q, ...updates, updatedAt: new Date().toISOString() } : q
          ),
        })); },
      deleteSavedQuery: (id) =>
        { set((state) => ({
          savedQueries: state.savedQueries.filter((q) => q.id !== id),
        })); },
      
      // Current query
      currentQuery: '',
      setCurrentQuery: (query) => { set({ currentQuery: query }); },
      
      // Results
      lastResults: null,
      setLastResults: (results) => { set({ lastResults: results }); },
      
      // Active queries
      activeQueries: new Map(),
      addActiveQuery: (query) =>
        { set((state) => ({
          activeQueries: new Map(state.activeQueries).set(query.id, query),
        })); },
      removeActiveQuery: (queryId) =>
        { set((state) => {
          const newMap = new Map(state.activeQueries);
          newMap.delete(queryId);
          return { activeQueries: newMap };
        }); },
      updateActiveQuery: (queryId, updates) =>
        { set((state) => {
          const query = state.activeQueries.get(queryId);
          if (!query) return state;
          
          const newMap = new Map(state.activeQueries);
          newMap.set(queryId, { ...query, ...updates });
          return { activeQueries: newMap };
        }); },
      getActiveQueriesForConnection: (connectionId) => {
        const activeQueries = get().activeQueries;
        return Array.from(activeQueries.values()).filter(
          (query) => query.connectionId === connectionId
        );
      },
      cancelQuery: async (queryId) => {
        const activeQuery = get().activeQueries.get(queryId);
        if (!activeQuery) {
          throw new Error(`Query ${queryId} not found`);
        }
        
        try {
          // Import here to avoid circular dependency
          const { secureDatabaseService } = await import('@/services/secureDatabaseService');
          
          if (activeQuery.cursorId) {
            await secureDatabaseService.cancelQuery(activeQuery.connectionId, activeQuery.cursorId);
          }
          
          // Remove from active queries
          get().removeActiveQuery(queryId);
        } catch (error) {
          console.error('Failed to cancel query:', error);
          throw error;
        }
      },
    }),
    {
      name: 'query-storage',
      partialize: (state) => ({
        history: state.history,
        savedQueries: state.savedQueries,
        // Don't persist active queries - they're runtime only
      }),
    }
  )
);