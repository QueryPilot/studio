import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconLock,
  IconPlugConnectedX,
  IconTable,
  IconEye,
  IconAlertCircle,
  IconLoader2,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PrimaryBadge } from "@/components/badges/PrimaryBadge";
import { SidebarSection, SidebarItem } from "./DatabaseSidebarItem";
import { IntrospectionService } from "@/services/introspectionService";
import type { TableMeta } from "@/services/databaseService";
import { schemaNamesForAttachedDatabase } from "./duckDbAttachedDatabaseSectionHelpers";

interface DuckDbAttachedDatabaseSectionProps {
  connectionId: string;
  dbName: string;
  dbType?: string | null;
  readOnly?: boolean;
  className?: string;
  /** Override schema names to load (e.g. ["public"] for attached Postgres). Defaults to ["main"]. */
  schemaNames?: string[];
  onTableClick: (table: TableMeta) => void;
  onDetach: (dbName: string) => void;
}

interface AttachedSchemaObjects {
  tables: TableMeta[];
  views: TableMeta[];
}

const EMPTY_SCHEMA_OBJECTS: AttachedSchemaObjects = {
  tables: [],
  views: [],
};

export function DuckDbAttachedDatabaseSection({
  connectionId,
  dbName,
  dbType,
  readOnly,
  className,
  schemaNames,
  onTableClick,
  onDetach,
}: DuckDbAttachedDatabaseSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [schemaExpansionOverrides, setSchemaExpansionOverrides] = useState<
    Record<string, boolean>
  >({});
  const queryClient = useQueryClient();
  const isDuckDbAttachment = (dbType ?? "").trim().toLowerCase() === "duckdb";
  const selectedSchemaNames = useMemo(() => {
    if (schemaNames && schemaNames.length > 0) return schemaNames;
    return isDuckDbAttachment ? ["main"] : [];
  }, [schemaNames, isDuckDbAttachment]);
  const selectedSchemaSet = useMemo(
    () => new Set(selectedSchemaNames),
    [selectedSchemaNames],
  );
  const {
    data: discoveredSchemaNames = [],
    isFetched: hasFetchedSchemaNames,
    isLoading: isLoadingSchemaNames,
    error: schemaError,
  } = useQuery({
    queryKey: ["attached-db-schemas", connectionId, dbName],
    queryFn: async () => {
      const schemas = await IntrospectionService.getSchemas(connectionId);
      return schemaNamesForAttachedDatabase(schemas, dbName);
    },
    enabled: isExpanded,
    staleTime: 30_000,
  });
  const schemaDisplayNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...selectedSchemaNames, ...discoveredSchemaNames]) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }, [selectedSchemaNames, discoveredSchemaNames]);
  const schemasKey = selectedSchemaNames.map((s) => `${dbName}.${s}`).join(",");

  const {
    data: objectsBySchema = {},
    isLoading: isLoadingObjects,
    error: objectsError,
    refetch,
  } = useQuery<Record<string, AttachedSchemaObjects>>({
    queryKey: ["attached-db-objects", connectionId, dbName, schemasKey],
    queryFn: async () => {
      const entries = await Promise.all(
        selectedSchemaNames.map(async (schemaName) => {
          const schema = `${dbName}.${schemaName}`;
          const [rawTables, rawViews] = await Promise.all([
            IntrospectionService.getTables(connectionId, schema).catch((e: unknown) => {
              console.warn(`[AttachedDB] Failed to load tables for ${schema}:`, e);
              return [];
            }),
            IntrospectionService.getViews(connectionId, schema).catch((e: unknown) => {
              console.warn(`[AttachedDB] Failed to load views for ${schema}:`, e);
              return [];
            }),
          ]);
          const schemaObjects: AttachedSchemaObjects = {
            tables: rawTables.map((t): TableMeta => ({
              schema: t.schema,
              name: t.name,
              kind: "Table",
              row_estimate: t.row_count ?? undefined,
            })),
            views: rawViews.map((v): TableMeta => ({
              schema: v.schema,
              name: v.name,
              kind: v.is_materialized ? "MaterializedView" : "View",
            })),
          };
          return [schemaName, schemaObjects] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: isExpanded && selectedSchemaNames.length > 0,
    staleTime: 30_000,
  });

  const count = Object.values(objectsBySchema).reduce(
    (total, schemaObjects) =>
      total + schemaObjects.tables.length + schemaObjects.views.length,
    0,
  );
  const error = schemaError ?? objectsError;

  const handleReload = () => {
    void queryClient.invalidateQueries({
      queryKey: ["attached-db-schemas", connectionId, dbName],
    });
    void queryClient.invalidateQueries({
      queryKey: ["attached-db-objects", connectionId, dbName],
    });
    void refetch();
  };

  const toggleSchema = (schemaName: string, defaultExpanded: boolean) => {
    setSchemaExpansionOverrides((prev) => ({
      ...prev,
      [schemaName]: !(prev[schemaName] ?? defaultExpanded),
    }));
  };

  return (
    <div className={className}>
    <SidebarSection
      title={dbName}
      count={count}
      isExpanded={isExpanded}
      onToggle={() => { setIsExpanded((v) => !v); }}
      stickyClass=""
      headerExtra={
        <div className="flex items-center gap-0.5 pr-1">
          <IconDatabase
            className="h-3 w-3 text-muted-foreground/70"
            title={dbType ?? "duckdb"}
          />
          {readOnly && (
            <IconLock
              className="h-3 w-3 text-muted-foreground/70"
              title="Read-only"
            />
          )}
          <button
            type="button"
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDetach(dbName);
            }}
            title={`Detach ${dbName}`}
          >
            <IconPlugConnectedX className="h-3 w-3" />
          </button>
        </div>
      }
      extraContextMenuItems={
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleReload}>
            Reload
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => { onDetach(dbName); }}
            className="text-destructive focus:text-destructive"
          >
            Detach {dbName}
          </ContextMenuItem>
        </>
      }
    >
      {(isLoadingObjects || isLoadingSchemaNames) && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground">
          <IconLoader2 className="h-3 w-3 animate-spin" />
          Loading...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-destructive">
          <IconAlertCircle className="h-3 w-3" />
          <span className="truncate">
            {error instanceof Error ? error.message : "Failed to load"}
          </span>
        </div>
      )}
      {!isLoadingObjects &&
        !isLoadingSchemaNames &&
        !error &&
        hasFetchedSchemaNames &&
        schemaDisplayNames.length === 0 && (
        <ContextMenu>
          <ContextMenuTrigger>
            <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
              No schemas
            </p>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={handleReload}>
              Reload
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => { onDetach(dbName); }}
              className="text-destructive focus:text-destructive"
            >
              Detach {dbName}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {schemaDisplayNames.map((schemaName, schemaIdx) => {
        const schemaObjects = objectsBySchema[schemaName] ?? EMPTY_SCHEMA_OBJECTS;
        const schemaCount = schemaObjects.tables.length + schemaObjects.views.length;
        const isVisibleSchema = selectedSchemaSet.has(schemaName);
        const isSchemaExpanded =
          schemaExpansionOverrides[schemaName] ?? isVisibleSchema;
        return (
          <div key={`attached-schema-${dbName}-${schemaName}`}>
            <button
              type="button"
              className="flex items-center gap-1 w-full px-2 py-1 text-xs text-foreground/80 hover:bg-muted/50 rounded"
              onClick={() => {
                toggleSchema(schemaName, isVisibleSchema);
              }}
            >
              {isSchemaExpanded ? (
                <IconChevronDown className="h-3.5 w-3.5" />
              ) : (
                <IconChevronRight className="h-3.5 w-3.5" />
              )}
              <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{schemaName}</span>
              {schemaIdx === 0 && isVisibleSchema && (
                <PrimaryBadge className="ml-1" />
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {isVisibleSchema ? schemaCount : "available"}
              </span>
            </button>
            {isSchemaExpanded && (
              <div className="ml-2">
                {!isVisibleSchema ? (
                  <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
                    Select schema to load objects
                  </p>
                ) : (
                  <>
                    {schemaObjects.tables.length > 0 && (
                      <SidebarSection
                        title="Tables"
                        count={schemaObjects.tables.length}
                        isExpanded={true}
                        onToggle={() => {}}
                        stickyClass=""
                      >
                        {schemaObjects.tables.map((table) => (
                          <ContextMenu key={`attached-tbl-${dbName}-${table.schema}-${table.name}`}>
                            <ContextMenuTrigger>
                              <SidebarItem
                                icon={<IconTable className="h-3.5 w-4 min-w-4 text-primary shrink-0" />}
                                name={table.name}
                                isActive={false}
                                onClick={() => { onTableClick(table); }}
                                rowCount={table.row_estimate}
                              />
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => { onTableClick(table); }}>
                                View Data
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => { onTableClick({ ...table, kind: "Table" }); }}>
                                View Structure
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </SidebarSection>
                    )}
                    {schemaObjects.views.length > 0 && (
                      <SidebarSection
                        title="Views"
                        count={schemaObjects.views.length}
                        isExpanded={true}
                        onToggle={() => {}}
                        stickyClass=""
                      >
                        {schemaObjects.views.map((view) => (
                          <ContextMenu key={`attached-view-${dbName}-${view.schema}-${view.name}`}>
                            <ContextMenuTrigger>
                              <SidebarItem
                                icon={<IconEye className="h-4 min-h-4 w-4 min-w-4 text-green-500 shrink-0" />}
                                name={view.name}
                                isActive={false}
                                onClick={() => { onTableClick(view); }}
                              />
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => { onTableClick(view); }}>
                                View Data
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </SidebarSection>
                    )}
                    {!isLoadingObjects && schemaCount === 0 && (
                      <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
                        No tables or views
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </SidebarSection>
    </div>
  );
}
