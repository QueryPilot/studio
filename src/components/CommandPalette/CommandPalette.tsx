/* eslint-disable @typescript-eslint/no-unsafe-return */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FunctionSquare, Loader2, Table } from "lucide-react";
import Fuse, { type IFuseOptions } from "fuse.js";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useKeyboardServices } from "@/components/KeyboardProvider";
import { useCommandPaletteStore } from "@/stores/ui/commandPaletteStore";
import { contextService } from "@/services/contextService";
import type { ResolvedKeybinding } from "@/types/keybinding";
import type { CommandDescriptor } from "@/types/command";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { useSchemaData } from "@/hooks/useSchemaData";
import { openFunctionObject, openTableObject } from "@/utils/workbench/openers";
import type { FunctionMeta, TableMeta } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/utils/formatters";

interface CategorizedCommand extends CommandDescriptor {
  keybinding?: ResolvedKeybinding;
}

type QuickOpenGroup = "Tables" | "Views" | "Functions";
type TableEntityType = "table" | "view" | "materializedView";
type QuickEntityType = TableEntityType | "function";

interface BaseQuickOpenItem {
  id: string;
  group: QuickOpenGroup;
  entityType: QuickEntityType;
  name: string;
  schema: string;
  searchKey: string;
  subtitle: string;
}

interface TableQuickOpenItem extends BaseQuickOpenItem {
  entityType: TableEntityType;
  table: TableMeta;
}

interface FunctionQuickOpenItem extends BaseQuickOpenItem {
  entityType: "function";
  func: FunctionMeta;
}

type QuickOpenItem = TableQuickOpenItem | FunctionQuickOpenItem;

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

const LOADING_STATE: CategorizedCommand[] = [
  {
    id: "__loading__",
    label: "Loading commands…",
    category: "System",
    source: "default",
  },
];

