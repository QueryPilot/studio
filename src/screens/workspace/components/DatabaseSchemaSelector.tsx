import { useEffect, useCallback, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconPlus, IconTable, IconEye, IconMathFunction, IconBolt, IconDatabase } from '@tabler/icons-react';
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

  // IconCheck if connection is active
  const isConnectionActive = databaseService.isConnectionActive(connectionId);
  const prevActiveRef = useRef(isConnectionActive);

  // Get current database from workspace selection store
  const selectedDatabase = useWorkspaceSelectionStore(
    (state) => state.database,
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
      console.log(
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
      console.log(
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
      console.error("Failed to load schemas:", schemasError);
      toast.error("Failed to load schemas");
    }
  }, [schemasError]);

  const selectSchema = useCallback(
    async (schema: string, options: { force?: boolean } = {}) => {
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
        console.error("Failed to switch schema:", err);
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

    // Select default schema (public, dbo, or first available)
    const publicSchema = schemas.find((s) => s.toLowerCase() === "public");
    const defaultSchema = schemas.find((s) => s.toLowerCase() === "dbo");
    const fallback = publicSchema || defaultSchema || schemas[0];

    if (fallback && fallback !== selectedSchema) {
      void selectSchema(fallback);
    }
  }, [schemas, selectedSchema, isLoadingSchemas, selectSchema]);

  const handleSchemaSelect = useCallback(
    (schema: string) => {
      void selectSchema(schema);
    },
    [selectSchema],
  );

  // Listen for database reconnection events and invalidate queries
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      cleanup = await safeListen("database-reconnected", (event) => {
        const payload = event.payload as { connectionId: string };
        if (payload.connectionId === connectionId) {
          console.log(
            "[DatabaseSchemaSelector] Received reconnection event - refreshing schemas",
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
      objectType: 'schema',
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
      objectType: 'view',
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateMaterializedView = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'materializedView',
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateFunction = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'function',
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateProcedure = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'procedure',
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  const handleCreateTrigger = useCallback(() => {
    openQueryWithTemplate({
      connectionId,
      database: selectedDatabase,
      schema: selectedSchema,
      objectType: 'trigger',
    });
  }, [connectionId, selectedDatabase, selectedSchema]);

  if (schemas.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between w-full">
      {/* Schema Selector */}
      <Popover open={schemaPopoverOpen} onOpenChange={setSchemaPopoverOpen}>
        <PopoverTrigger asChild>
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
        </PopoverTrigger>
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
                    {schema}
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
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="Create new object"
          >
            <IconPlus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={handleCreateTable} className="text-xs">
            <IconTable className="mr-2 h-3.5 w-3.5 text-primary" />
            New IconTable
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateView} className="text-xs">
            <IconEye className="mr-2 h-3.5 w-3.5 text-green-500" />
            New View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCreateMaterializedView} className="text-xs">
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
