import { useCallback } from "react";
import {
  useCommandPaletteFrecencyStore,
  calculateFrecencyScore,
} from "@/stores/ui/commandPaletteFrecencyStore";

export function useFrecency() {
  const items = useCommandPaletteFrecencyStore((state) => state.items);
  const recordAccess = useCommandPaletteFrecencyStore((state) => state.recordAccess);

  const getFrecencyScore = useCallback(
    (itemId: string): number => {
      return calculateFrecencyScore(items[itemId]);
    },
    [items]
  );

  const sortByFrecency = useCallback(
    <T extends { id: string }>(itemList: T[]): T[] => {
      return [...itemList].sort((a, b) => {
        const scoreA = getFrecencyScore(a.id);
        const scoreB = getFrecencyScore(b.id);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        // Fallback to alphabetical by id
        return a.id.localeCompare(b.id);
      });
    },
    [getFrecencyScore]
  );

  const getTopFrecencyItems = useCallback(
    <T extends { id: string }>(itemList: T[], limit: number): T[] => {
      // Filter to items with scores first (typically very few), then sort
      // only those — avoids sorting thousands of zero-score items
      const scored: Array<{ item: T; score: number }> = [];
      for (const item of itemList) {
        const score = getFrecencyScore(item.id);
        if (score > 0) {
          scored.push({ item, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((entry) => entry.item);
    },
    [getFrecencyScore]
  );

  return {
    recordAccess,
    getFrecencyScore,
    sortByFrecency,
    getTopFrecencyItems,
  };
}
