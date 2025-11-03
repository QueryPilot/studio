import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ResolvedKeybinding } from "@/types/keybinding";
import type { CommandDescriptor } from "@/types/command";
import { useKeyboardServices } from "@/components/KeyboardProvider";
import type { FunctionMeta, TableMeta } from "@/services/databaseService";
import { useSchemaData } from "@/hooks/useSchemaData";
import { formatNumber } from "@/utils/formatters";

export interface CategorizedCommand extends CommandDescriptor {
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
export function useQuickOpenItems(
  connectionId: string,
  database: string,
  schema: string,
  enabled: boolean,
) {
  const {
    tables,
    views,
    functions,
    isLoading,
    error,
  } = useSchemaData(
    enabled ? connectionId : "",
    enabled ? database : "",
    enabled ? schema : "",
  );

  const quickItems = useMemo<QuickOpenItem[]>(() => {
    if (!enabled || isLoading) {
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
  }, [enabled, functions, isLoading, tables, views]);

  return {
    quickItems,
    isLoading,
    error,
  };
}
