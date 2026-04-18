/**
 * SchemaDropdown.tsx
 *
 * Multi-select checklist dropdown for choosing which schemas are "visible"
 * for a given connection + database.  The first selected schema is the
 * primary one (shown with a PrimaryBadge).  Ordering can be changed with
 * drag-and-drop (@dnd-kit/sortable).
 *
 * Changes are auto-applied immediately (no Apply button).
 * Click a schema label in the Visible list to set it as primary.
 */

import { logger } from "@/lib/logger";
import { useState, useCallback } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";
import { toast } from "sonner";
import { SchemaMultiSelectContent } from "@/components/schemas/SchemaMultiSelectContent";

interface SchemaDropdownProps {
  connectionId: string;
  databaseName: string;
  /** Controlled open state. When provided, the popover is controlled externally. */
  open?: boolean;
  /** Called when the popover requests an open-state change. */
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Main component — now delegates popover body to SchemaMultiSelectContent
// ---------------------------------------------------------------------------

export function SchemaDropdown({ connectionId, databaseName, open: openProp, onOpenChange }: SchemaDropdownProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = (value: boolean) => {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setOpenInternal(value);
    }
  };

  const storedVisible = useConnectionStore((s) =>
    s.getVisibleSchemas(connectionId, databaseName),
  );
  const setVisibleSchemas = useConnectionStore((s) => s.setVisibleSchemas);

  // Determine db_type to decide if schemas are supported
  const stored = useConnectionStore((s) => s.getConnection(connectionId));
  const dbType = stored?.profile.db_type;
  const supportsSchemas =
    dbType === DbType.PostgreSQL ||
    dbType === DbType.SQLServer ||
    dbType === DbType.Oracle ||
    dbType === DbType.Trino ||
    dbType === DbType.DuckDB;

  const handleApply = useCallback(
    async (schemas: string[]) => {
      try {
        await setVisibleSchemas(connectionId, databaseName, schemas);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to apply schemas";
        logger.error("SchemaDropdown: failed to apply", err);
        toast.error(message);
      }
    },
    [connectionId, databaseName, setVisibleSchemas],
  );

  // Trigger label
  const primary = storedVisible[0] ?? "";
  const extra = Math.max(0, storedVisible.length - 1);
  const label =
    extra > 0 ? `${primary} (+${extra} more)` : primary || "Select schemas…";

  if (!supportsSchemas) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-expanded={open}
            aria-label={label}
            className="text-xs h-5 px-1.5 justify-between min-w-[60px] max-w-[160px] border-0 hover:bg-muted/80 bg-muted/50 rounded"
          >
            <span className="truncate text-muted-foreground">{label}</span>
            <IconChevronDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        }
      />

      <PopoverContent className="w-[260px] p-0" align="start">
        <SchemaMultiSelectContent
          connectionId={connectionId}
          database={databaseName}
          initialSchemas={storedVisible}
          scopeLabel="Connection"
          onApply={handleApply}
          allowEmptySelection={dbType === DbType.Trino}
        />
      </PopoverContent>
    </Popover>
  );
}
