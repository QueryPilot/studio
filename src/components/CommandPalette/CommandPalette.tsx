import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconEye,
  IconMathFunction,
  IconLoader2,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQueryClient } from "@tanstack/react-query";

import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { contextService } from "@/services/contextService";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

import {
  openFunctionObject,
  openTableObject,
  openTableInSplitRight,
  openFunctionInSplitRight,
} from "@/utils/workbench/openers";
import { useUnifiedItems, type UnifiedItem } from "./useCommandPaletteQueries";
import { useFrecency } from "./useFrecency";

const MAX_RECENT_ITEMS_EMPTY = 12;
const MAX_RECENT_ITEMS_SEARCH = 8;
const MAX_RESULTS_PER_GROUP = 50;

// Fuse.js configuration for unified items
const UNIFIED_FUSE_OPTIONS: IFuseOptions<UnifiedItem> = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "keywords", weight: 0.3 },
    { name: "subtitle", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
};

type ItemGroup = "Recently Used" | "Tables" | "Views" | "Functions" | "Commands";

const GROUP_ORDER: ItemGroup[] = [
  "Recently Used",
  "Tables",
  "Views",
  "Functions",
  "Commands",
];

function getItemGroup(item: UnifiedItem): ItemGroup {
  switch (item.type) {
    case "table":
      return "Tables";
    case "view":
    case "materializedView":
      return "Views";
    case "function":
      return "Functions";
    case "command":
      return "Commands";
  }
}

function getItemIcon(item: UnifiedItem): React.ReactNode {
  switch (item.type) {
    case "table":
      return <IconTable className="text-orange-500" />;
    case "view":
      return <IconEye className="text-green-500" />;
    case "materializedView":
      return <IconEye className="text-blue-500" />;
    case "function":
      return <IconMathFunction className="text-purple-500" />;
    case "command":
      return <IconTerminal2 className="text-muted-foreground" />;
  }
}

