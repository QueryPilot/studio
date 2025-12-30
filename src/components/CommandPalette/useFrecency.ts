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
      return sortByFrecency(itemList)
        .filter((item) => getFrecencyScore(item.id) > 0)
        .slice(0, limit);
    },
    [sortByFrecency, getFrecencyScore]
  );

  return {
    recordAccess,
    getFrecencyScore,
    sortByFrecency,
    getTopFrecencyItems,
  };
}
