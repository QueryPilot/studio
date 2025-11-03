import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StarredItemType = "table" | "view" | "function";

export interface StarredItem {
  id: string; // Unique identifier: `${connectionId}:${database}:${schema}:${type}:${name}`
  connectionId: string;
  database: string;
  schema: string;
  type: StarredItemType;
  name: string;
  starredAt: number; // Timestamp when starred
}

interface StarredItemsState {
  items: StarredItem[];

  // Actions
  toggleStarred: (item: Omit<StarredItem, "id" | "starredAt">) => void;
  isStarred: (
    connectionId: string,
    database: string,
    schema: string,
    type: StarredItemType,
    name: string,
  ) => boolean;
  getStarredItems: (
    connectionId: string,
    database: string,
    schema: string,
  ) => StarredItem[];
  clearStarredForConnection: (connectionId: string) => void;
}

const createItemId = (
  connectionId: string,
  database: string,
  schema: string,
  type: StarredItemType,
  name: string,
): string => {
  return `${connectionId}:${database}:${schema}:${type}:${name}`;
};

export const useStarredItemsStore = create<StarredItemsState>()(
  persist(
    (set, get) => ({
      items: [],

      toggleStarred: (itemData) => {
        const id = createItemId(
          itemData.connectionId,
          itemData.database,
          itemData.schema,
          itemData.type,
          itemData.name,
        );

        set((state) => {
          const existingIndex = state.items.findIndex((item) => item.id === id);

          if (existingIndex >= 0) {
            // Remove if already starred
            return {
              items: state.items.filter((item) => item.id !== id),
            };
          } else {
            // Add new starred item
            const newItem: StarredItem = {
              ...itemData,
              id,
              starredAt: Date.now(),
            };
            return {
              items: [...state.items, newItem],
            };
          }
        });
      },

      isStarred: (connectionId, database, schema, type, name) => {
        const id = createItemId(connectionId, database, schema, type, name);
        return get().items.some((item) => item.id === id);
      },

      getStarredItems: (connectionId, database, schema) => {
        return get()
          .items.filter(
            (item) =>
              item.connectionId === connectionId &&
              item.database === database &&
              item.schema === schema,
          )
          .sort((a, b) => b.starredAt - a.starredAt); // Most recently starred first
      },

      clearStarredForConnection: (connectionId) => {
        set((state) => ({
          items: state.items.filter(
            (item) => item.connectionId !== connectionId,
          ),
        }));
      },
    }),
    {
      name: "query-pilot-starred-items",
    },
  ),
);
