import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconEye,
  IconMathFunction,
  IconLoader2,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useKeyboardServicesOptional } from "@/components/KeyboardProvider";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { contextService } from "@/services/contextService";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { windowManager } from "@/services/windowManager";
import { vaultStorage } from "@/services/vaultStorage";

import {
  openFunctionObject,
  openTableObject,
  openTableInSplitRight,
  openFunctionInSplitRight,
} from "@/utils/workbench/openers";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { useUnifiedItems, type UnifiedItem } from "./useCommandPaletteQueries";
import { useFrecency } from "./useFrecency";
import { NestedDatabaseList } from "./NestedDatabaseList";
import { NestedSchemaList } from "./NestedSchemaList";
import { NestedConnectionList } from "./NestedConnectionList";
import { NestedWorkspaceList } from "./NestedWorkspaceList";
import { ActionsPopover } from "./ActionsPopover";
import {
  useItemActions,
  getNestedDatabaseActions,
  getNestedSchemaActions,
  executeDatabaseAction,
  executeSchemaAction,
  type ActionContext,
} from "./useItemActions";

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
  threshold: 0.35,
  ignoreLocation: true,
  findAllMatches: true,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
};

type ItemGroup =
  | "Recently Used"
  | "Theme"
  | "Tables"
  | "Views"
  | "Functions"
  | "Commands";

const GROUP_ORDER: ItemGroup[] = [
  "Recently Used",
  "Theme",
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
      if (
        item.command?.metadata?.paletteGroup === "Theme"
      ) {
        return "Theme";
      }
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
      if (item.command?.icon) {
        return item.command.icon;
      }
      return <IconTerminal2 className="text-muted-foreground" />;
  }
}

