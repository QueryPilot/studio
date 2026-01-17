/**
 * Recent Items Store
 *
 * Tracks recently accessed tables, collections, and keys per connection
 * for context-aware AI features.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentItem {
  connectionId: string;
  type: "table" | "collection" | "key";
  name: string;
  timestamp: number;
}

interface RecentItemsStore {
  items: RecentItem[];

  // Add item to recent history
  addItem: (item: Omit<RecentItem, "timestamp">) => void;

  // Get recent items for a connection
  getRecentTables: (connectionId: string) => string[];
  getRecentCollections: (connectionId: string) => string[];
  getRecentKeys: (connectionId: string) => string[];

  // Clear all recent items for a connection
  clear: (connectionId: string) => void;

  // Clear all items
  clearAll: () => void;
}

export const useRecentItemsStore = create<RecentItemsStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        set((state) => {
          // Remove duplicate (same connection + type + name)
          const filtered = state.items.filter(
            (i) =>
              !(
                i.connectionId === item.connectionId &&
                i.name === item.name &&
                i.type === item.type
              )
          );

          // Add new item at the beginning with timestamp
          const newItems = [
            { ...item, timestamp: Date.now() },
            ...filtered,
          ].slice(0, 100); // Keep last 100 items total

          return { items: newItems };
        });
      },

      getRecentTables: (connectionId) => {
        return get()
          .items.filter((i) => i.connectionId === connectionId && i.type === "table")
          .map((i) => i.name)
          .slice(0, 5); // Return top 5
      },

      getRecentCollections: (connectionId) => {
        return get()
          .items.filter((i) => i.connectionId === connectionId && i.type === "collection")
          .map((i) => i.name)
          .slice(0, 5);
      },

      getRecentKeys: (connectionId) => {
        return get()
          .items.filter((i) => i.connectionId === connectionId && i.type === "key")
          .map((i) => i.name)
          .slice(0, 5);
      },

      clear: (connectionId) => {
        set((state) => ({
          items: state.items.filter((i) => i.connectionId !== connectionId),
        }));
      },

      clearAll: () => {
        set({ items: [] });
      },
    }),
    {
      name: "recent-items-store",
      version: 1,
    }
  )
);
