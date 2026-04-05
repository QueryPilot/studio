/**
 * SchemaDropdown.tsx
 *
 * A compact schema dropdown for use within ConnectionSection.
 * Displays a simple select dropdown to switch schemas for a specific connection.
 * Supports creating new schemas and setting a default schema per connection.
 */

import { logger } from "@/lib/logger";
import { useEffect, useCallback, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconStar,
  IconStarFilled,
  IconPlus,
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
import { databaseService } from "@/services/databaseService";
import { BackendAPI } from "@/services/backend";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";
import { toast } from "sonner";

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
  const [searchValue, setSearchValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const queryClient = useQueryClient();

  // Get connection from workspace bundle store
  const connection = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.connections.get(connectionId)
  );
  const database = connection?.database ?? "";

  // Get connection profile to check db_type and default_schema
  const stored = useConnectionStore((state) => state.getConnection(connectionId));
  const setDefaultSchema = useConnectionStore((state) => state.setDefaultSchema);
  const dbType = stored?.profile.db_type;
  const defaultSchema = stored?.profile.default_schema;

  // Check if database supports schemas (not MySQL/SQLite)
  const supportsSchemas =
    dbType === DbType.PostgreSQL ||
    dbType === DbType.SQLServer ||
    dbType === DbType.Oracle ||
    dbType === DbType.Trino;
  const canCreateSchema =
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

    // First try the default_schema from profile
    if (defaultSchema && schemas.includes(defaultSchema)) {
      onSchemaChange(defaultSchema);
      return;
    }

    const publicSchema = schemas.find((s) => s.toLowerCase() === "public");
    const dboSchema = schemas.find((s) => s.toLowerCase() === "dbo");
    const fallback = publicSchema || dboSchema || schemas[0];

    if (fallback && fallback !== selectedSchema) {
      onSchemaChange(fallback);
    }
  }, [schemas, selectedSchema, isLoadingSchemas, onSchemaChange, defaultSchema]);

  // Check if search value matches any existing schema
  const searchLower = searchValue.toLowerCase().trim();
  const matchingSchemas = schemas.filter((s) =>
    s.toLowerCase().includes(searchLower)
  );
  const exactMatch = schemas.some((s) => s.toLowerCase() === searchLower);
  const showCreateOption =
    canCreateSchema && searchValue.trim() && !exactMatch && !isLoadingSchemas;

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
        setSearchValue("");
      }
    },
    [connectionId, selectedSchema, onSchemaChange]
  );

  const handleCreateSchema = useCallback(
    async (schemaName: string) => {
      if (!schemaName.trim()) return;

      setIsCreating(true);
      try {
        // Generate CREATE SCHEMA SQL based on db type
        let sql: string;
        if (dbType === DbType.PostgreSQL) {
          sql = `CREATE SCHEMA "${schemaName}"`;
        } else if (dbType === DbType.SQLServer) {
          sql = `CREATE SCHEMA [${schemaName}]`;
        } else {
          sql = `CREATE SCHEMA ${schemaName}`;
        }

        await BackendAPI.query(connectionId, sql);
        toast.success(`Schema "${schemaName}" created`);

        // Invalidate schemas query to refresh the list
        await queryClient.invalidateQueries({
          queryKey: ["schemas", connectionId, database],
        });

        // Select the newly created schema
        await handleSelect(schemaName);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create schema";
        logger.error("Failed to create schema:", err);
        toast.error(message);
      } finally {
        setIsCreating(false);
        setSearchValue("");
      }
    },
    [connectionId, dbType, database, queryClient, handleSelect]
  );

  const handleSetDefault = useCallback(
    async (schema: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const newDefault = defaultSchema === schema ? undefined : schema;
        await setDefaultSchema(connectionId, newDefault);
        toast.success(
          newDefault
            ? `"${schema}" set as default schema`
            : "Default schema cleared"
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to set default schema";
        toast.error(message);
      }
    },
    [connectionId, defaultSchema, setDefaultSchema]
  );

  // Hide for databases that don't support schemas
  if (!supportsSchemas) {
    return null;
  }

  if (!schemas.length && !isLoadingSchemas) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) setSearchValue("");
    }}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            disabled={isSwitching || isLoadingSchemas || isCreating}
            className="text-xs h-5 px-1.5 justify-between min-w-[60px] max-w-[100px] border-0 hover:bg-muted/80 bg-muted/50 rounded"
          >
            {isLoadingSchemas || isCreating ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <span className="truncate text-muted-foreground">
                  {selectedSchema || "..."}
                </span>
                <IconChevronDown className="ml-0.5 h-3 w-3 shrink-0 opacity-50" />
              </>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or create..."
            className="h-8 text-xs"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {matchingSchemas.length === 0 && !showCreateOption && (
              <CommandEmpty>No schema found.</CommandEmpty>
            )}

            {/* Create new schema option */}
            {showCreateOption && (
              <CommandGroup>
                <CommandItem
                  value={`create-${searchValue}`}
                  onSelect={() => void handleCreateSchema(searchValue.trim())}
                  className="text-xs text-primary"
                >
                  <IconPlus className="mr-2 h-3 w-3" />
                  <span>Create "{searchValue.trim()}"</span>
                </CommandItem>
              </CommandGroup>
            )}

            {/* Existing schemas */}
            {matchingSchemas.length > 0 && (
              <CommandGroup>
                {matchingSchemas.map((schema) => (
                  <CommandItem
                    key={schema}
                    value={schema}
                    onSelect={() => void handleSelect(schema)}
                    className="text-xs group"
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3 shrink-0",
                        selectedSchema === schema ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate flex-1">{schema}</span>
                    <button
                      type="button"
                      onClick={(e) => void handleSetDefault(schema, e)}
                      className={cn(
                        "ml-1 p-0.5 rounded hover:bg-muted shrink-0",
                        defaultSchema === schema
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-50 hover:!opacity-100"
                      )}
                      title={defaultSchema === schema ? "Remove as default" : "Set as default"}
                    >
                      {defaultSchema === schema ? (
                        <IconStarFilled className="h-3 w-3 text-yellow-500" />
                      ) : (
                        <IconStar className="h-3 w-3" />
                      )}
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
