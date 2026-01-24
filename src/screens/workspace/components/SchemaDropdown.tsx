/**
 * SchemaDropdown.tsx
 *
 * A compact schema dropdown for use within ConnectionSection.
 * Displays a simple select dropdown to switch schemas for a specific connection.
 */

import { logger } from "@/lib/logger";
import { useEffect, useCallback, useState } from "react";
import { IconCheck, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
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
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";

interface SchemaDropdownProps {
  connectionId: string;
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

export function SchemaDropdown({
  connectionId,
  selectedSchema,
  onSchemaChange,
}: SchemaDropdownProps) {
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Get connection from workspace bundle store
  const connection = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.connections.get(connectionId)
  );
  const database = connection?.database ?? "";

  // Get connection profile to check db_type
  const stored = useConnectionStore((state) => state.getConnection(connectionId));
  const dbType = stored?.profile.db_type;

  // Check if database supports schemas (not MySQL/SQLite)
  const supportsSchemas =
    dbType === DbType.PostgreSQL || dbType === DbType.SQLServer;

  // Track connection active state
  const [isConnectionActive, setIsConnectionActive] = useState(() =>
    databaseService.isConnectionActive(connectionId)
  );

  useEffect(() => {
    const unsubscribe = databaseService.onHealthChange(
      connectionId,
      (health) => {
        const nowActive =
          health.status === "ready" || health.status === "degraded";
        setIsConnectionActive(nowActive);
      }
    );

    setIsConnectionActive(databaseService.isConnectionActive(connectionId));

    return unsubscribe;
  }, [connectionId]);

  // Query for schemas list
  const { data: schemas = [], isLoading: isLoadingSchemas } = useQuery({
    queryKey: ["schemas", connectionId, database],
    queryFn: async () => {
      if (!database) return [];
      if (!databaseService.isConnectionActive(connectionId)) {
        throw new Error("Connection is not active");
      }
      return await databaseService.listSchemas(connectionId, database);
    },
    enabled: !!connectionId && !!database && isConnectionActive && supportsSchemas,
    staleTime: 60_000,
    retry: 2,
  });

  // Auto-select schema when schemas are loaded
  useEffect(() => {
    if (!schemas.length || isLoadingSchemas) return;
    if (selectedSchema && schemas.includes(selectedSchema)) return;

    const publicSchema = schemas.find((s) => s.toLowerCase() === "public");
    const dboSchema = schemas.find((s) => s.toLowerCase() === "dbo");
    const fallback = publicSchema || dboSchema || schemas[0];

    if (fallback && fallback !== selectedSchema) {
      onSchemaChange(fallback);
    }
  }, [schemas, selectedSchema, isLoadingSchemas, onSchemaChange]);

  const handleSelect = useCallback(
    async (schema: string) => {
      if (schema === selectedSchema) {
        setOpen(false);
        return;
      }

      setIsSwitching(true);
      try {
        await databaseService.switchSchema(connectionId, schema);
        onSchemaChange(schema);
      } catch (err) {
        logger.error("Failed to switch schema:", err);
      } finally {
        setIsSwitching(false);
        setOpen(false);
      }
    },
    [connectionId, selectedSchema, onSchemaChange]
  );

  // Hide for databases that don't support schemas
  if (!supportsSchemas) {
    return null;
  }

  if (!schemas.length && !isLoadingSchemas) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            disabled={isSwitching || isLoadingSchemas}
            className="text-xs h-5 px-1.5 justify-between min-w-[60px] max-w-[100px] border-0 hover:bg-muted/80 bg-muted/50 rounded"
          >
            {isLoadingSchemas ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <span className="truncate text-muted-foreground">{selectedSchema || "..."}</span>
                <IconChevronDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
              </>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-[160px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search..." className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty>No schema found.</CommandEmpty>
              <CommandGroup>
                {schemas.map((schema) => (
                  <CommandItem
                    key={schema}
                    value={schema}
                    onSelect={() => void handleSelect(schema)}
                    className="text-xs"
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3",
                        selectedSchema === schema ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{schema}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
    </Popover>
  );
}