export function CommandPalette(): React.ReactElement {
  const queryClient = useQueryClient();
  const services = useKeyboardServicesOptional();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");

  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const query = useCommandPaletteStore((state) => state.query);
  const setQuery = useCommandPaletteStore((state) => state.setQuery);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);
  const openPalette = useCommandPaletteStore((state) => state.openPalette);

  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId
  );
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database
  );

  const { unifiedItems, isLoading } = useUnifiedItems();
  const { recordAccess, getTopFrecencyItems, sortByFrecency } =
    useFrecency();

  // Invalidate cache when commands or keybindings change
  useEffect(() => {
    if (!services) return;

    const { commandService, keybindingService } = services;

    const disposers = [
      commandService.onDidRegister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      commandService.onDidUnregister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidRegister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidUnregister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
      keybindingService.onDidChange(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
      }),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [services, queryClient]);

  useEffect(() => {
    contextService.setValue("inQuickOpen", isOpen);
    contextService.setValue("inCommandPalette", isOpen);

    return () => {
      if (!isOpen) {
        contextService.setValue("inQuickOpen", false);
        contextService.setValue("inCommandPalette", false);
      }
    };
  }, [isOpen]);

  const searchQuery = query.trim().toLowerCase();

  // Get recently used items
  const recentItems = useMemo(() => {
    const limit = searchQuery ? MAX_RECENT_ITEMS_SEARCH : MAX_RECENT_ITEMS_EMPTY;

    if (!searchQuery) {
      return getTopFrecencyItems(unifiedItems, limit);
    }

    // When searching, filter recent items by query match
    const fuse = new Fuse(unifiedItems, UNIFIED_FUSE_OPTIONS);
    const searchResults = fuse.search(searchQuery);
    const matchedIds = new Set(searchResults.map((r) => r.item.id));

    return getTopFrecencyItems(
      unifiedItems.filter((item) => matchedIds.has(item.id)),
      limit
    );
  }, [unifiedItems, searchQuery, getTopFrecencyItems]);

  const recentItemIds = useMemo(
    () => new Set(recentItems.map((item) => item.id)),
    [recentItems]
  );

  // Get grouped items (excluding recent)
  const groupedItems = useMemo(() => {
    let itemsToGroup = unifiedItems.filter((item) => !recentItemIds.has(item.id));

    if (searchQuery) {
      const fuse = new Fuse(itemsToGroup, UNIFIED_FUSE_OPTIONS);
      const results = fuse.search(searchQuery);
      itemsToGroup = results.map((r) => r.item);
    }

    // Group by type
    const groups = new Map<ItemGroup, UnifiedItem[]>();
    for (const item of itemsToGroup) {
      const group = getItemGroup(item);
      const existing = groups.get(group);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(group, [item]);
      }
    }

    // Sort within groups by frecency then alphabetically
    for (const [group, items] of groups) {
      groups.set(
        group,
        sortByFrecency(items).slice(0, MAX_RESULTS_PER_GROUP)
      );
    }

    return GROUP_ORDER.filter((group) => group !== "Recently Used" && groups.has(group)).map(
      (group) => {
        const items = groups.get(group);
        return [group, items ?? []] as [ItemGroup, UnifiedItem[]];
      }
    );
  }, [unifiedItems, searchQuery, recentItemIds, sortByFrecency]);

  // Scroll to top when results change
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [recentItems, groupedItems]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
      } else {
        openPalette();
      }
    },
    [closePalette, openPalette]
  );

  const handleSelect = useCallback(
    async (value: string, openInSplit: boolean) => {
      const item = unifiedItems.find((i) => i.id === value);
      if (!item) {
        closePalette();
        return;
      }

      // Record usage for frecency
      recordAccess(item.id);

      if (item.type === "command" && item.command) {
        if (!services) return;
        try {
          await services.commandService.execute(item.command.id);
        } finally {
          closePalette();
        }
        return;
      }

      if (!activeConnectionId) {
        closePalette();
        return;
      }

      if (item.type === "function" && item.func) {
        if (openInSplit) {
          openFunctionInSplitRight({
            func: item.func,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
          });
        } else {
          openFunctionObject({
            func: item.func,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
          });
        }
      } else if (item.table) {
        if (openInSplit) {
          openTableInSplitRight({
            table: item.table,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
            viewType: "data",
          });
        } else {
          openTableObject({
            table: item.table,
            connectionId: activeConnectionId,
            database: selectedDatabase || "#invalid_database",
            viewType: "data",
          });
        }
      }

      closePalette();
    },
    [
      unifiedItems,
      activeConnectionId,
      closePalette,
      services,
      selectedDatabase,
      recordAccess,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedValue) {
          void handleSelect(selectedValue, true);
        }
      }
    },
    [selectedValue, handleSelect]
  );

  if (!services) {
    return <></>;
  }

  const emptyMessage = isLoading
    ? ""
    : searchQuery
      ? "No results found."
      : "No items available.";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      onKeyDown={handleKeyDown}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder="Search tables, commands, and more..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
            <IconLoader2 className="size-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            <CommandEmpty>{emptyMessage}</CommandEmpty>

            {recentItems.length > 0 && (
              <CommandGroup heading="Recently Used">
                {recentItems.map((item) => (
                  <UnifiedItemRow
                    key={item.id}
                    item={item}
                    onSelect={(id) => handleSelect(id, false)}
                  />
                ))}
              </CommandGroup>
            )}

            {recentItems.length > 0 && groupedItems.length > 0 && (
              <CommandSeparator />
            )}

            {groupedItems.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => (
                  <UnifiedItemRow
                    key={item.id}
                    item={item}
                    onSelect={(id) => handleSelect(id, false)}
                  />
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
      <CommandFooter />
    </CommandDialog>
  );
}

interface UnifiedItemRowProps {
  item: UnifiedItem;
  onSelect: (id: string) => void;
}

function UnifiedItemRow({ item, onSelect }: UnifiedItemRowProps) {
  return (
    <CommandItem value={item.id} onSelect={onSelect}>
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2 flex-1 truncate">
          {getItemIcon(item)}
          <span className="font-medium">{item.name}</span>
          {item.schema && (
            <span className="text-muted-foreground text-xs">{item.schema}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground text-right max-w-1/3 truncate">
          {item.type === "command" && item.command?.keybinding ? (
            <KbdGroup>
              {item.command.keybinding.resolvedLabel.split("+").map((key, i) => (
                <Kbd key={i}>{key.trim()}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            item.subtitle
          )}
        </div>
      </div>
    </CommandItem>
  );
}
