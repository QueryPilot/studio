/**
 * CatalogSchemaFilter.tsx
 *
 * Popover + Command filter for Trino catalogs and schemas.
 * - Lists all Trino catalogs (fetched live)
 * - Each catalog expands to show its schemas
 * - Selected items appear in the sidebar; unselected are hidden
 * - Selection is persisted to the connection profile
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconDatabase,
  IconLayout2,
} from "@tabler/icons-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/databaseService";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";

interface CatalogSchemaFilterProps {
  connectionId: string;
  /** All catalogs from SHOW CATALOGS (fetched in parent) */
  catalogs: string[];
}

export function CatalogSchemaFilter({
  connectionId,
  catalogs,
}: CatalogSchemaFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  // Which catalogs are expanded in the filter dropdown (to show schemas)
  const [expandedInFilter, setExpandedInFilter] = useState<Set<string>>(
    new Set(),
  );

  const trinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.connections.get(connectionId)?.trinoCatalogFilter,
  );
  const setTrinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.setTrinoCatalogFilter,
  );

  const storedConn = useConnectionStore((s) => s.getConnection(connectionId));
  const updateConnection = useConnectionStore((s) => s.updateConnection);

  // Parse persisted schema filters from profile (only needed as fallback when Zustand is empty)
  const persistedSchemaFilters: Record<string, string[]> = (() => {
    const raw = storedConn?.profile.trino_schema_filters;
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, string[]>; } catch { return {}; }
  })();

  // Default to showing all catalogs
  const visibleCatalogs: string[] =
    trinoCatalogFilter?.visibleCatalogs ?? catalogs;
  const schemaFilters: Record<string, string[]> =
    trinoCatalogFilter?.schemaFilters ?? persistedSchemaFilters;

  // Fetch schemas for each expanded catalog in the filter
  const expandedArr = Array.from(expandedInFilter);
  const { data: expandedSchemasMap = {} } = useQuery({
    queryKey: ["trino-filter-schemas", connectionId, expandedArr],
    queryFn: async () => {
      const results = await Promise.all(
        expandedArr.map(async (catalog) => ({
          catalog,
          schemas: await databaseService.listSchemasForCatalog(
            connectionId,
            catalog,
          ),
        })),
      );
      return Object.fromEntries(
        results.map(({ catalog, schemas }) => [catalog, schemas]),
      );
    },
    enabled: expandedArr.length > 0 && open,
    staleTime: 60_000,
  });

  // Save filter changes to profile + Zustand
  const applyFilter = useCallback(
    async (
      newVisibleCatalogs: string[],
      newSchemaFilters: Record<string, string[]>,
    ) => {
      // Update ephemeral Zustand state immediately
      setTrinoCatalogFilter(connectionId, {
        visibleCatalogs: newVisibleCatalogs,
        schemaFilters: newSchemaFilters,
      });

      // Persist to profile
      if (storedConn) {
        const updatedProfile = {
          ...storedConn.profile,
          trino_catalogs: newVisibleCatalogs,
          trino_schema_filters: JSON.stringify(newSchemaFilters),
        };
        await updateConnection(connectionId, updatedProfile);
      }
    },
    [connectionId, setTrinoCatalogFilter, storedConn, updateConnection],
  );

  const toggleCatalog = useCallback(
    (catalog: string) => {
      const next = new Set(visibleCatalogs);
      if (next.has(catalog)) {
        next.delete(catalog);
      } else {
        next.add(catalog);
      }
      void applyFilter(Array.from(next), schemaFilters);
    },
    [visibleCatalogs, schemaFilters, applyFilter],
  );

  const toggleSchema = useCallback(
    (catalog: string, schema: string, allSchemas: string[]) => {
      const currentFilter = schemaFilters[catalog];
      // If no filter yet, all schemas are visible — start from full list
      const currentSet = new Set(currentFilter ?? allSchemas);
      if (currentSet.has(schema)) {
        currentSet.delete(schema);
      } else {
        currentSet.add(schema);
      }
      const nextArr = Array.from(currentSet);
      const nextFilters = { ...schemaFilters };
      // If all schemas visible, remove the filter entry (undefined = all)
      if (nextArr.length === allSchemas.length) {
        delete nextFilters[catalog];
      } else {
        nextFilters[catalog] = nextArr;
      }
      void applyFilter(visibleCatalogs, nextFilters);
    },
    [visibleCatalogs, schemaFilters, applyFilter],
  );

  const toggleExpanded = (catalog: string) => {
    setExpandedInFilter((prev) => {
      const next = new Set(prev);
      if (next.has(catalog)) {
        next.delete(catalog);
      } else {
        next.add(catalog);
      }
      return next;
    });
  };

  // Filter catalogs + schemas by search
  const searchLower = searchValue.toLowerCase().trim();
  const filteredCatalogs = catalogs.filter((cat) => {
    if (!searchLower) return true;
    if (cat.toLowerCase().includes(searchLower)) return true;
    const schemas = expandedSchemasMap[cat] ?? [];
    return schemas.some((s) => s.toLowerCase().includes(searchLower));
  });

  const isFiltered =
    visibleCatalogs.length < catalogs.length ||
    Object.keys(schemaFilters).length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) setSearchValue("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "text-xs h-5 px-1.5 justify-between border-0 hover:bg-muted/80 bg-muted/50 rounded flex items-center gap-0.5",
              isFiltered ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {visibleCatalogs.length}/{catalogs.length}
            </span>
            <IconChevronDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search catalogs & schemas…"
            className="h-8 text-xs"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="max-h-[320px]">
            {filteredCatalogs.length === 0 && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            {filteredCatalogs.map((catalog) => {
              const isVisible = visibleCatalogs.includes(catalog);
              const isExpanded = expandedInFilter.has(catalog);
              const catalogSchemas: string[] | undefined =
                expandedSchemasMap[catalog];
              const visibleSchemasForCatalog = schemaFilters[catalog];

              const matchingSchemas =
                catalogSchemas && searchLower
                  ? catalogSchemas.filter((s) =>
                      s.toLowerCase().includes(searchLower),
                    )
                  : (catalogSchemas ?? []);

              return (
                <CommandGroup key={catalog}>
                  {/* Catalog row */}
                  <div className="flex items-center">
                    {/* Expand/collapse schemas in filter */}
                    <button
                      type="button"
                      className="pl-2 pr-1 py-1.5 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => {
                        toggleExpanded(catalog);
                      }}
                    >
                      <IconChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          isExpanded && "rotate-90",
                        )}
                      />
                    </button>
                    <CommandItem
                      value={`catalog:${catalog}`}
                      onSelect={() => {
                        toggleCatalog(catalog);
                      }}
                      className="flex-1 text-xs font-medium py-1.5 rounded"
                    >
                      <IconDatabase className="mr-1.5 h-3 w-3 shrink-0 text-orange-500" />
                      <span className="truncate">{catalog}</span>
                      <IconCheck
                        className={cn(
                          "ml-auto h-3 w-3 shrink-0",
                          isVisible ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  </div>

                  {/* Schema rows — shown when expanded */}
                  {isExpanded && (
                    <>
                      {/* Loading state: expanded but schemas not yet fetched */}
                      {catalogSchemas === undefined && (
                        <div className="pl-10 py-1.5">
                          <IconLoader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {/* Empty state: fetched but no schemas */}
                      {catalogSchemas !== undefined &&
                        catalogSchemas.length === 0 && (
                          <div className="pl-10 py-1 text-xs text-muted-foreground italic">
                            No schemas
                          </div>
                        )}
                      {/* Schema items */}
                      {matchingSchemas.map((schema) => {
                        const schemaVisible =
                          !visibleSchemasForCatalog ||
                          visibleSchemasForCatalog.includes(schema);
                        return (
                          <CommandItem
                            key={`${catalog}:${schema}`}
                            value={`schema:${catalog}:${schema}`}
                            onSelect={() => {
                              toggleSchema(
                                catalog,
                                schema,
                                catalogSchemas ?? [],
                              );
                            }}
                            className="text-xs pl-10 py-1"
                          >
                            <IconLayout2 className="mr-1.5 h-3 w-3 shrink-0 text-emerald-600" />
                            <span className="truncate text-muted-foreground">
                              {schema}
                            </span>
                            <IconCheck
                              className={cn(
                                "ml-auto h-3 w-3 shrink-0",
                                schemaVisible ? "opacity-100" : "opacity-0",
                              )}
                            />
                          </CommandItem>
                        );
                      })}
                    </>
                  )}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