export function CommandPalette(): React.ReactElement {
  const { commandService, keybindingService } = useKeyboardServices();

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
    (state) => state.activeConnectionId,
  );
  const selectedDatabase = useWorkspaceSelectionStore((state) =>
    state.getSelectedDatabase(state.activeConnectionId),
  );
  const selectedSchema = useSchemaStore((state) => state.selectedSchema);

  const [commands, setCommands] = useState<CategorizedCommand[]>(LOADING_STATE);
  const [keybindingVersion, setKeybindingVersion] = useState(0);

  useEffect(() => {
    const updateCommands = () => {
      const descriptors = commandService.list();
      const keybindings = keybindingService.list();

      const enriched: CategorizedCommand[] = descriptors.map((descriptor) => ({
        ...descriptor,
        keybinding: resolveKeybindingForCommand(descriptor.id, keybindings),
      }));

      setCommands(enriched);
    };

    updateCommands();

    const disposers = [
      commandService.onDidRegister(() => {
        updateCommands();
      }),
      commandService.onDidUnregister(() => {
        updateCommands();
      }),
      keybindingService.onDidRegister(() => {
        setKeybindingVersion((version) => version + 1);
      }),
      keybindingService.onDidUnregister(() => {
        setKeybindingVersion((version) => version + 1);
      }),
      keybindingService.onDidChange(() => {
        setKeybindingVersion((version) => version + 1);
      }),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [commandService, keybindingService]);

  useEffect(() => {
    if (keybindingVersion === 0) {
      return;
    }

    const keybindings = keybindingService.list();
    setCommands((current) =>
      current.map((command) => ({
        ...command,
        keybinding: resolveKeybindingForCommand(command.id, keybindings),
      })),
    );
  }, [keybindingVersion, keybindingService]);

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
    if (!selectedSchema) {
      return "Select a schema to browse objects.";
    }
    return null;
  }, [activeConnectionId, selectedDatabase, selectedSchema]);

  const shouldLoadQuickOpen =
    isOpen &&
    mode === "quickOpen" &&
    availabilityMessage === null &&
    Boolean(activeConnectionId);

  const {
    tables,
    views,
    functions,
    isLoading: isQuickOpenLoading,
  } = useSchemaData(
    shouldLoadQuickOpen && activeConnectionId ? activeConnectionId : "",
    shouldLoadQuickOpen ? selectedDatabase : "",
    shouldLoadQuickOpen ? selectedSchema : "",
  );

  const quickItems = useMemo<QuickOpenItem[]>(() => {
    if (!shouldLoadQuickOpen) {
      return [];
    }

    const items: QuickOpenItem[] = [];

    const pushTable = (
      table: TableMeta,
      entityType: TableEntityType,
      group: QuickOpenGroup,
    ) => {
      items.push({
        id: `${entityType}:${table.schema}.${table.name}`,
        group,
        entityType,
        name: table.name,
        schema: table.schema,
        searchKey: `${table.schema}.${table.name}`.toLowerCase(),
        subtitle: table.row_estimate
          ? `~${formatNumber(table.row_estimate)} rows`
          : "",
        table,
      });
    };

    tables.forEach((table) => {
      pushTable(table, "table", "Tables");
    });
    views.forEach((view) => {
      const entityType: TableEntityType =
        view.kind === "MaterializedView" ? "materializedView" : "view";
      const group: QuickOpenGroup = "Views";
      pushTable(view, entityType, group);
    });

    functions.forEach((func) => {
      items.push({
        id: `function:${func.schema}.${func.name}`,
        group: "Functions",
        entityType: "function",
        name: func.name,
        schema: func.schema,
        searchKey: `${func.schema}.${func.name}`.toLowerCase(),
        subtitle: "",
        func,
      });
    });

    return items.sort((left, right) => left.name.localeCompare(right.name));
  }, [functions, shouldLoadQuickOpen, tables, views]);

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
  const isLoadingCommands = commands === LOADING_STATE;

  const filteredCommands = useMemo(() => {
    if (isLoadingCommands) {
      return LOADING_STATE;
    }

    if (!commandQuery) {
      return commands;
    }

    const fuse = new Fuse(commands, COMMAND_FUSE_OPTIONS);
    const results = fuse.search(commandQuery);

    return results.map((result) => result.item);
  }, [commands, commandQuery, isLoadingCommands]);

  const commandGroups = useMemo(() => {
    if (filteredCommands === LOADING_STATE) {
      return [];
    }
    return groupCommands(filteredCommands);
  }, [filteredCommands]);

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
    async (value: string) => {
      if (mode === "command") {
        try {
          await commandService.execute(value);
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
        openFunctionObject({
          func: item.func,
          connectionId: activeConnectionId,
          database: selectedDatabase,
        });
      } else {
        openTableObject({
          table: item.table,
          connectionId: activeConnectionId,
          database: selectedDatabase,
          viewType: "data",
        });
      }

      closePalette();
    },
    [
      activeConnectionId,
      closePalette,
      commandService,
      mode,
      quickItemsById,
      selectedDatabase,
    ],
  );

  const placeholder =
    mode === "quickOpen"
      ? "Search tables, views, and functions… (type '>' for commands)"
      : "Type a command…";

  const commandEmptyMessage =
    mode === "command" && !isLoadingCommands
      ? filteredCommands === LOADING_STATE || filteredCommands.length > 0
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

  return (
    <CommandDialog open={isOpen} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder={placeholder}
        value={query}
        onValueChange={handleValueChange}
      />
      <CommandList>
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
                    className="!text-xs !py-2"
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="text-xs font-medium flex-1 truncate">
                        {command.label}
                      </div>
                      {command.description ? (
                        <div className="text-xs text-muted-foreground text-right max-w-1/3 truncate">
                          {command.description}
                        </div>
                      ) : null}
                    </div>
                    {command.keybinding ? (
                      <CommandShortcut>
                        {command.keybinding.resolvedLabel}
                      </CommandShortcut>
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
                    className="!text-xs !py-2"
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="text-xs font-medium flex items-center gap-2 flex-1 truncate">
                        {item.entityType === "function" ? (
                          <FunctionSquare className="!h-3.5 !w-3.5 text-purple-500" />
                        ) : item.entityType === "materializedView" ||
                          item.entityType === "view" ? (
                          <Eye
                            className={cn("!h-3.5 !w-3.5", {
                              "text-green-500": item.entityType === "view",
                              "text-blue-500":
                                item.entityType === "materializedView",
                            })}
                          />
                        ) : (
                          <Table className="!h-3.5 !w-3.5 text-primary" />
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

function resolveKeybindingForCommand(
  commandId: string,
  bindings: ResolvedKeybinding[],
): ResolvedKeybinding | undefined {
  const candidates = bindings.filter(
    (binding) => binding.command === commandId,
  );
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort((left, right) => right.weight - left.weight)[0];
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
    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" />
      {message}
    </div>
  );
}