export function CommandPalette(): React.ReactElement {
  const queryClient = useQueryClient();
  const services = useKeyboardServicesOptional();
  const listRef = React.useRef<HTMLDivElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [actionsOpen, setActionsOpen] = useState(false);

  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const query = useCommandPaletteStore((state) => state.query);
  const setQuery = useCommandPaletteStore((state) => state.setQuery);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);
  const openPalette = useCommandPaletteStore((state) => state.openPalette);
  const nestedMode = useCommandPaletteStore((state) => state.nestedMode);
  const exitNestedMode = useCommandPaletteStore(
    (state) => state.exitNestedMode,
  );
  const undo = useCommandPaletteStore((state) => state.undo);
  const redo = useCommandPaletteStore((state) => state.redo);

  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId,
  );
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );
  const currentSchema = useWorkspaceSelectionStore((state) => state.schema);
  const setSchema = useWorkspaceSelectionStore((state) => state.setSchema);

  const { unifiedItems, isLoading, connectionCount } = useUnifiedItems();
  const { recordAccess, getTopFrecencyItems, sortByFrecency } = useFrecency();

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
    const limit = searchQuery
      ? MAX_RECENT_ITEMS_SEARCH
      : MAX_RECENT_ITEMS_EMPTY;

    if (!searchQuery) {
      return getTopFrecencyItems(unifiedItems, limit);
    }

    // When searching, filter recent items by query match
    const fuse = new Fuse(unifiedItems, UNIFIED_FUSE_OPTIONS);
    const searchResults = fuse.search(searchQuery);
    const matchedIds = new Set(searchResults.map((r) => r.item.id));

    return getTopFrecencyItems(
      unifiedItems.filter((item) => matchedIds.has(item.id)),
      limit,
    );
  }, [unifiedItems, searchQuery, getTopFrecencyItems]);

  const recentItemIds = useMemo(
    () => new Set(recentItems.map((item) => item.id)),
    [recentItems],
  );

  // Get grouped items (excluding recent)
  const groupedItems = useMemo(() => {
    let itemsToGroup = unifiedItems.filter(
      (item) => !recentItemIds.has(item.id),
    );

    // Track Fuse scores when searching
    let scoreMap: Map<string, number> | null = null;

    if (searchQuery) {
      const fuse = new Fuse(itemsToGroup, UNIFIED_FUSE_OPTIONS);
      const results = fuse.search(searchQuery);
      // Store scores for sorting (lower score = better match)
      scoreMap = new Map(results.map((r) => [r.item.id, r.score ?? 1]));
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

    // Sort within groups
    for (const [group, items] of groups) {
      let sortedItems: UnifiedItem[];
      if (scoreMap) {
        // When searching, sort by Fuse score (relevance)
        const scores = scoreMap; // Capture for closure
        sortedItems = [...items].sort((a, b) => {
          const scoreA = scores.get(a.id) ?? 1;
          const scoreB = scores.get(b.id) ?? 1;
          return scoreA - scoreB;
        });
      } else {
        // When not searching, sort by frecency
        sortedItems = sortByFrecency(items);
      }
      groups.set(group, sortedItems.slice(0, MAX_RESULTS_PER_GROUP));
    }

    return GROUP_ORDER.filter(
      (group) => group !== "Recently Used" && groups.has(group),
    ).map((group) => {
      const items = groups.get(group);
      return [group, items ?? []] as [ItemGroup, UnifiedItem[]];
    });
  }, [unifiedItems, searchQuery, recentItemIds, sortByFrecency]);

  // Find the selected item for actions
  const selectedItem = useMemo(() => {
    if (!selectedValue) return null;
    return unifiedItems.find((item) => item.id === selectedValue) ?? null;
  }, [selectedValue, unifiedItems]);

  // Get actions for the selected item
  const { actions: itemActions, executeAction } = useItemActions(
    selectedItem,
    closePalette,
  );

  const firstVisibleItemId = useMemo(() => {
    if (nestedMode) return "";
    if (recentItems.length > 0) return recentItems[0].id;
    for (const [, items] of groupedItems) {
      if (items.length > 0) return items[0].id;
    }
    return "";
  }, [nestedMode, recentItems, groupedItems]);

  // Get actions for nested mode
  const nestedActions = useMemo(() => {
    if (!nestedMode) return [];

    const currentConnection = activeConnectionId
      ? useConnectionStore.getState().getConnection(activeConnectionId)
      : null;
    const dbType = currentConnection?.profile.db_type ?? null;

    if (nestedMode.type === "switch-database") {
      return getNestedDatabaseActions(dbType, query);
    }
    if (nestedMode.type === "switch-schema") {
      return getNestedSchemaActions(dbType, query);
    }
    return [];
  }, [nestedMode, activeConnectionId, query]);

  // Combined actions - use nested actions when in nested mode, otherwise item actions
  const actions = nestedMode ? nestedActions : itemActions;

  // Get the current connection for nested action context
  const currentConnection = useConnectionStore((state) =>
    activeConnectionId ? state.getConnection(activeConnectionId) : undefined,
  );

  // Handler for executing nested actions
  const executeNestedAction = useCallback(
    (actionId: string) => {
      const context: ActionContext = {
        connectionId: activeConnectionId,
        database: selectedDatabase,
        schema: currentSchema,
        dbType: currentConnection?.profile.db_type ?? null,
        closePalette,
      };

      if (nestedMode?.type === "switch-database") {
        executeDatabaseAction(actionId, query, context);
      } else if (nestedMode?.type === "switch-schema") {
        executeSchemaAction(actionId, query, context);
      }
    },
    [
      activeConnectionId,
      selectedDatabase,
      currentSchema,
      currentConnection,
      closePalette,
      nestedMode,
      query,
    ],
  );

  // Use appropriate action handler based on mode
  const handleActionExecute = nestedMode ? executeNestedAction : executeAction;

  // Close actions popover when palette closes or selection changes
  useEffect(() => {
    if (!isOpen) {
      setActionsOpen(false);
    }
  }, [isOpen]);

  // Reset selection and scroll when results or query change
  useEffect(() => {
    if (!isOpen) return;
    if (nestedMode) {
      setSelectedValue((current) => (current === "" ? current : ""));
      listRef.current?.scrollTo({ top: 0 });
      return;
    }

    setSelectedValue((current) => {
      if (!firstVisibleItemId) return "";
      if (current === firstVisibleItemId) return current;
      return firstVisibleItemId;
    });

    listRef.current?.scrollTo({ top: 0 });
  }, [isOpen, nestedMode, query, firstVisibleItemId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
      } else {
        openPalette();
      }
    },
    [closePalette, openPalette],
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
        await services.commandService.execute(item.command.id);
        // Don't close palette if command entered nested mode
        const currentNestedMode = useCommandPaletteStore.getState().nestedMode;
        if (!currentNestedMode) {
          closePalette();
        }
        return;
      }

      // Use the item's connection context (not the active/focused connection)
      const itemConnectionId = item.connectionId;
      const itemDatabase = item.database;

      if (!itemConnectionId || !itemDatabase) {
        closePalette();
        return;
      }

      if (item.type === "function" && item.func) {
        if (openInSplit) {
          openFunctionInSplitRight({
            func: item.func,
            connectionId: itemConnectionId,
            database: itemDatabase,
          });
        } else {
          openFunctionObject({
            func: item.func,
            connectionId: itemConnectionId,
            database: itemDatabase,
          });
        }
      } else if (item.table) {
        if (openInSplit) {
          openTableInSplitRight({
            table: item.table,
            connectionId: itemConnectionId,
            database: itemDatabase,
            viewType: "data",
          });
        } else {
          openTableObject({
            table: item.table,
            connectionId: itemConnectionId,
            database: itemDatabase,
            viewType: "data",
          });
        }
      }

      closePalette();
    },
    [
      unifiedItems,
      closePalette,
      services,
      recordAccess,
    ],
  );

  // Database selection is now handled by NestedDatabaseList using add-to-workspace flow.
  // This callback is called after successful selection to close the palette.
  const handleDatabaseSelect = useCallback(
    (_database: string) => {
      closePalette();
    },
    [closePalette],
  );

  const handleSchemaSelect = useCallback(
    async (schema: string) => {
      if (!activeConnectionId) return;
      try {
        await databaseService.switchSchema(activeConnectionId, schema);
        setSchema(schema);
        closePalette();
      } catch (err) {
        console.error("Failed to switch schema:", err);
        toast.error("Failed to switch schema");
      }
    },
    [activeConnectionId, setSchema, closePalette],
  );

  const handleConnectionSelect = useCallback(
    async (connectionId: string) => {
      try {
        const connection = await vaultStorage.getConnection(connectionId);
        if (!connection) {
          toast.error("Connection not found");
          return;
        }
        await windowManager.openWorkspace(
          connectionId,
          connection.profile.name,
        );
        closePalette();
      } catch (err) {
        console.error("Failed to open connection:", err);
        toast.error("Failed to open connection");
      }
    },
    [closePalette],
  );

  const handleWorkspaceSelect = useCallback(
    async (workspaceId: string) => {
      try {
        const ws = useWorkspaceBundleStore
          .getState()
          .savedWorkspaces.find((w) => w.id === workspaceId);
        await windowManager.openNamedWorkspace(
          workspaceId,
          ws?.name ?? "Workspace",
        );
        closePalette();
      } catch (err) {
        console.error("Failed to open workspace:", err);
        toast.error("Failed to open workspace");
      }
    },
    [closePalette],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle undo/redo for the input
      if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      // Exit nested mode on backspace when query is empty
      if (e.key === "Backspace" && query === "" && nestedMode) {
        e.preventDefault();
        exitNestedMode();
        return;
      }

      // Toggle actions popover with ⌘K
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (actions.length > 0) {
          setActionsOpen((prev) => !prev);
        }
        return;
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedValue) {
          void handleSelect(selectedValue, true);
        }
      }
    },
    [
      selectedValue,
      handleSelect,
      query,
      nestedMode,
      exitNestedMode,
      actions,
      undo,
      redo,
    ],
  );

  if (!services) {
    return <></>;
  }

  const getInputPlaceholder = () => {
    if (!nestedMode) return "Search tables, commands, and more...";
    switch (nestedMode.type) {
      case "switch-database":
        return "Search databases...";
      case "switch-schema":
        return "Search schemas...";
      case "open-connection":
        return "Search connections...";
      case "switch-workspace":
        return "Search workspaces...";
    }
  };

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
      onValueChange={setSelectedValue}
      className="min-w-[560px]!"
    >
      <CommandInput
        placeholder={getInputPlaceholder()}
        value={query}
        onValueChange={setQuery}
        onBack={nestedMode ? exitNestedMode : undefined}
      />
      {nestedMode ? (
        <>
          {nestedMode.type === "switch-database" ? (
            <NestedDatabaseList
              listRef={listRef}
              query={query}
              onSelect={handleDatabaseSelect}
              onClose={closePalette}
            />
          ) : nestedMode.type === "switch-schema" ? (
            <NestedSchemaList
              listRef={listRef}
              query={query}
              onSelect={handleSchemaSelect}
            />
          ) : nestedMode.type === "switch-workspace" ? (
            <NestedWorkspaceList
              listRef={listRef}
              query={query}
              onSelect={handleWorkspaceSelect}
            />
          ) : (
            <NestedConnectionList
              listRef={listRef}
              query={query}
              onSelect={handleConnectionSelect}
              onClose={closePalette}
            />
          )}
          <ActionsPopover
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            actions={actions}
            onActionSelect={handleActionExecute}
            triggerRef={actionsButtonRef}
          >
            <CommandFooter
              actionsButtonRef={actionsButtonRef}
              onActionsClick={() => {
                setActionsOpen(true);
              }}
              showActions={actions.length > 0}
            />
          </ActionsPopover>
        </>
      ) : (
        <>
          <CommandList ref={listRef} className="h-[300px]">
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
                        showConnectionName={connectionCount > 1}
                      />
                    ))}
                  </CommandGroup>
                )}

                {groupedItems.map(([group, items]) => (
                  <CommandGroup key={group} heading={group}>
                    {items.map((item) => (
                      <UnifiedItemRow
                        key={item.id}
                        item={item}
                        onSelect={(id) => handleSelect(id, false)}
                        showConnectionName={connectionCount > 1}
                      />
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
          <ActionsPopover
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            actions={actions}
            onActionSelect={handleActionExecute}
            triggerRef={actionsButtonRef}
          >
            <CommandFooter
              actionsButtonRef={actionsButtonRef}
              onActionsClick={() => {
                setActionsOpen(true);
              }}
              showActions={actions.length > 0}
            />
          </ActionsPopover>
        </>
      )}
    </CommandDialog>
  );
}

interface UnifiedItemRowProps {
  item: UnifiedItem;
  onSelect: (id: string) => void;
  showConnectionName?: boolean;
}

/**
 * Build the badge text for database objects.
 * Format: "connection › schema" for multi-connection, just "schema" for single connection.
 * We skip database name since it typically matches connection name.
 */
function getBadgeText(item: UnifiedItem, showConnectionName: boolean): string {
  if (item.type === "command") {
    return item.subtitle; // keybinding label
  }

  const parts: string[] = [];

  if (showConnectionName && item.connectionName) {
    parts.push(item.connectionName);
  }

  if (item.schema) {
    parts.push(item.schema);
  }

  return parts.join(" › ");
}

function UnifiedItemRow({ item, onSelect, showConnectionName = false }: UnifiedItemRowProps) {
  const keywords = [
    item.name,
    item.subtitle,
    ...item.keywords,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const badgeText = getBadgeText(item, showConnectionName);
  const dbLogoPath = item.dbType ? getDatabaseLogo(item.dbType) : null;

  return (
    <CommandItem value={item.id} keywords={keywords} onSelect={onSelect}>
      <div className="flex justify-between items-center w-full">
        <div className="flex items-center gap-2 flex-1 truncate">
          {getItemIcon(item)}
          <span className="font-medium">{item.name}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground text-right max-w-[45%] truncate">
          {item.type === "command" && item.command?.keybinding ? (
            <KbdGroup>
              {item.command.keybinding.resolvedLabel
                .split("+")
                .map((key, i) => (
                  <Kbd key={i}>{key.trim()}</Kbd>
                ))}
            </KbdGroup>
          ) : (
            <>
              {dbLogoPath && showConnectionName && (
                <img
                  src={dbLogoPath}
                  alt={item.dbType || "Database"}
                  className="h-3.5 w-3.5 shrink-0"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <span className="truncate">{badgeText}</span>
            </>
          )}
        </div>
      </div>
    </CommandItem>
  );
}
