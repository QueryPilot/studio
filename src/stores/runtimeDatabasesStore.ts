import { create } from "zustand";
import type { DatabaseEntry } from "@/types/connection";

export interface AttachmentError {
  alias: string;
  message: string;
}

export interface RuntimeDatabasesEntry {
  databases: DatabaseEntry[];
  errors: AttachmentError[];
}

interface State {
  byConnection: Record<string, RuntimeDatabasesEntry>;
  setRuntime: (connectionId: string, entry: RuntimeDatabasesEntry) => void;
  appendDatabase: (connectionId: string, db: DatabaseEntry) => void;
  removeDatabase: (connectionId: string, name: string) => void;
  appendError: (connectionId: string, err: AttachmentError) => void;
  clear: (connectionId: string) => void;
  get: (connectionId: string) => RuntimeDatabasesEntry;
}

const EMPTY: RuntimeDatabasesEntry = { databases: [], errors: [] };

// Note: NOT persisted (no persist middleware) — runtime-only.
export const useRuntimeDatabasesStore = create<State>((set, get) => ({
  byConnection: {},
  setRuntime: (id, entry) => {
    set((s) => ({ byConnection: { ...s.byConnection, [id]: entry } }));
  },
  appendDatabase: (id, db) => {
    set((s) => {
      const cur = s.byConnection[id] ?? EMPTY;
      return {
        byConnection: {
          ...s.byConnection,
          [id]: {
            ...cur,
            databases: [...cur.databases.filter((d) => d.name !== db.name), db],
          },
        },
      };
    });
  },
  removeDatabase: (id, name) => {
    set((s) => {
      const cur = s.byConnection[id] ?? EMPTY;
      return {
        byConnection: {
          ...s.byConnection,
          [id]: {
            ...cur,
            databases: cur.databases.filter((d) => d.name !== name),
          },
        },
      };
    });
  },
  appendError: (id, err) => {
    set((s) => {
      const cur = s.byConnection[id] ?? EMPTY;
      return {
        byConnection: {
          ...s.byConnection,
          [id]: {
            ...cur,
            errors: [...cur.errors.filter((e) => e.alias !== err.alias), err],
          },
        },
      };
    });
  },
  clear: (id) => {
    set((s) => ({ byConnection: { ...s.byConnection, [id]: EMPTY } }));
  },
  get: (id) => get().byConnection[id] ?? EMPTY,
}));
