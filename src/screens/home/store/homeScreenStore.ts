import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HomeScreenState, ContentMode, FormMode } from '../types';

export const useHomeScreenStore = create<HomeScreenState>()(
  persist(
    (set) => ({
      contentMode: 'browse',
      selectedConnectionId: null,
      formMode: 'create',
      formConnectionId: null,
      activeEnvFilters: ['all'],
      searchQuery: '',
      actionBarExpanded: false,
      sidebarWidth: 200,
      collapsedGroups: [],

      setContentMode: (mode: ContentMode) => set({ contentMode: mode }),

      selectConnection: (id: string | null) =>
        set({
          selectedConnectionId: id,
          contentMode: id ? 'details' : 'browse',
        }),

      openConnectionForm: (mode: FormMode, id?: string) =>
        set({
          contentMode: 'form',
          formMode: mode,
          formConnectionId: id ?? null,
        }),

      closeForm: () =>
        set({
          contentMode: 'browse',
          formConnectionId: null,
        }),

      toggleEnvFilter: (env: string) =>
        set((state) => {
          if (env === 'all') {
            return { activeEnvFilters: ['all'] };
          }

          let filters = state.activeEnvFilters.filter((f) => f !== 'all');

          if (filters.includes(env)) {
            filters = filters.filter((f) => f !== env);
          } else {
            filters.push(env);
          }

          return {
            activeEnvFilters: filters.length === 0 ? ['all'] : filters,
          };
        }),

      setSearchQuery: (query: string) => set({ searchQuery: query }),

      toggleActionBar: () =>
        set((state) => ({
          actionBarExpanded: !state.actionBarExpanded,
        })),

      setActionBarExpanded: (expanded: boolean) =>
        set({ actionBarExpanded: expanded }),

      setSidebarWidth: (width: number) => set({ sidebarWidth: width }),

      toggleGroup: (group: string) =>
        set((state) => ({
          collapsedGroups: state.collapsedGroups.includes(group)
            ? state.collapsedGroups.filter((g) => g !== group)
            : [...state.collapsedGroups, group],
        })),
    }),
    {
      name: 'home-screen-state',
      partialize: (state) => ({
        actionBarExpanded: state.actionBarExpanded,
        sidebarWidth: state.sidebarWidth,
        collapsedGroups: state.collapsedGroups,
        activeEnvFilters: state.activeEnvFilters,
      }),
    }
  )
);
