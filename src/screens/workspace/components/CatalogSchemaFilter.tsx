/**
 * CatalogSchemaFilter.tsx
 *
 * Multi-select filter dropdown for the Trino connection header.
 * Shows all configured catalogs with checkboxes; unchecked catalogs
 * are hidden from the sidebar tree.
 *
 * State: trinoCatalogFilter in workspaceBundleStore per connection.
 * undefined = all catalogs visible (no filter active).
 */

import { useState } from "react";
import { IconFilter, IconChevronDown } from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";

interface CatalogSchemaFilterProps {
  connectionId: string;
  /** All catalogs configured in profile.trino_catalogs */
  catalogs: string[];
}

export function CatalogSchemaFilter({
  connectionId,
  catalogs,
}: CatalogSchemaFilterProps) {
  const [open, setOpen] = useState(false);

  const trinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.connections.get(connectionId)?.trinoCatalogFilter,
  );
  const setTrinoCatalogFilter = useWorkspaceBundleStore(
    (s) => s.setTrinoCatalogFilter,
  );

  // undefined filter = all catalogs visible
  const visibleSet = trinoCatalogFilter
    ? new Set(trinoCatalogFilter)
    : new Set(catalogs);

  const isFiltered =
    trinoCatalogFilter !== undefined && visibleSet.size < catalogs.length;

  const toggleCatalog = (catalog: string, checked: boolean) => {
    const next = new Set(visibleSet);
    if (checked) {
      next.add(catalog);
    } else {
      next.delete(catalog);
    }
    const nextArr = Array.from(next);
    // If all visible, clear filter (undefined = all)
    setTrinoCatalogFilter(
      connectionId,
      nextArr.length === catalogs.length ? undefined : nextArr,
    );
  };

  // Only render when there are multiple catalogs to filter
  if (catalogs.length <= 1) return null;

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
              {visibleSet.size}/{catalogs.length}
            </span>
            <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[180px] p-2" align="start">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Visible catalogs
        </p>
        <div className="space-y-1.5">
          {catalogs.map((catalog) => (
            <div key={catalog} className="flex items-center gap-2">
              <Checkbox
                id={`cat-filter-${connectionId}-${catalog}`}
                checked={visibleSet.has(catalog)}
                onCheckedChange={(checked) => {
                  toggleCatalog(catalog, checked === true);
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
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
