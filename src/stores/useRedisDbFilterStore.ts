import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createIndexedDbStorage } from "@/components/DataGrid/stores/indexedDbStorage";

interface RedisDbFilterState {
  /** Map<connectionId, visibleDbIndices> */
  filters: Record<string, number[]>;

  /** Set which databases are visible for a connection */
  setVisibleDbs: (connectionId: string, dbs: number[]) => void;

  /** Get visible databases for a connection, or null if no preference saved */
  getVisibleDbs: (connectionId: string) => number[] | null;

  /** Clear filter for a connection (revert to default) */
  clearFilter: (connectionId: string) => void;
}

const storage = createJSONStorage(() =>
  createIndexedDbStorage("redis-db-filter")
);

export const useRedisDbFilterStore = create<RedisDbFilterState>()(
  devtools(
    persist(
      immer((set, get) => ({
        filters: {},

        setVisibleDbs: (connectionId, dbs) => {
          set(
            (state) => {
              state.filters[connectionId] = dbs;
            },
            false,
            `redisDbFilter/setVisibleDbs:${connectionId}`
          );
        },

        getVisibleDbs: (connectionId) => {
          return get().filters[connectionId] ?? null;
        },

        clearFilter: (connectionId) => {
          set(
            (state) => {
              delete state.filters[connectionId];
            },
            false,
            `redisDbFilter/clearFilter:${connectionId}`
          );
        },
      })),
      {
        name: "redis-db-filter",
        storage,
        version: 1,
        partialize: (state) => ({ filters: state.filters }),
      }
    )
  )
);
