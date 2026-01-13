/**
 * MongoDB-specific state store
 * 
 * Manages MongoDB session context, aggregation pipeline builder state,
 * and collection-level caching for the active connection.
 */

import { create } from "zustand";
import type { AggregationStage, CollectionInfo, CollectionStats } from "@/adapters/types/mongodb";

// ============ Types ============

export interface SessionInfo {
  id: string;
  startedAt: Date;
  transactionState: 'none' | 'starting' | 'in_progress' | 'committed' | 'aborted';
}

export interface MongoStoreState {
  // Current context
  currentDatabase: string | null;
  currentCollection: string | null;

  // Sessions for transactions
  activeSessions: Map<string, SessionInfo>;

  // Aggregation builder state
  aggregationPipeline: AggregationStage[];
  aggregationResult: object[] | null;
  aggregationError: string | null;

  // Collection cache
  collections: CollectionInfo[];
  collectionStats: Map<string, CollectionStats>;
  collectionsLoading: boolean;

  // Actions
  setCurrentDatabase: (db: string | null) => void;
  setCurrentCollection: (collection: string | null) => void;
  
  // Aggregation actions
  setAggregationPipeline: (pipeline: AggregationStage[]) => void;
  addAggregationStage: (stage: AggregationStage) => void;
  updateAggregationStage: (index: number, stage: AggregationStage) => void;
  removeAggregationStage: (index: number) => void;
  moveAggregationStage: (fromIndex: number, toIndex: number) => void;
  clearAggregationPipeline: () => void;
  setAggregationResult: (result: object[] | null, error?: string | null) => void;

  // Collection actions
  setCollections: (collections: CollectionInfo[]) => void;
  setCollectionsLoading: (loading: boolean) => void;
  updateCollectionStats: (collection: string, stats: CollectionStats) => void;

  // Session actions
  addSession: (session: SessionInfo) => void;
  removeSession: (sessionId: string) => void;
  updateSessionState: (sessionId: string, state: SessionInfo['transactionState']) => void;

  // Reset
  reset: () => void;
}

// ============ Initial State ============

const initialState = {
  currentDatabase: null as string | null,
  currentCollection: null as string | null,
  activeSessions: new Map<string, SessionInfo>(),
  aggregationPipeline: [] as AggregationStage[],
  aggregationResult: null as object[] | null,
  aggregationError: null as string | null,
  collections: [] as CollectionInfo[],
  collectionStats: new Map<string, CollectionStats>(),
  collectionsLoading: false,
};

// ============ Store ============

export const useMongoStore = create<MongoStoreState>()((set) => ({
  ...initialState,

  setCurrentDatabase: (db) => {
    set({ 
      currentDatabase: db, 
      currentCollection: null,
      collections: [],
      aggregationPipeline: [],
      aggregationResult: null,
      aggregationError: null,
    });
  },

  setCurrentCollection: (collection) => {
    set({ 
      currentCollection: collection,
      aggregationPipeline: [],
      aggregationResult: null,
      aggregationError: null,
    });
  },

  // Aggregation actions
  setAggregationPipeline: (pipeline) => {
    set({ aggregationPipeline: pipeline });
  },

  addAggregationStage: (stage) => {
    set((state) => ({
      aggregationPipeline: [...state.aggregationPipeline, stage],
    }));
  },

  updateAggregationStage: (index, stage) => {
    set((state) => {
      const newPipeline = [...state.aggregationPipeline];
      newPipeline[index] = stage;
      return { aggregationPipeline: newPipeline };
    });
  },

  removeAggregationStage: (index) => {
    set((state) => ({
      aggregationPipeline: state.aggregationPipeline.filter((_, i) => i !== index),
    }));
  },

  moveAggregationStage: (fromIndex, toIndex) => {
    set((state) => {
      const newPipeline = [...state.aggregationPipeline];
      const [removed] = newPipeline.splice(fromIndex, 1);
      if (removed) {
        newPipeline.splice(toIndex, 0, removed);
      }
      return { aggregationPipeline: newPipeline };
    });
  },

  clearAggregationPipeline: () => {
    set({ 
      aggregationPipeline: [], 
      aggregationResult: null,
      aggregationError: null,
    });
  },

  setAggregationResult: (result, error = null) => {
    set({ aggregationResult: result, aggregationError: error });
  },

  // Collection actions
  setCollections: (collections) => {
    set({ collections });
  },

  setCollectionsLoading: (loading) => {
    set({ collectionsLoading: loading });
  },

  updateCollectionStats: (collection, stats) => {
    set((state) => {
      const newStats = new Map(state.collectionStats);
      newStats.set(collection, stats);
      return { collectionStats: newStats };
    });
  },

  // Session actions
  addSession: (session) => {
    set((state) => {
      const newSessions = new Map(state.activeSessions);
      newSessions.set(session.id, session);
      return { activeSessions: newSessions };
    });
  },

  removeSession: (sessionId) => {
    set((state) => {
      const newSessions = new Map(state.activeSessions);
      newSessions.delete(sessionId);
      return { activeSessions: newSessions };
    });
  },

  updateSessionState: (sessionId, transactionState) => {
    set((state) => {
      const session = state.activeSessions.get(sessionId);
      if (!session) return state;
      const newSessions = new Map(state.activeSessions);
      newSessions.set(sessionId, { ...session, transactionState });
      return { activeSessions: newSessions };
    });
  },

  reset: () => {
    set({
      ...initialState,
      activeSessions: new Map(),
      collectionStats: new Map(),
    });
  },
}));
