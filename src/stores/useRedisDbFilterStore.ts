import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createIndexedDbStorage } from "@/components/DataGrid/stores/indexedDbStorage";

interface RedisDbFilterState {
  /** Map<connectionId, visibleDbIndices> */
  filters: Record<string, number[]>;

  /** Set which databases are visible for a connection */
  setVisibleDbs: (connectionId: string, dbs: number[]) => void;
}

const storage = createJSONStorage(() =>
  createIndexedDbStorage("redis-db-filter")
);

export const useRedisDbFilterStore = create<RedisDbFilterState>()(
  devtools(
    persist(
      immer((set) => ({
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
