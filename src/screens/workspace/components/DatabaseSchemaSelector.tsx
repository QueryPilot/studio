import { logger } from "@/lib/logger";
import { useEffect, useCallback, useRef, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconTable,
  IconEye,
  IconMathFunction,
  IconBolt,
  IconDatabase,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { safeListen } from "@/utils/tauri";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  openQueryWithTemplate,
  openTableDesigner,
} from "@/utils/workbench/openers";

interface DatabaseSchemaSelectorProps {
  connectionId: string;
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

export function DatabaseSchemaSelector({
  connectionId,
  selectedSchema,
  onSchemaChange,
}: DatabaseSchemaSelectorProps) {
  const [isSwitchingSchema, setIsSwitchingSchema] = useState(false);
  const [schemaPopoverOpen, setSchemaPopoverOpen] = useState(false);
  const queryClient = useQueryClient();

  // Track connection active state reactively
  const [isConnectionActive, setIsConnectionActive] = useState(() =>
    databaseService.isConnectionActive(connectionId),
  );
  const prevActiveRef = useRef(isConnectionActive);

  // Subscribe to connection health changes to update isConnectionActive
  useEffect(() => {
    const unsubscribe = databaseService.onHealthChange(
      connectionId,
      (health) => {
        const nowActive =
          health.status === "ready" || health.status === "degraded";
        setIsConnectionActive(nowActive);
      },
    );

    // Also sync on mount in case connection is already active
    setIsConnectionActive(databaseService.isConnectionActive(connectionId));

    return unsubscribe;
  }, [connectionId]);

  // Get current database from workspace selection store
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
  );

  // Get connection's default schema from profile
  const connectionDefaultSchema = useConnectionStore(
    (state) => state.getConnection(connectionId)?.profile.default_schema,
  );
  const setDefaultSchema = useConnectionStore(
    (state) => state.setDefaultSchema,
  );

  // Query for schemas list
  const {
    data: schemas = [],
    isLoading: isLoadingSchemas,
    error: schemasError,
  } = useQuery({
    queryKey: ["schemas", connectionId, selectedDatabase],
    queryFn: async () => {
      if (!selectedDatabase) {
        return [];
      }
      if (!databaseService.isConnectionActive(connectionId)) {
        throw new Error("Connection is not active");
      }
      logger.info(
        `[DatabaseSchemaSelector] Loading schemas for database: ${selectedDatabase}`,
      );
      return await databaseService.listSchemas(connectionId, selectedDatabase);
    },
    enabled: !!connectionId && !!selectedDatabase && isConnectionActive,
    staleTime: 60_000, // 1 minute
    retry: 2,
  });

  // Auto-refresh on connection becoming active
  useEffect(() => {
    if (!prevActiveRef.current && isConnectionActive) {
      logger.info(
        "[DatabaseSchemaSelector] Connection became active - refreshing schemas",
      );
      // Connection just became active - invalidate queries
      if (selectedDatabase) {
        void queryClient.invalidateQueries({
          queryKey: ["schemas", connectionId, selectedDatabase],
        });
      }
    }
    prevActiveRef.current = isConnectionActive;
  }, [isConnectionActive, connectionId, selectedDatabase, queryClient]);

  // Handle schema errors
  useEffect(() => {
    if (schemasError) {
      logger.error("Failed to load schemas:", schemasError);
      toast.error("Failed to load schemas");
    }
  }, [schemasError]);

  const selectSchema = useCallback(
    async (schema: string, options: { force?: boolean }) => {
      if (!schema) {
        onSchemaChange("");
        return;
      }

      if (!selectedDatabase) {
        onSchemaChange(schema);
        return;
      }

      const force = options.force ?? false;
      if (!force && schema === selectedSchema) {
        onSchemaChange(schema);
        return;
      }

      setIsSwitchingSchema(true);
      try {
        await databaseService.switchSchema(connectionId, schema);
        onSchemaChange(schema);
      } catch (err) {
        logger.error("Failed to switch schema:", err);
        toast.error("Failed to switch schema");
      } finally {
        setIsSwitchingSchema(false);
      }
    },
    [connectionId, onSchemaChange, selectedDatabase, selectedSchema],
  );

  // Auto-select schema when schemas are loaded
  useEffect(() => {
    if (!schemas.length || isLoadingSchemas) {
      return;
    }

    // If current schema is valid, keep it
    if (selectedSchema && schemas.includes(selectedSchema)) {
      return;
    }

    // Priority: connection default_schema > public > dbo > first available
    const configuredDefault = connectionDefaultSchema
      ? schemas.find((s) => s === connectionDefaultSchema)
      : undefined;
    const publicSchema = schemas.find((s) => s.toLowerCase() === "public");
    const dboSchema = schemas.find((s) => s.toLowerCase() === "dbo");
    const fallback =
      configuredDefault || publicSchema || dboSchema || schemas[0];

    if (fallback && fallback !== selectedSchema) {
      void selectSchema(fallback, {});
    }
  }, [
    schemas,
    selectedSchema,
    isLoadingSchemas,
    selectSchema,
    connectionDefaultSchema,
  ]);

