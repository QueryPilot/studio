import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconEye,
  IconMathFunction,
  IconLoader2,
  IconTable,
} from "@tabler/icons-react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useQueryClient } from "@tanstack/react-query";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
import { cn } from "@/lib/utils";
import {
  useCommands,
  useQuickOpenItems,
  type CategorizedCommand,
  type QuickOpenItem,
} from "./useCommandPaletteQueries";

type QuickOpenGroup = "Tables" | "Views" | "Functions";

const QUICK_OPEN_GROUP_ORDER: QuickOpenGroup[] = [
  "Tables",
  "Views",
  "Functions",
];
const MAX_QUICK_OPEN_RESULTS = 100;

// Fuse.js configuration for commands
const COMMAND_FUSE_OPTIONS: IFuseOptions<CategorizedCommand> = {
  keys: [
    { name: "label", weight: 0.7 },
    { name: "description", weight: 0.2 },
    { name: "id", weight: 0.1 },
  ],
  threshold: 0.3, // Lower = more strict matching
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
};
// Fuse.js configuration for quick open items
const QUICK_OPEN_FUSE_OPTIONS: IFuseOptions<QuickOpenItem> = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "schema", weight: 0.3 },
    { name: "searchKey", weight: 0.1 },
  ],
  threshold: 0.4, // Slightly more lenient for database objects
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
};

