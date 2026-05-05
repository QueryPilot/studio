import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type NodePosition = {
  x: number;
  y: number;
};

export type ViewportState = {
  x: number;
  y: number;
  zoom: number;
};

interface EnsureViewInput {
  connectionId: string;
  database?: string;
  /**
   * Primary schema. Used as a back-compat fallback when `schemas` is
   * omitted, and as the singular `schema` field stored on the view for
   * legacy callers (e.g. fitting in name placeholders).
   */
  schema: string;
  /**
   * Full list of schemas the view should render. When provided, view
   * identity is keyed on the *sorted joined list* — so a view for
   * `["public"]` and a view for `["public", "billing"]` do not collide
   * even though their primary schema is the same.
   */
  schemas?: string[];
  name?: string;
  isTemporary?: boolean;
}

interface UpdateViewInput {
  dbml?: string;
  tableCount?: number;
  relationshipCount?: number;
  layoutDirection?: "LR" | "RL" | "TB" | "BT";
  hasManualPositions?: boolean;
  isTemporary?: boolean;
  nodePositions?: Record<string, NodePosition>;
  viewport?: ViewportState;
}

export interface ErdView {
  id: string;
  name: string;
  connectionId: string;
  database?: string;
  schema: string;
  dbml: string;
  tableCount: number;
  relationshipCount: number;
  nodePositions: Record<string, NodePosition>;
  viewport?: ViewportState;
  layoutDirection: "LR" | "RL" | "TB" | "BT";
  selectedSchemas?: string[];
  hasManualPositions: boolean;
  isTemporary?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ErdStoreState {
  views: Record<string, ErdView>;
  connectionViewIds: Record<string, string[]>;
  activeViewId: string | null;

  ensureView: (input: EnsureViewInput) => string;
  updateView: (viewId: string, updates: UpdateViewInput) => void;
  deleteView: (viewId: string) => void;
  renameView: (viewId: string, name: string) => void;
  setActiveView: (viewId: string | null) => void;
  findView: (
    connectionId: string,
    database: string | undefined,
    schema: string,
    schemas?: string[],
  ) => ErdView | null;
  getActiveView: () => ErdView | null;
  getViewsForConnection: (connectionId: string, database?: string) => ErdView[];
  saveNodePosition: (
    viewId: string,
    nodeId: string,
    position: NodePosition,
  ) => void;
  saveViewport: (viewId: string, viewport: ViewportState) => void;
  setViewSchemas: (viewId: string, schemas: string[]) => void;
  clearConnectionViews: (connectionId: string, database?: string) => void;
}

const DEFAULT_LAYOUT_DIRECTION: ErdView["layoutDirection"] = "LR";

const makeConnectionKey = (connectionId: string, database?: string): string =>
  `${connectionId}::${database ?? "__default__"}`;

/**
 * Identity for a view across multi-schema selections. We sort+join the schema
 * list so `["public", "billing"]` and `["billing", "public"]` collapse to the
 * same view. When the caller doesn't pass a list (legacy single-schema flow)
 * the singular schema string acts as the identity.
 */
const makeSchemaKey = (schema: string, schemas?: string[]): string => {
  if (schemas && schemas.length > 0) {
    return schemas.slice().sort().join("|");
  }
  return schema;
};

export const useErdStore = create<ErdStoreState>()(
  persist(
    (set, get) => ({
      views: {},
      connectionViewIds: {},
      activeViewId: null,

      ensureView: ({ connectionId, database, schema, schemas, name, isTemporary }) => {
        const existing = get().findView(connectionId, database, schema, schemas);
        if (existing) {
          return existing.id;
        }

        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const viewName =
          name || `${schema ? schema : "default"} ${database ? "@" + database : ""}`;

        const newView: ErdView = {
          id,
          name: viewName,
          connectionId,
          database,
          schema,
          dbml: "",
          tableCount: 0,
          relationshipCount: 0,
          nodePositions: {},
          viewport: undefined,
          layoutDirection: DEFAULT_LAYOUT_DIRECTION,
          // Persist the schema list so view restoration can rehydrate the
          // multi-schema selection rather than collapsing to the primary.
          selectedSchemas:
            schemas && schemas.length > 0 ? schemas.slice() : undefined,
          hasManualPositions: false,
          isTemporary,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => {
          const connectionKey = makeConnectionKey(connectionId, database);
          const existingIds = state.connectionViewIds[connectionKey] ?? [];
          const connectionViewIds = {
            ...state.connectionViewIds,
            [connectionKey]: [...existingIds, id],
          };

          return {
            views: {
              ...state.views,
              [id]: newView,
            },
            connectionViewIds,
            activeViewId: state.activeViewId ?? id,
          };
        });

        return id;
      },

      updateView: (viewId, updates) => {
        set((state) => {
          const existing = state.views[viewId];
          if (!existing) return state;

          const updated: ErdView = {
            ...existing,
            ...updates,
            nodePositions: updates.nodePositions ?? existing.nodePositions,
            viewport: updates.viewport ?? existing.viewport,
            layoutDirection: updates.layoutDirection ?? existing.layoutDirection,
            hasManualPositions:
              updates.hasManualPositions !== undefined
                ? updates.hasManualPositions
                : existing.hasManualPositions,
            dbml: updates.dbml ?? existing.dbml,
            tableCount: updates.tableCount ?? existing.tableCount,
            relationshipCount: updates.relationshipCount ?? existing.relationshipCount,
            isTemporary:
              updates.isTemporary !== undefined
                ? updates.isTemporary
                : existing.isTemporary,
            updatedAt: new Date().toISOString(),
          };

          return {
            ...state,
            views: {
              ...state.views,
              [viewId]: updated,
            },
          };
        });
      },

      deleteView: (viewId) => {
        set((state) => {
          const existing = state.views[viewId];
          if (!existing) return state;

          const connectionKey = makeConnectionKey(existing.connectionId, existing.database);
          const existingIds = state.connectionViewIds[connectionKey] ?? [];
          const updatedIds = existingIds.filter((id) => id !== viewId);

          const { [connectionKey]: _removedKey, ...restConnections } = state.connectionViewIds;
          const connectionViewIds =
            updatedIds.length > 0
              ? { ...restConnections, [connectionKey]: updatedIds }
              : restConnections;

          const { [viewId]: _removedView, ...restViews } = state.views;

          const activeViewId =
            state.activeViewId === viewId
              ? updatedIds.length > 0
                ? updatedIds[0]
                : null
              : state.activeViewId;

          return {
            views: restViews,
            connectionViewIds,
            activeViewId,
          };
        });
      },

      renameView: (viewId, name) => {
        set((state) => {
          const existing = state.views[viewId];
          if (!existing) return state;
          return {
            ...state,
            views: {
              ...state.views,
              [viewId]: {
                ...existing,
                name,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      setActiveView: (viewId) => {
        set({ activeViewId: viewId });
      },

      findView: (connectionId, database, schema, schemas) => {
        const connectionKey = makeConnectionKey(connectionId, database);
        const targetKey = makeSchemaKey(schema, schemas);
        const { connectionViewIds, views } = get();
        const viewIds = connectionViewIds[connectionKey] ?? [];
        for (const id of viewIds) {
          const view = views[id];
          if (!view) continue;
          // Compare on the same key the caller asked for: if `schemas` was
          // passed, compare against the view's stored selectedSchemas;
          // otherwise fall back to the legacy single-schema match.
          const viewKey = makeSchemaKey(view.schema, view.selectedSchemas);
          if (viewKey === targetKey) {
            return view;
          }
        }
        return null;
      },

      getActiveView: () => {
        const state = get();
        if (!state.activeViewId) return null;
        return state.views[state.activeViewId] ?? null;
      },

      getViewsForConnection: (connectionId, database) => {
        const connectionKey = makeConnectionKey(connectionId, database);
        const { connectionViewIds, views } = get();
        const viewIds = connectionViewIds[connectionKey] ?? [];
        return viewIds
          .map((id) => views[id])
          .filter((view): view is ErdView => Boolean(view));
      },

      saveNodePosition: (viewId, nodeId, position) => {
        set((state) => {
          const view = state.views[viewId];
          if (!view) return state;

          return {
            ...state,
            views: {
              ...state.views,
              [viewId]: {
                ...view,
                nodePositions: {
                  ...view.nodePositions,
                  [nodeId]: position,
                },
                hasManualPositions: true,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      saveViewport: (viewId, viewport) => {
        set((state) => {
          const view = state.views[viewId];
          if (!view) return state;
          return {
            ...state,
            views: {
              ...state.views,
              [viewId]: {
                ...view,
                viewport,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      setViewSchemas: (viewId, schemas) => {
        if (schemas.length === 0) return;
        set((state) => {
          const view = state.views[viewId];
          if (!view) return state;
          return {
            ...state,
            views: {
              ...state.views,
              [viewId]: {
                ...view,
                selectedSchemas: schemas.slice(),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      clearConnectionViews: (connectionId, database) => {
        set((state) => {
          const connectionKey = makeConnectionKey(connectionId, database);
          const viewIds = state.connectionViewIds[connectionKey];
          if (!viewIds || viewIds.length === 0) return state;

          const views = Object.fromEntries(
            Object.entries(state.views).filter(([id]) => !viewIds.includes(id)),
          );

          const { [connectionKey]: _removed, ...restConnections } = state.connectionViewIds;

          const activeViewId = viewIds.includes(state.activeViewId ?? "")
            ? null
            : state.activeViewId;

          return {
            views,
            connectionViewIds: restConnections,
            activeViewId,
          };
        });
      },
    }),
    {
      name: "erd-store",
      storage: createJSONStorage(() => localStorage),
      version: 2,
    },
  ),
);
