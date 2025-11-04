import { useEffect, useCallback } from "react";
import { Database } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { databaseService } from "@/services/databaseService";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { cn } from "@/lib/utils";
import { safeListen } from "@/utils/tauri";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface DatabaseSchemaSelectorProps {
  connectionId: string;
  selectedDatabase: string;
  selectedSchema: string;
  onDatabaseChange: (database: string) => void;
  onSchemaChange: (schema: string) => void;
}

export function DatabaseSchemaSelector({
  connectionId,
  selectedDatabase,
  selectedSchema,
  onDatabaseChange,
  onSchemaChange,
}: DatabaseSchemaSelectorProps) {
  const [isSwitchingSchema, setIsSwitchingSchema] = useState(false);
  const queryClient = useQueryClient();
  const { connections } = useConnectionStore();
  const connection = connections.find(
    (c) => c.profile.id === connectionId,
  )?.profile;

  // Check if connection is active
  const isConnectionActive = databaseService.isConnectionActive(connectionId);

  // Query for databases list
  const {
    data: databases = [],
    isLoading: isLoadingDatabases,
    error: databasesError,
  } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => {
      if (!databaseService.isConnectionActive(connectionId)) {
        throw new Error("Connection is not active");
      }
      return await databaseService.listDatabases(connectionId);
    },
    enabled: !!connectionId && isConnectionActive,
    staleTime: 60_000, // 1 minute
    retry: 2,
  });

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
      return await databaseService.listSchemas(connectionId, selectedDatabase);
    },
    enabled: !!connectionId && !!selectedDatabase && isConnectionActive,
    staleTime: 60_000, // 1 minute
    retry: 2,
  });

  // Handle database errors
  useEffect(() => {
    if (databasesError) {
      console.error("Failed to load databases:", databasesError);
      toast.error("Failed to load databases");
    }
  }, [databasesError]);

  // Handle schema errors
  useEffect(() => {
    if (schemasError) {
      console.error("Failed to load schemas:", schemasError);
      toast.error("Failed to load schemas");
    }
  }, [schemasError]);

  // Auto-select database when databases are loaded
  useEffect(() => {
    if (!databases.length || selectedDatabase || isLoadingDatabases) {
      return;
    }

    // Select default database
    const defaultDb =
      connection?.database && databases.includes(connection.database)
        ? connection.database
        : databases[0];

    if (defaultDb) {
      onDatabaseChange(defaultDb);
      onSchemaChange("");
    }
  }, [
    databases,
    selectedDatabase,
    connection,
    onDatabaseChange,
    onSchemaChange,
    isLoadingDatabases,
  ]);

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

  const handleDatabaseSelect = useCallback(
    (database: string) => {
      onDatabaseChange(database);
      onSchemaChange("");
    },
    [onDatabaseChange, onSchemaChange],
  );

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
      cleanup = await safeListen<{ connectionId: string }>(
        "database-reconnected",
        (event) => {
          if (event.payload.connectionId === connectionId) {
            // Invalidate and refetch both databases and schemas
            void queryClient.invalidateQueries({
              queryKey: ["databases", connectionId],
            });
            void queryClient.invalidateQueries({
              queryKey: ["schemas", connectionId],
            });
          }
        },
      );
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, queryClient]);

  return (
    <div className="flex items-center gap-1">
      {databases.length > 0 && (
        <Select value={selectedDatabase} onValueChange={handleDatabaseSelect}>
          <SelectTrigger className="text-xs min-w-[120px] max-w-[180px] border-0 !bg-background hover:bg-muted/50">
            <Database className="!h-3.5 !w-3.5 mr-1" />
            <SelectValue placeholder="Select database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db} value={db} className="text-xs">
                {db}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {schemas.length > 0 && (
        <Select value={selectedSchema} onValueChange={handleSchemaSelect}>
          <SelectTrigger
            className={cn(
              "text-xs border-0 !bg-background hover:bg-muted/50",
              databases.length > 1
                ? "min-w-[100px] max-w-[150px]"
                : "min-w-[120px] max-w-[180px]",
            )}
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
      )}
    </div>
  );
}
