import { useEffect, useCallback, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { safeListen } from "@/utils/tauri";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

interface DatabaseSchemaSelectorProps {
  connectionId: string;
  selectedSchema: string;
  onSchemaChange: (schema: string) => void;
}

const COMMAND_THRESHOLD = 10;

export function DatabaseSchemaSelector({
  connectionId,
  selectedSchema,
  onSchemaChange,
}: DatabaseSchemaSelectorProps) {
  const [isSwitchingSchema, setIsSwitchingSchema] = useState(false);
  const [schemaPopoverOpen, setSchemaPopoverOpen] = useState(false);
  const queryClient = useQueryClient();

  // Check if connection is active
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

  // Render schema selector (Select for <=10 items, Command for >10)
  const renderSchemaSelector = () => {
    if (schemas.length === 0) return null;

    if (schemas.length <= COMMAND_THRESHOLD) {
      return (
        <Select value={selectedSchema} onValueChange={handleSchemaSelect}>
          <SelectTrigger
            className="text-xs min-w-[120px] max-w-[180px] border-0 !bg-background hover:bg-muted/50"
            disabled={isSwitchingSchema}
          >
            <SelectValue placeholder="Select schema" />
          </SelectTrigger>
          <SelectContent>
            {schemas.map((schema) => (
              <SelectItem key={schema} value={schema} className="text-xs">
                {schema}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Use Command component for long lists
    return (
      <Popover open={schemaPopoverOpen} onOpenChange={setSchemaPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={schemaPopoverOpen}
            disabled={isSwitchingSchema}
            className="text-xs min-w-[120px] max-w-[180px] justify-between border-0 !bg-background hover:bg-muted/50 h-8"
          >
            <span className="truncate">
              {selectedSchema || "Select schema"}
            </span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
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
                    <Check
                      className={cn(
                        "mr-2 h-3 w-3",
                        selectedSchema === schema ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {schema}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="flex items-center gap-1">{renderSchemaSelector()}</div>
  );
}