export function CommandPalette(): React.ReactElement {
  const queryClient = useQueryClient();
  const services = useKeyboardServicesOptional();
  const listRef = React.useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");

  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  const mode = useCommandPaletteStore((state) => state.mode);
  const origin = useCommandPaletteStore((state) => state.origin);
  const query = useCommandPaletteStore((state) => state.query);
  const setQuery = useCommandPaletteStore((state) => state.setQuery);
  const setMode = useCommandPaletteStore((state) => state.setMode);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);
  const openQuickOpen = useCommandPaletteStore((state) => state.openQuickOpen);
  const openCommandPalette = useCommandPaletteStore(
    (state) => state.openCommandPalette,
  );

  const activeConnectionId = useWorkspaceSelectionStore(
    (state) => state.connectionId,
  );
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );

  // Use React Query to fetch and cache commands
  const { data: commands = [], isLoading: isLoadingCommands } = useCommands();

  // Invalidate cache when commands or keybindings change
  useEffect(() => {
    // Don't set up listeners if services aren't ready (happens during HMR)
    if (!services) {
      return;
    }

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
        void queryClient.invalidateQueries({
          queryKey: ["keybindings", "list"],
        });
      }),
      keybindingService.onDidUnregister(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
        void queryClient.invalidateQueries({
          queryKey: ["keybindings", "list"],
        });
      }),
      keybindingService.onDidChange(() => {
        void queryClient.invalidateQueries({ queryKey: ["commands", "list"] });
        void queryClient.invalidateQueries({
          queryKey: ["keybindings", "list"],
        });
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
    contextService.setValue("inCommandPalette", isOpen && mode === "command");

    return () => {
      if (!isOpen) {
        contextService.setValue("inQuickOpen", false);
        contextService.setValue("inCommandPalette", false);
      }
    };
  }, [isOpen, mode]);

  const availabilityMessage = useMemo(() => {
    if (!activeConnectionId) {
      return "Connect to a database to browse objects.";
    }
    if (!selectedDatabase) {
      return "Select a database to browse objects.";
    }

    return null;
  }, [activeConnectionId, selectedDatabase]);

  const shouldLoadQuickOpen =
    isOpen &&
    mode === "quickOpen" &&
    availabilityMessage === null &&
    Boolean(activeConnectionId);

  // Use React Query to fetch and cache quick open items
  const { quickItems, isLoading: isQuickOpenLoading } = useQuickOpenItems();

  const quickItemsById = useMemo(() => {
    const map = new Map<string, QuickOpenItem>();
    for (const item of quickItems) {
      map.set(item.id, item);
    }
    return map;
  }, [quickItems]);

  const quickQuery = mode === "quickOpen" ? query.trim().toLowerCase() : "";

  const filteredQuickItems = useMemo(() => {
    if (!shouldLoadQuickOpen) {
      return [];
    }

    if (!quickQuery) {
      return quickItems.slice(0, MAX_QUICK_OPEN_RESULTS);
    }

    const fuse = new Fuse(quickItems, QUICK_OPEN_FUSE_OPTIONS);
    const results = fuse.search(quickQuery);

    return results
      .slice(0, MAX_QUICK_OPEN_RESULTS)
      .map((result) => result.item);
  }, [quickItems, quickQuery, shouldLoadQuickOpen]);

  const quickGroups = useMemo(() => {
    const groups = new Map<QuickOpenGroup, QuickOpenItem[]>();
    for (const item of filteredQuickItems) {
      if (!groups.has(item.group)) {
        groups.set(item.group, []);
      }
      groups.get(item.group)?.push(item);
    }

    return QUICK_OPEN_GROUP_ORDER.filter((group) => groups.has(group)).map(
      (group) =>
        [
          group,
          groups
            .get(group)
            ?.sort((left, right) => left.name.localeCompare(right.name)) ?? [],
        ] satisfies [QuickOpenGroup, QuickOpenItem[]],
    );
  }, [filteredQuickItems]);

  const commandQuery = mode === "command" ? query.replace(/^>/, "").trim() : "";

  const filteredCommands = useMemo(() => {
    if (isLoadingCommands) {
      return [];
    }

    if (!commandQuery) {
      return commands;
    }

    const fuse = new Fuse(commands, COMMAND_FUSE_OPTIONS);
    const results = fuse.search(commandQuery);

    return results.map((result) => result.item);
  }, [commands, commandQuery, isLoadingCommands]);

  const commandGroups = useMemo(() => {
    if (isLoadingCommands || filteredCommands.length === 0) {
      return [];
    }
    return groupCommands(filteredCommands);
  }, [filteredCommands, isLoadingCommands]);

  // Scroll to top when results change
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [commandGroups, quickGroups]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
      } else if (mode === "command") {
        openCommandPalette();
      } else {
        openQuickOpen();
      }
    },
    [closePalette, mode, openCommandPalette, openQuickOpen],
  );

  const handleValueChange = (value: string) => {
    if (mode === "quickOpen") {
      if (value.startsWith(">")) {
        setMode("command");
        setQuery(value.startsWith(">") ? value : `>${value}`);
      } else {
        setQuery(value);
      }
      return;
    }

    // Command mode
    if (!value.startsWith(">")) {
      if (origin === "quickOpen") {
        setMode("quickOpen");
        setQuery(value);
        return;
      }
      const enforced = value === "" ? ">" : `>${value}`;
      setQuery(enforced);
      return;
    }

    setQuery(value);
  };

  const handleSelect = useCallback(
    async (value: string, openInSplit = false) => {
      if (mode === "command") {
        if (!services) return;
        try {
          await services.commandService.execute(value);
        } finally {
          closePalette();
        }
        return;
      }

      if (!activeConnectionId) {
        closePalette();
        return;
      }

      const item = quickItemsById.get(value);
      if (!item) {
        closePalette();
        return;
      }

      if (item.entityType === "function") {
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
      } else {
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
      activeConnectionId,
      closePalette,
      services,
      mode,
      quickItemsById,
      selectedDatabase,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) opens in split right panel
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedValue && mode === "quickOpen") {
          void handleSelect(selectedValue, true);
        }
      }
    },
    [selectedValue, mode, handleSelect],
  );

  const placeholder =
    mode === "quickOpen"
      ? "Search tables, views, and functions… (type '>' for commands)"
      : "Type a command…";

  const commandEmptyMessage =
    mode === "command" && !isLoadingCommands
      ? filteredCommands.length > 0
        ? ""
        : commandQuery
        ? "No commands found for this search."
        : "No commands registered."
      : "";

  const quickEmptyMessage =
    mode === "quickOpen" && !isQuickOpenLoading
      ? availabilityMessage ??
        (filteredQuickItems.length > 0
          ? ""
          : quickQuery
          ? "No database objects match your search."
          : "No database objects available in this schema.")
      : "";

  // Don't render if services aren't ready yet (happens during HMR)
  if (!services) {
    return <></>;
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      onKeyDown={handleKeyDown}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder={placeholder}
        value={query}
        onValueChange={handleValueChange}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>
          {mode === "command" ? commandEmptyMessage : quickEmptyMessage}
        </CommandEmpty>

        {mode === "command" ? (
          isLoadingCommands ? (
            <ListSpinner message="Loading commands…" />
          ) : (
            commandGroups.map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    onSelect={handleSelect}
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="font-medium flex-1 truncate">
                        {command.label}
                      </div>
                      {command.description ? (
                        <div className="text-muted-foreground text-right max-w-1/3 truncate">
                          {command.description}
                        </div>
                      ) : null}
                    </div>
                    {command.keybinding ? (
                      <KbdGroup className="ml-auto">
                        {command.keybinding.resolvedLabel
                          .split("+")
                          .map((key, index) => (
                            <Kbd key={index}>{key.trim()}</Kbd>
                          ))}
                      </KbdGroup>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))
          )
        ) : shouldLoadQuickOpen ? (
          isQuickOpenLoading ? (
            <ListSpinner message="Loading database objects…" />
          ) : (
            quickGroups.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={handleSelect}
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="text-xs font-medium flex items-center gap-2 flex-1 truncate">
                        {item.entityType === "function" ? (
                          <IconMathFunction className="text-purple-500" />
                        ) : item.entityType === "materializedView" ||
                          item.entityType === "view" ? (
                          <IconEye
                            className={cn({
                              "text-green-500": item.entityType === "view",
                              "text-blue-500":
                                item.entityType === "materializedView",
                            })}
                          />
                        ) : (
                          <IconTable className="text-primary" />
                        )}
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground text-right max-w-1/3 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))
          )
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

function groupCommands(
  commands: CategorizedCommand[],
): [string, CategorizedCommand[]][] {
  const groups = new Map<string, CategorizedCommand[]>();

  for (const command of commands) {
    const category = command.category ?? "General";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)?.push(command);
  }

  return Array.from(groups.entries()).map(([category, items]) => [
    category,
    items.sort((left, right) => left.label.localeCompare(right.label)),
  ]);
}

interface ListSpinnerProps {
  message: string;
}

function ListSpinner({ message }: ListSpinnerProps) {
  return (
    <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
      <IconLoader2 className="size-4 animate-spin" />
      {message}
    </div>
  );
}
