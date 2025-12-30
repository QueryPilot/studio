import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface FrecencyEntry {
  lastAccessed: number;
  accessCount: number;
}

interface FrecencyState {
  items: Record<string, FrecencyEntry>;
  recordAccess: (itemId: string) => void;
  clearHistory: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export function calculateFrecencyScore(entry: FrecencyEntry | undefined): number {
  if (!entry) return 0;

  const now = Date.now();
  const age = now - entry.lastAccessed;

  let recencyWeight: number;
  if (age < DAY_MS) {
    recencyWeight = 1.0;
  } else if (age < WEEK_MS) {
    recencyWeight = 0.7;
  } else if (age < MONTH_MS) {
    recencyWeight = 0.5;
  } else {
    recencyWeight = 0.3;
  }

  return entry.accessCount * recencyWeight;
}

export const useCommandPaletteFrecencyStore = create<FrecencyState>()(
  persist(
    (set) => ({
      items: {},

      recordAccess: (itemId: string) => {
        set((state) => ({
          items: {
            ...state.items,
            [itemId]: {
              lastAccessed: Date.now(),
              accessCount: (state.items[itemId]?.accessCount ?? 0) + 1,
            },
          },
        }));
      },

      clearHistory: () => {
        set({ items: {} });
      },
    }),
    {
      name: "command-palette-frecency",
    }
  )
);
