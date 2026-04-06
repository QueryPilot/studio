/**
 * CatalogSection.tsx
 *
 * Renders one Trino catalog as a collapsible subtree:
 *   [▶ tpch]
 *     [▶ sf1]
 *         customer
 *         orders
 *     [▶ sf100]
 *         ...
 *
 * Lazy: schemas load when catalog is expanded; tables load when schema is expanded.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronRight,
  IconLoader2,
  IconDatabase,
  IconLayout2,
  IconTable,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTrinoMultiCatalogData } from "@/hooks/useTrinoMultiCatalogData";
import type { TableMeta } from "@/services/databaseService";

interface CatalogSectionProps {
  connectionId: string;
  catalog: string;
  visibleSchemas?: string[];
  onTableClick: (table: TableMeta, catalog: string) => void;
}

function SchemaSubtree({
  connectionId,
  catalog,
  schema,
  onTableClick,
}: {
  connectionId: string;
  catalog: string;
  schema: string;
  onTableClick: (table: TableMeta, catalog: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { tablesQueryOptions } = useTrinoMultiCatalogData(connectionId);

  const { data: tables = [], isLoading } = useQuery({
    ...tablesQueryOptions(catalog, schema),
    enabled: expanded,
  });

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left px-2 py-0.5 text-xs hover:bg-muted/50 rounded"
        onClick={() => { setExpanded((e) => !e); }}
      >
        <IconChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <IconLayout2 className="h-3 w-3 shrink-0 text-emerald-600" />
        <span className="truncate">{schema}</span>
        {isLoading && (
          <IconLoader2 className="h-3 w-3 ml-auto animate-spin text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="pl-5">
          {!isLoading && tables.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-0.5 italic">
              No tables
            </p>
          )}
          {tables.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-muted/50 rounded cursor-pointer"
              onClick={() => { onTableClick(t, catalog); }}
            >
              <IconTable className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CatalogSection({
  connectionId,
  catalog,
  visibleSchemas,
  onTableClick,
}: CatalogSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { schemasQueryOptions } = useTrinoMultiCatalogData(connectionId);

  const { data: schemas = [], isLoading } = useQuery({
    ...schemasQueryOptions(catalog),
    enabled: expanded,
  });

  const filteredSchemas = visibleSchemas
    ? schemas.filter((s) => visibleSchemas.includes(s))
    : schemas;

  return (
    <div className="mb-0.5">
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left px-2 py-0.5 text-xs font-medium hover:bg-muted/50 rounded"
        onClick={() => { setExpanded((e) => !e); }}
      >
        <IconChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <IconDatabase className="h-3 w-3 shrink-0 text-orange-500" />
        <span className="truncate">{catalog}</span>
        {isLoading && (
          <IconLoader2 className="h-3 w-3 ml-auto animate-spin text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="pl-4">
          {!isLoading && filteredSchemas.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-0.5 italic">
              No schemas
            </p>
          )}
          {filteredSchemas.map((schema) => (
            <SchemaSubtree
              key={schema}
              connectionId={connectionId}
              catalog={catalog}
              schema={schema}
              onTableClick={onTableClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
