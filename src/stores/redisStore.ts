/**
 * Redis-specific state store
 * 
 * Manages Redis connection context, key browser state, server info,
 * and scan pagination for the active connection.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { 
  RedisValue, 
  RedisType, 
  KeyPattern, 
  RedisServerInfo 
} from "@/adapters/types/redis";

// ============ Types ============

export interface ModuleInfo {
  name: string;
  version: string;
}

export interface KeyMetadata {
  key: string;
  keyType: RedisType;
  ttl: number;
  sizeBytes?: number;
}

interface ScanResult {
  cursor: number;
  keys: KeyMetadata[];
}

export interface RedisStoreState {
  // Current context
  connectionId: string | null;
  currentDatabase: number; // 0-15

  // Server info
  serverInfo: RedisServerInfo | null;
  loadedModules: ModuleInfo[];

  // Key browser state
  keyPatterns: KeyPattern[]; // Detected patterns for grouping
  selectedKey: string | null;
  keyValue: RedisValue | null;
  keyType: RedisType | null;
  keyTTL: number | null;

  // Scan state (for pagination)
  scanCursor: number;
  scanPattern: string;
  scannedKeys: KeyMetadata[];
  scanLoading: boolean;
  scanComplete: boolean;

  // Grouping state
  groupedKeys: Map<string, number>;

  // Database info
  databaseSizes: Map<number, number>; // db index -> key count

  // Actions
  setConnectionId: (id: string) => void;
  setCurrentDatabase: (index: number) => void;
  
  // Server info actions
  setServerInfo: (info: RedisServerInfo | null) => void;
  setLoadedModules: (modules: ModuleInfo[]) => void;

  // Key browser actions
  setKeyPatterns: (patterns: KeyPattern[]) => void;
  selectKey: (key: string | null) => void;
  setKeyValue: (value: RedisValue | null, type?: RedisType | null, ttl?: number | null) => void;
  clearSelectedKey: () => void;

  // Scan actions
  setScanPattern: (pattern: string) => void;
  resetScan: () => void;
  fetchNextPage: (count?: number) => Promise<void>;

  // Database info actions
  setDatabaseSize: (index: number, size: number) => void;
  setDatabaseSizes: (sizes: Map<number, number>) => void;

  // Reset
  reset: () => void;
}

// ============ Initial State ============

const initialState = {
  connectionId: null,
  currentDatabase: 0,
  serverInfo: null as RedisServerInfo | null,
  loadedModules: [] as ModuleInfo[],
  keyPatterns: [] as KeyPattern[],
  selectedKey: null as string | null,
  keyValue: null as RedisValue | null,
  keyType: null as RedisType | null,
  keyTTL: null as number | null,
  scanCursor: 0,
  scanPattern: "*",
  scannedKeys: [] as KeyMetadata[],
  scanLoading: false,
  scanComplete: false,
  groupedKeys: new Map<string, number>(),
  databaseSizes: new Map<number, number>(),
};

const computeGroups = (keys: KeyMetadata[]): Map<string, number> => {
  const groups = new Map<string, number>();
  for (const k of keys) {
    const parts = k.key.split(":");
    if (parts.length > 1) {
      const prefix = parts[0] + ":";
      groups.set(prefix, (groups.get(prefix) || 0) + 1);
    }
  }
  return groups;
};

// ============ Store ============

export const useRedisStore = create<RedisStoreState>()((set, get) => ({
  ...initialState,

  setConnectionId: (id) => set({ connectionId: id }),

  setCurrentDatabase: (index) => {
    set({ 
      currentDatabase: index,
      // Reset key browser state when switching databases
      selectedKey: null,
      keyValue: null,
      keyType: null,
      keyTTL: null,
      scanCursor: 0,
      scannedKeys: [],
      scanComplete: false,
      keyPatterns: [],
      groupedKeys: new Map(),
    });
  },

  // Server info actions
  setServerInfo: (info) => {
    set({ serverInfo: info });
  },

  setLoadedModules: (modules) => {
    set({ loadedModules: modules });
  },

  // Key browser actions
  setKeyPatterns: (patterns) => {
    set({ keyPatterns: patterns });
  },

  selectKey: (key) => {
    set({ 
      selectedKey: key,
      // Clear previous key value when selecting new key
      keyValue: null,
      keyType: null,
      keyTTL: null,
    });
  },

  setKeyValue: (value, type = null, ttl = null) => {
    set({ keyValue: value, keyType: type, keyTTL: ttl });
  },

  clearSelectedKey: () => {
    set({ 
      selectedKey: null, 
      keyValue: null,
      keyType: null,
      keyTTL: null,
    });
  },

  // Scan actions
  setScanPattern: (pattern) => {
    set({ scanPattern: pattern });
    get().resetScan();
  },

  resetScan: () => {
    set({
      scanCursor: 0,
      scannedKeys: [],
      scanLoading: false,
      scanComplete: false,
      groupedKeys: new Map(),
    });
  },

  fetchNextPage: async (count = 100) => {
    const { connectionId, scanCursor, scanPattern, scanComplete, scanLoading } = get();
    
    if (!connectionId || scanComplete || scanLoading) return;

    set({ scanLoading: true });

    try {
      const result = await invoke<{ type: string; data: ScanResult }>("keyvalue_execute", {
        connId: connectionId,
        operation: {
          type: "scan",
          pattern: scanPattern,
          cursor: scanCursor,
          count,
        },
      });

      if (result.type === "scan") {
        const { cursor: newCursor, keys } = result.data;
        
        set((state) => {
          const allKeys = [...state.scannedKeys, ...keys];
          const groups = computeGroups(allKeys);

          return {
            scannedKeys: allKeys,
            scanCursor: newCursor,
            scanComplete: newCursor === 0,
            scanLoading: false,
            groupedKeys: groups,
          };
        });
      }
    } catch (err) {
      console.error("Failed to scan keys:", err);
      set({ scanLoading: false });
    }
  },

  // Database info actions
  setDatabaseSize: (index, size) => {
    set((state) => {
      const newSizes = new Map(state.databaseSizes);
      newSizes.set(index, size);
      return { databaseSizes: newSizes };
    });
  },

  setDatabaseSizes: (sizes) => {
    set({ databaseSizes: sizes });
  },

  reset: () => {
    set({
      ...initialState,
      databaseSizes: new Map(),
    });
  },
}));


