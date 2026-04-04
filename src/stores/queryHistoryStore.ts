/**
 * Query History Store
 *
 * Zustand store for query history and saved queries state management.
 * Provides optimistic UI updates and memoized selectors.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { subscribeWithSelector } from "zustand/middleware";
import {
  addHistoryEntry,
  getHistory,
  getSavedQueries,
  saveQuery,
  updateSavedQuery,
  deleteSavedQuery,
  clearHistory,
  type QueryHistoryEntry,
  type SavedQuery,
  type QuerySource,
} from "@/lib/db/queryHistory";

interface QueryHistoryState {
  // Data
  recentHistory: QueryHistoryEntry[];
  savedQueries: SavedQuery[];

  // UI state
  isLoading: boolean;
  activeTab: "history" | "saved";
  searchQuery: string;
  filterProfileIds: string[] | null;

  // Actions - History
  loadHistory: (options?: {
    profileIds?: string[];
    limit?: number;
  }) => Promise<void>;
  trackExecution: (params: {
    query: string;
    connectionId: string;
    profileId: string;
    database: string;
    schema?: string;
    executionTimeMs?: number;
    rowCount?: number;
    success: boolean;
    error?: string;
    source: QuerySource;
  }) => Promise<void>;
  clearHistory: (profileId?: string) => Promise<void>;

  // Actions - Saved Queries
  loadSavedQueries: (profileIds?: string[]) => Promise<void>;
  saveCurrentQuery: (params: {
    name: string;
    query: string;
    description?: string;
    tags?: string[];
    profileId?: string;
    database?: string;
    schema?: string;
    queryVariables?: Record<string, import("@/lib/queryVariables/types").QueryVariable>;
  }) => Promise<string>;
  updateSaved: (id: string, updates: Partial<SavedQuery>) => Promise<void>;
  deleteSaved: (id: string) => Promise<void>;
  toggleStarred: (id: string) => Promise<void>;

  // UI Actions
  setActiveTab: (tab: "history" | "saved") => void;
  setSearchQuery: (query: string) => void;
  setFilterProfileIds: (profileIds: string[] | null) => void;
}

export const useQueryHistoryStore = create<QueryHistoryState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    recentHistory: [],
    savedQueries: [],
    isLoading: false,
    activeTab: "history",
    searchQuery: "",
    filterProfileIds: null,

    // Load history from IndexedDB
    loadHistory: async (options) => {
      set({ isLoading: true });
      try {
        const profileIds = options?.profileIds ?? get().filterProfileIds ?? undefined;
        const history = await getHistory({
          profileIds,
          limit: options?.limit ?? 100,
        });
        set({ recentHistory: history });
      } finally {
        set({ isLoading: false });
      }
    },

    // Track a query execution (called from all execution paths)
    trackExecution: async (params) => {
      const id = await addHistoryEntry({
        ...params,
        executedAt: Date.now(),
      });

      // Prepend to in-memory cache for instant UI update
      // Only add if it matches the current workspace filter
      const filterIds = get().filterProfileIds;
      if (filterIds && !filterIds.includes(params.profileId)) return;

      const newEntry: QueryHistoryEntry = {
        id,
        ...params,
        executedAt: Date.now(),
      };

      set((state) => ({
        recentHistory: [newEntry, ...state.recentHistory].slice(0, 100),
      }));
    },

    clearHistory: async (profileId) => {
      await clearHistory(profileId);
      set({ recentHistory: [] });
    },

    // Saved queries
    loadSavedQueries: async (profileIds) => {
      set({ isLoading: true });
      try {
        const ids = profileIds ?? get().filterProfileIds ?? undefined;
        const saved = await getSavedQueries({ profileIds: ids });
        set({ savedQueries: saved });
      } finally {
        set({ isLoading: false });
      }
    },

    saveCurrentQuery: async (params) => {
      const id = await saveQuery({
        ...params,
        tags: params.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        starred: false,
      });
      await get().loadSavedQueries(get().filterProfileIds ?? undefined);
      return id;
    },

    updateSaved: async (id, updates) => {
      await updateSavedQuery(id, { ...updates, updatedAt: Date.now() });
      set((state) => ({
        savedQueries: state.savedQueries.map((q) =>
          q.id === id ? { ...q, ...updates, updatedAt: Date.now() } : q
        ),
      }));
    },

    deleteSaved: async (id) => {
      await deleteSavedQuery(id);
      set((state) => ({
        savedQueries: state.savedQueries.filter((q) => q.id !== id),
      }));
    },

    toggleStarred: async (id) => {
      const query = get().savedQueries.find((q) => q.id === id);
      if (query) {
        await get().updateSaved(id, { starred: !query.starred });
      }
    },

    // UI state
    setActiveTab: (tab) => { set({ activeTab: tab }); },
    setSearchQuery: (query) => { set({ searchQuery: query }); },
    setFilterProfileIds: (profileIds) => {
      set({ filterProfileIds: profileIds });
      void get().loadHistory({ profileIds: profileIds ?? undefined });
      void get().loadSavedQueries(profileIds ?? undefined);
    },
  }))
);

// ============ Memoized Selectors ============

export const useFilteredHistory = () => {
  return useQueryHistoryStore(
    useShallow((state) => {
      const { recentHistory, searchQuery } = state;
      if (!searchQuery) return recentHistory;

      const lower = searchQuery.toLowerCase();
      return recentHistory.filter((h) =>
        h.query.toLowerCase().includes(lower),
      );
    }),
  );
};

export const useFilteredSavedQueries = () => {
  return useQueryHistoryStore(
    useShallow((state) => {
      const { savedQueries, searchQuery } = state;
      if (!searchQuery) return savedQueries;

      const lower = searchQuery.toLowerCase();
      return savedQueries.filter(
        (q) =>
          q.name.toLowerCase().includes(lower) ||
          q.query.toLowerCase().includes(lower) ||
          q.tags.some((t) => t.toLowerCase().includes(lower)),
      );
    }),
  );
};
