/**
 * CatalogSchemaFilter.tsx
 *
 * Hierarchical filter for Trino sidebar:
 * - Lists ALL catalogs from Trino (fetched live)
 * - Each catalog can be expanded to show its schemas
 * - Top-level checkbox controls catalog visibility
 * - Schema checkboxes control per-catalog schema visibility
 *
 * Initial selection = initialSelected (from profile.trino_catalogs).
 * If initialSelected is empty, all catalogs are shown.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconFilter,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
} from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { databaseService } from "@/services/databaseService";

interface CatalogSchemaFilterProps {
  connectionId: string;
  /** All catalogs from Trino (fetched live in parent) */
  catalogs: string[];
  /** Catalogs selected by default (from profile.trino_catalogs) */
  initialSelected: string[];
}

function CatalogFilterRow({
  connectionId,
  catalog,
  isVisible,
  visibleSchemas,
  onToggleCatalog,
  onSetVisibleSchemas,
}: {
  connectionId: string;
  catalog: string;
  isVisible: boolean;
  visibleSchemas?: string[];
  onToggleCatalog: (catalog: string, checked: boolean) => void;
  onSetVisibleSchemas: (catalog: string, schemas: string[] | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data: schemas = [], isLoading } = useQuery({
    queryKey: ["trino-schemas", connectionId, catalog],
    queryFn: () => databaseService.listSchemasForCatalog(connectionId, catalog),
    staleTime: 60_000,
    enabled: expanded && isVisible,
  });

  const handleSchemaToggle = (schema: string, checked: boolean) => {
    const newVisible = checked
      ? [...(visibleSchemas ?? schemas), schema].filter(
          (s, i, arr) => arr.indexOf(s) === i,
        )
      : (visibleSchemas ?? schemas).filter((s) => s !== schema);
    // If all schemas visible, pass undefined (no filter)
    const nextFilter =
      newVisible.length === schemas.length ? undefined : newVisible;
    onSetVisibleSchemas(catalog, nextFilter);
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => { setExpanded((e) => !e); }}
        >
          {isLoading ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : expanded ? (
            <IconChevronDown className="h-3 w-3" />
          ) : (
            <IconChevronRight className="h-3 w-3" />
          )}
        </button>
        <Checkbox
          id={`cat-filter-${connectionId}-${catalog}`}
          checked={isVisible}
          onCheckedChange={(checked) => {
            onToggleCatalog(catalog, checked);
          }}
          className="h-3.5 w-3.5"
        />
        <Label
          htmlFor={`cat-filter-${connectionId}-${catalog}`}
          className="text-xs font-normal cursor-pointer"
        >
          {catalog}
        </Label>
      </div>
      {expanded && isVisible && schemas.length > 0 && (
        <div className="pl-6 mt-1 space-y-1">
          {schemas.map((schema) => {
            const schemaVisible =
              !visibleSchemas || visibleSchemas.includes(schema);
            return (
              <div key={schema} className="flex items-center gap-1.5">
                <Checkbox
                  id={`schema-filter-${connectionId}-${catalog}-${schema}`}
                  checked={schemaVisible}
                  onCheckedChange={(checked) => {
                    handleSchemaToggle(schema, checked);
                  }}
                  className="h-3 w-3"
                />
                <Label
                  htmlFor={`schema-filter-${connectionId}-${catalog}-${schema}`}
                  className="text-xs font-normal cursor-pointer text-muted-foreground"
                >
                  {schema}
                </Label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CatalogSchemaFilter({
  connectionId,
  catalogs,
  initialSelected,
}: CatalogSchemaFilterProps) {
  const [open, setOpen] = useState(false);

  const trinoCatalogFilter = useWorkspaceBundleStore(
    (s) =>
      s.activeWorkspace?.connections.get(connectionId)?.trinoCatalogFilter,
  );
  const setTrinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.setTrinoCatalogFilter,
  );

  // Determine current visible catalogs
  const defaultVisible =
    initialSelected.length > 0 ? initialSelected : catalogs;
  const visibleCatalogs = trinoCatalogFilter?.visibleCatalogs ?? defaultVisible;
  const schemaFilters = trinoCatalogFilter?.schemaFilters ?? {};

  const isFiltered =
    trinoCatalogFilter !== undefined &&
    (visibleCatalogs.length < catalogs.length ||
      Object.keys(schemaFilters).length > 0);

  const toggleCatalog = (catalog: string, checked: boolean) => {
    const currentVisible = new Set(visibleCatalogs);
    if (checked) {
      currentVisible.add(catalog);
    } else {
      currentVisible.delete(catalog);
    }
    setTrinoCatalogFilter(connectionId, {
      visibleCatalogs: Array.from(currentVisible),
      schemaFilters,
    });
  };

  const setVisibleSchemas = (
    catalog: string,
    schemas: string[] | undefined,
  ) => {
    const nextSchemaFilters =
      schemas === undefined
        ? Object.fromEntries(
            Object.entries(schemaFilters).filter(([k]) => k !== catalog),
          )
        : { ...schemaFilters, [catalog]: schemas };
    setTrinoCatalogFilter(connectionId, {
      visibleCatalogs,
      schemaFilters: nextSchemaFilters,
    });
  };

  if (catalogs.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Filter catalogs"
            className={`text-xs h-5 px-1.5 border-0 hover:bg-muted/80 rounded flex items-center gap-0.5 ${isFiltered ? "text-primary" : "text-muted-foreground"}`}
          >
            <IconFilter className="h-3 w-3 shrink-0" />
            <span className="shrink-0">
              {visibleCatalogs.length}/{catalogs.length}
            </span>
            <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[220px] p-3" align="start">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Catalogs &amp; Schemas
        </p>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {catalogs.map((catalog) => (
            <CatalogFilterRow
              key={catalog}
              connectionId={connectionId}
              catalog={catalog}
              isVisible={visibleCatalogs.includes(catalog)}
              visibleSchemas={schemaFilters[catalog]}
              onToggleCatalog={toggleCatalog}
              onSetVisibleSchemas={setVisibleSchemas}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
