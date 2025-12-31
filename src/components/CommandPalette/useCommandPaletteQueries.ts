import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ResolvedKeybinding } from "@/types/keybinding";
import type { CommandDescriptor } from "@/types/command";
import { useKeyboardServices } from "@/components/KeyboardProvider";
import type { FunctionMeta, TableMeta } from "@/services/databaseService";
import { useSchemaData } from "@/hooks/useSchemaData";
import { formatNumber } from "@/utils/formatters";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

export interface CategorizedCommand extends CommandDescriptor {
  keybinding?: ResolvedKeybinding;
}

// Unified item types for command palette
export type UnifiedItemType = "table" | "view" | "materializedView" | "function" | "command";

export interface UnifiedItem {
  id: string;
  type: UnifiedItemType;
  name: string;
  subtitle: string;
  schema?: string;
  keywords: string[];
  // Type-specific payload
  table?: TableMeta;
  func?: FunctionMeta;
  command?: CategorizedCommand;
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

export type QuickOpenItem = TableQuickOpenItem | FunctionQuickOpenItem;

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

/**
 * Hook to fetch and cache all available commands with their keybindings
 */
export function useCommands() {
  const { commandService, keybindingService } = useKeyboardServices();

  return useQuery({
    queryKey: ["commands", "list"],
    queryFn: () => {
      const descriptors = commandService.list();
      const keybindings = keybindingService.list();

      const enriched: CategorizedCommand[] = descriptors.map((descriptor) => ({
        ...descriptor,
        keybinding: resolveKeybindingForCommand(descriptor.id, keybindings),
      }));

      return enriched;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch and cache keybindings, with invalidation mechanism
 */
export function useKeybindings() {
  const { keybindingService } = useKeyboardServices();

  return useQuery({
    queryKey: ["keybindings", "list"],
    queryFn: () => keybindingService.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch and cache quick open items (tables, views, functions)
 */
export function useQuickOpenItems() {
  const { tables, views, functions, isLoading, error } = useSchemaData();

  const quickItems = useMemo<QuickOpenItem[]>(() => {
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
  }, [functions, tables, views]);

  return {
    quickItems,
    isLoading,
    error,
  };
}

/**
 * Hook that combines all searchable items into a unified list
 */
export function useUnifiedItems() {
  const { data: commands = [], isLoading: isLoadingCommands } = useCommands();
  const { quickItems, isLoading: isLoadingQuickOpen } = useQuickOpenItems();
  const connectionId = useWorkspaceSelectionStore((state) => state.connectionId);

  // Determine if we're in a workspace context
  const isInWorkspace = !!connectionId;

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // Add database objects
    for (const item of quickItems) {
      if (item.entityType === "function") {
        items.push({
          id: item.id,
          type: "function",
          name: item.name,
          subtitle: item.schema,
          schema: item.schema,
          keywords: [item.searchKey, "function", "func"],
          func: item.func,
        });
      } else {
        items.push({
          id: item.id,
          type: item.entityType,
          name: item.name,
          subtitle: item.schema,
          schema: item.schema,
          keywords: [item.searchKey, item.entityType],
          table: item.table,
        });
      }
    }

    // Filter commands based on context
    const contextFilteredCommands = commands.filter((cmd) => {
      // Workspace-only commands - only show when in a workspace
      if (
        cmd.id === "workspace.switchDatabase" ||
        cmd.id === "workspace.switchSchema"
      ) {
        return isInWorkspace;
      }
      // Home-only commands - only show when NOT in a workspace
      if (cmd.id === "connection.open") {
        return !isInWorkspace;
      }
      return true;
    });

    // Add filtered commands
    for (const command of contextFilteredCommands) {
      items.push({
        id: `command:${command.id}`,
        type: "command",
        name: command.label,
        subtitle: command.keybinding?.resolvedLabel ?? "",
        keywords: [
          command.id,
          command.description ?? "",
          command.category ?? "",
          "command",
        ].filter(Boolean),
        command,
      });
    }

    return items;
  }, [commands, quickItems, isInWorkspace]);

  return {
    unifiedItems,
    isLoading: isLoadingCommands || isLoadingQuickOpen,
  };
}
