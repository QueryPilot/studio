import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  HomeScreenState,
  ContentMode,
  FormMode,
  WorkspaceFormMode,
} from "../types";

export const useHomeScreenStore = create<HomeScreenState>()(
  persist(
    (set) => ({
      contentMode: "browse",
      selectedConnectionId: null,
      selectedConnectionIds: new Set<string>(),
      formMode: "create",
      formConnectionId: null,
      activeEnvFilters: ["all"],
      searchQuery: "",
      actionBarExpanded: false,
      sidebarWidth: 200,
      collapsedGroups: [],

      // Workspace state
      selectedWorkspaceId: null,
      workspaceFilterId: null,
      workspaceFormMode: "create",
      editingWorkspaceId: null,

      setContentMode: (mode: ContentMode) => set({ contentMode: mode }),

      selectConnection: (id: string | null) =>
        set({
          selectedConnectionId: id,
          contentMode: id ? "details" : "browse",
        }),

      openConnectionForm: (mode: FormMode, id?: string) =>
        set({
          contentMode: "form",
          formMode: mode,
          formConnectionId: id ?? null,
        }),

      closeForm: () =>
        set({
          contentMode: "browse",
          formConnectionId: null,
        }),

      toggleEnvFilter: (env: string) =>
        set((state) => {
          if (env === "all") {
            return { activeEnvFilters: ["all"] };
          }

          let filters = state.activeEnvFilters.filter((f) => f !== "all");

          if (filters.includes(env)) {
            filters = filters.filter((f) => f !== env);
          } else {
            filters.push(env);
          }

          return {
            activeEnvFilters: filters.length === 0 ? ["all"] : filters,
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

      toggleConnectionSelection: (id: string) =>
        set((state) => {
          const newSet = new Set(state.selectedConnectionIds);
          if (newSet.has(id)) {
            newSet.delete(id);
          } else {
            newSet.add(id);
          }
          return { selectedConnectionIds: newSet };
        }),

      setSelectedConnections: (ids: Set<string>) =>
        set({ selectedConnectionIds: ids }),

      addToSelection: (ids: string[]) =>
        set((state) => {
          const newSet = new Set(state.selectedConnectionIds);
          ids.forEach((id) => newSet.add(id));
          return { selectedConnectionIds: newSet };
        }),

      clearSelection: () => set({ selectedConnectionIds: new Set() }),

      selectAll: (ids: string[]) =>
        set({ selectedConnectionIds: new Set(ids) }),

      // Workspace actions
      showWorkspaceList: () =>
        set({
          contentMode: "workspace-list",
          selectedWorkspaceId: null,
        }),

      showWorkspaceDetail: (workspaceId: string) =>
        set({
          contentMode: "workspace-detail",
          selectedWorkspaceId: workspaceId,
        }),

      showWorkspaceForm: (mode: WorkspaceFormMode, workspaceId?: string) =>
        set({
          contentMode: "workspace-form",
          workspaceFormMode: mode,
          editingWorkspaceId: workspaceId ?? null,
        }),

      setWorkspaceFilter: (workspaceId: string | null) =>
        set({ workspaceFilterId: workspaceId }),

      clearWorkspaceFilter: () => set({ workspaceFilterId: null }),
    }),
    {
      name: "home-screen-state",
      partialize: (state) => ({
        actionBarExpanded: state.actionBarExpanded,
        sidebarWidth: state.sidebarWidth,
        collapsedGroups: state.collapsedGroups,
        activeEnvFilters: state.activeEnvFilters,
      }),
    },
  ),
);