  const handleSchemaSelect = useCallback(
    (schema: string) => {
      void selectSchema(schema);
    },
    [selectSchema],
  );

  const handleToggleDefaultSchema = useCallback(
    async (schema: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const newDefault =
          connectionDefaultSchema === schema ? undefined : schema;
        await setDefaultSchema(connectionId, newDefault);
        toast.success(
          newDefault
            ? `Set "${schema}" as default schema`
            : "Cleared default schema",
        );
      } catch (err) {
        logger.error("Failed to set default schema:", err);
        toast.error("Failed to set default schema");
      }
    },
    [connectionId, connectionDefaultSchema, setDefaultSchema],
  );

  // Listen for database reconnection events and invalidate queries
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      cleanup = await safeListen("database-reconnected", (event) => {
        const payload = event.payload as { connectionId: string };
        if (payload.connectionId === connectionId) {
          logger.info(
            "[DatabaseSchemaSelector] Received reconnection event - refreshing schemas",
          );
          // Update connection active state to trigger re-render and enable query
          setIsConnectionActive(
            databaseService.isConnectionActive(connectionId),
          );
          // Invalidate and refetch schemas
          void queryClient.invalidateQueries({
            queryKey: ["schemas", connectionId],
          });
        }
      });
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, queryClient]);

  // Handle create new schema
  const handleCreateSchema = useCallback(() => {
    setSchemaPopoverOpen(false);
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "schema",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  // Create object handlers
  const handleCreateTable = useCallback(() => {
    openTableDesigner({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateView = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "view",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateMaterializedView = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "materializedView",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateFunction = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "function",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateProcedure = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "procedure",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateTrigger = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: "trigger",
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  if (schemas.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between w-full">
      {/* Schema Selector */}
      <Popover open={schemaPopoverOpen} onOpenChange={setSchemaPopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={schemaPopoverOpen}
              disabled={isSwitchingSchema}
              className="text-xs min-w-[100px] max-w-[160px] justify-between border-0 !bg-background hover:bg-muted/50 h-8 px-3"
            >
              <span className="truncate">
                {selectedSchema || "Select schema"}
              </span>
              <IconChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          }
        />
        <PopoverContent className="w-[200px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search schemas..." className="h-9" />
            <CommandList>
              <CommandEmpty>No schema found.</CommandEmpty>
              <CommandGroup>
                {schemas.map((schema) => (
                  <CommandItem
                    key={schema}
                    value={schema}
                    onSelect={(value) => {
                      handleSchemaSelect(value);
                      setSchemaPopoverOpen(false);
                    }}
                    className="text-xs"
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 h-3 w-3",
                        selectedSchema === schema ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1">{schema}</span>
                    <button
                      type="button"
                      onClick={(e) => void handleToggleDefaultSchema(schema, e)}
                      className="ml-2 p-0.5 rounded hover:bg-muted"
                      title={
                        connectionDefaultSchema === schema
                          ? "Remove as default"
                          : "Set as default schema"
                      }
                    >
                      {connectionDefaultSchema === schema ? (
                        <IconStarFilled className="h-3 w-3 text-yellow-500" />
                      ) : (
                        <IconStar className="h-3 w-3 text-muted-foreground hover:text-yellow-500" />
                      )}
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={handleCreateSchema}
                  className="text-xs text-muted-foreground"
                >
                  <IconPlus className="mr-2 h-3 w-3" />
                  Create new schema
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Create Object Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              title="Create new object"
            >
              <IconPlus />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={handleCreateTable} className="text-xs">
            <IconTable className="mr-2 h-3.5 w-3.5 text-primary" />
            New Table
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateView} className="text-xs">
            <IconEye className="mr-2 h-3.5 w-3.5 text-green-500" />
            New View
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleCreateMaterializedView}
            className="text-xs"
          >
            <IconEye className="mr-2 h-3.5 w-3.5 text-blue-500" />
            New Materialized View
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateFunction} className="text-xs">
            <IconMathFunction className="mr-2 h-3.5 w-3.5 text-purple-500" />
            New Function
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateProcedure} className="text-xs">
            <IconMathFunction className="mr-2 h-3.5 w-3.5 text-orange-500" />
            New Procedure
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateTrigger} className="text-xs">
            <IconBolt className="mr-2 h-3.5 w-3.5 text-yellow-500" />
            New Trigger
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateSchema} className="text-xs">
            <IconDatabase className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            New Schema
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
