import { useCallback } from "react";
import { create } from "zustand";

interface TabLoadingState {
  /** Set of tab IDs that are currently loading */
  loadingTabs: Set<string>;
  setLoading: (tabId: string, loading: boolean) => void;
}

export const useTabLoadingStore = create<TabLoadingState>((set, get) => ({
  loadingTabs: new Set(),
  setLoading: (tabId, loading) => {
    const current = get().loadingTabs;
    const has = current.has(tabId);
    if (loading && !has) {
      const next = new Set(current);
      next.add(tabId);
      set({ loadingTabs: next });
    } else if (!loading && has) {
      const next = new Set(current);
      next.delete(tabId);
      set({ loadingTabs: next });
    }
  },
}));

export function useIsTabLoading(tabId: string): boolean {
  return useTabLoadingStore(
    useCallback((state: TabLoadingState) => state.loadingTabs.has(tabId), [tabId]),
  );
}
