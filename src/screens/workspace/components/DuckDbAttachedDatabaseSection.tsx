import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconDatabase,
  IconLock,
  IconPlugConnectedX,
  IconTable,
  IconEye,
  IconAlertCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { SidebarSection, SidebarItem } from "./DatabaseSidebarItem";
import { IntrospectionService } from "@/services/introspectionService";
import type { TableMeta } from "@/services/databaseService";

interface DuckDbAttachedDatabaseSectionProps {
  connectionId: string;
  dbName: string;
  dbType?: string | null;
  readOnly?: boolean;
  onTableClick: (table: TableMeta) => void;
  onDetach: (dbName: string) => void;
}

export function DuckDbAttachedDatabaseSection({
  connectionId,
  dbName,
  dbType,
  readOnly,
  onTableClick,
  onDetach,
}: DuckDbAttachedDatabaseSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const schema = `${dbName}.main`;

  const { data, isLoading, error } = useQuery({
    queryKey: ["attached-db-objects", connectionId, dbName],
    queryFn: async () => {
      const [rawTables, rawViews] = await Promise.all([
        IntrospectionService.getTables(connectionId, schema),
        IntrospectionService.getViews(connectionId, schema),
      ]);
      const tables: TableMeta[] = rawTables.map((t) => ({
        schema: t.schema,
        name: t.name,
        kind: "Table",
        row_estimate: t.row_count ?? undefined,
      }));
      const views: TableMeta[] = rawViews.map((v) => ({
        schema: v.schema,
        name: v.name,
        kind: v.is_materialized ? "MaterializedView" : "View",
      }));
      return { tables, views };
    },
    enabled: isExpanded,
    staleTime: 30_000,
  });

  const tables = data?.tables ?? [];
  const views = data?.views ?? [];
  const count = tables.length + views.length;

  return (
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
    >
      {isLoading && (
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
      {!isLoading && !error && count === 0 && (
        <p className="px-4 py-1.5 text-xs text-muted-foreground italic">
          No tables or views
        </p>
      )}
      {tables.map((table) => (
        <SidebarItem
          key={`attached-tbl-${dbName}-${table.schema}-${table.name}`}
          icon={<IconTable className="h-3.5 w-4 min-w-4 text-primary shrink-0" />}
          name={table.name}
          isActive={false}
          onClick={() => { onTableClick(table); }}
          rowCount={table.row_estimate}
        />
      ))}
      {views.map((view) => (
        <SidebarItem
          key={`attached-view-${dbName}-${view.schema}-${view.name}`}
          icon={<IconEye className="h-4 min-h-4 w-4 min-w-4 text-green-500 shrink-0" />}
          name={view.name}
          isActive={false}
          onClick={() => { onTableClick(view); }}
        />
      ))}
    </SidebarSection>
  );
}
