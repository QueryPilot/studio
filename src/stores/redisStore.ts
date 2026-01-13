/**
 * Redis-specific state store
 * 
 * Manages Redis connection context, key browser state, server info,
 * and scan pagination for the active connection.
 */

import { create } from "zustand";
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

export interface RedisStoreState {
  // Current context
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
  scanCursor: string;
  scanPattern: string;
  scannedKeys: KeyMetadata[];
  scanLoading: boolean;
  scanComplete: boolean;

  // Database info
  databaseSizes: Map<number, number>; // db index -> key count

  // Actions
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
  startScan: (pattern: string) => void;
  appendScannedKeys: (keys: KeyMetadata[], cursor: string, complete: boolean) => void;
  setScanLoading: (loading: boolean) => void;
  resetScan: () => void;

  // Database info actions
  setDatabaseSize: (index: number, size: number) => void;
  setDatabaseSizes: (sizes: Map<number, number>) => void;

  // Reset
  reset: () => void;
}

// ============ Initial State ============

const initialState = {
  currentDatabase: 0,
  serverInfo: null as RedisServerInfo | null,
  loadedModules: [] as ModuleInfo[],
  keyPatterns: [] as KeyPattern[],
  selectedKey: null as string | null,
  keyValue: null as RedisValue | null,
  keyType: null as RedisType | null,
  keyTTL: null as number | null,
  scanCursor: "0",
  scanPattern: "*",
  scannedKeys: [] as KeyMetadata[],
  scanLoading: false,
  scanComplete: false,
  databaseSizes: new Map<number, number>(),
};

// ============ Store ============

export const useRedisStore = create<RedisStoreState>()((set) => ({
  ...initialState,

  setCurrentDatabase: (index) => {
    set({ 
      currentDatabase: index,
      // Reset key browser state when switching databases
      selectedKey: null,
      keyValue: null,
      keyType: null,
      keyTTL: null,
      scanCursor: "0",
      scannedKeys: [],
      scanComplete: false,
      keyPatterns: [],
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
  },

  startScan: (pattern) => {
    set({
      scanPattern: pattern,
      scanCursor: "0",
      scannedKeys: [],
      scanLoading: true,
      scanComplete: false,
    });
  },

  appendScannedKeys: (keys, cursor, complete) => {
    set((state) => ({
      scannedKeys: [...state.scannedKeys, ...keys],
      scanCursor: cursor,
      scanComplete: complete,
      scanLoading: false,
    }));
  },

  setScanLoading: (loading) => {
    set({ scanLoading: loading });
  },

  resetScan: () => {
    set({
      scanCursor: "0",
      scannedKeys: [],
      scanLoading: false,
      scanComplete: false,
    });
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
