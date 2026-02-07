import React, { useEffect, useMemo } from "react";
import {
  IconBookmark,
  IconLoader2,
  IconStarFilled,
} from "@tabler/icons-react";
import { matchSorter, rankings } from "match-sorter";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useQueryHistoryStore } from "@/stores/queryHistoryStore";
import type { SavedQuery } from "@/lib/db/queryHistory";

interface SavedQueryItem extends SavedQuery {
  preview: string;
}

interface NestedSavedQueriesListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (savedQuery: SavedQuery) => void;
  onClose: () => void;
}

export function NestedSavedQueriesList({
  listRef,
  query,
  onSelect,
}: NestedSavedQueriesListProps): React.ReactElement {
  const savedQueries = useQueryHistoryStore((state) => state.savedQueries);
  const isLoading = useQueryHistoryStore((state) => state.isLoading);
  const loadSavedQueries = useQueryHistoryStore(
    (state) => state.loadSavedQueries,
  );

  // Load saved queries on mount
  useEffect(() => {
    void loadSavedQueries();
  }, [loadSavedQueries]);

  // Build items with preview text
  const savedQueryItems = useMemo<SavedQueryItem[]>(() => {
    return savedQueries.map((sq) => ({
      ...sq,
      preview: sq.query.slice(0, 60).replace(/\s+/g, " "),
    }));
  }, [savedQueries]);

  // Sort by starred first, then by updated date
  const sortedItems = useMemo(() => {
    return [...savedQueryItems].sort((a, b) => {
      if (a.starred !== b.starred) return b.starred ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
  }, [savedQueryItems]);

  // Filter results based on search query
  const filteredQueries = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return sortedItems;
    }
    return matchSorter(sortedItems, trimmedQuery, {
      keys: [
        { key: "name", maxRanking: rankings.STARTS_WITH },
        { key: "query", maxRanking: rankings.WORD_STARTS_WITH },
        { key: "tags", maxRanking: rankings.WORD_STARTS_WITH },
        { key: "description", maxRanking: rankings.CONTAINS },
      ],
      threshold: rankings.MATCHES,
    });
  }, [sortedItems, query]);

  if (isLoading) {
    return (
      <CommandList ref={listRef} className="h-[300px]">
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
          <IconLoader2 className="size-4 animate-spin" />
          Loading saved queries...
        </div>
      </CommandList>
    );
  }

  return (
    <CommandList ref={listRef} className="h-[300px]">
      <CommandEmpty>
        {query.trim()
          ? "No saved queries match your search."
          : "No saved queries yet."}
      </CommandEmpty>

      {filteredQueries.length > 0 && (
        <CommandGroup heading="Saved Queries">
          {filteredQueries.map((item) => (
            <CommandItem
              key={item.id}
              value={item.id}
              keywords={[item.name, item.query, ...item.tags]}
              onSelect={() => {
                onSelect(item);
              }}
            >
              <div className="flex items-center justify-between w-full gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <IconBookmark className="size-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{item.name}</span>
                      {item.starred && (
                        <IconStarFilled className="size-3 text-yellow-500 shrink-0" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {item.preview}
                      {item.query.length > 60 && "..."}
                    </div>
                  </div>
                </div>
                {item.tags.length > 0 && (
                  <div className="flex gap-1 shrink-0">
                    {item.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 bg-muted rounded"
                      >
                        {tag}
                      </span>
                    ))}
                    {item.tags.length > 2 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{item.tags.length - 2}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </CommandList>
  );
}
