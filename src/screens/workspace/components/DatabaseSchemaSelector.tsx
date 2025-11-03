import { useState, useEffect, useCallback } from "react";
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
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [isSwitchingSchema, setIsSwitchingSchema] = useState(false);
  const { connections } = useConnectionStore();
  const connection = connections.find((c) => c.profile.id === connectionId)?.profile;

  const handleDatabaseSelect = useCallback(
    (database: string) => {
      onDatabaseChange(database);
      onSchemaChange("");
    },
    [onDatabaseChange, onSchemaChange],
  );

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

  const handleSchemaSelect = useCallback(
    (schema: string) => {
      void selectSchema(schema);
    },
    [selectSchema],
  );

  const loadDatabases = useCallback(async () => {
    try {
      const dbs = await databaseService.listDatabases(connectionId);
      setDatabases(dbs);

      if (dbs.length === 0) {
        return;
      }

      if (!selectedDatabase) {
        if (connection?.database && dbs.includes(connection.database)) {
          onDatabaseChange(connection.database);
          onSchemaChange("");
        } else if (dbs[0]) {
          onDatabaseChange(dbs[0]);
          onSchemaChange("");
        }
        return;
      }

      if (!dbs.includes(selectedDatabase)) {
        const fallback =
          (connection?.database && dbs.includes(connection.database)
            ? connection.database
            : dbs[0]) || "";
        if (fallback) {
          onDatabaseChange(fallback);
          onSchemaChange("");
        }
      }
    } catch (err) {
      console.error("Failed to load databases:", err);
      toast.error("Failed to load databases");
      if (connection) {
        const dbName = connection.database || "default";
        setDatabases([dbName]);
        if (!selectedDatabase) {
          onDatabaseChange(dbName);
          onSchemaChange("");
        }
      }
    }
  }, [
    connection,
    connectionId,
    onDatabaseChange,
    onSchemaChange,
    selectedDatabase,
  ]);

  useEffect(() => {
    if (connectionId) {
      const checkAndLoad = async () => {
        let retries = 0;
        const maxRetries = 10;

        while (retries < maxRetries) {
          if (databaseService.isConnectionActive(connectionId)) {
            void loadDatabases();
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          retries++;
        }
      };

      void checkAndLoad();
    }
  }, [connectionId, loadDatabases]);

  const loadSchemas = useCallback(async () => {
    if (!selectedDatabase) {
      setSchemas([]);
      onSchemaChange("");
      return;
    }

    try {
      const schemaList = await databaseService.listSchemas(
        connectionId,
        selectedDatabase,
      );
      setSchemas(schemaList);

      if (schemaList.length === 0) {
        onSchemaChange("");
        return;
      }

      if (selectedSchema && schemaList.includes(selectedSchema)) {
        await selectSchema(selectedSchema, { force: true });
        return;
      }

      const publicSchema = schemaList.find(
        (s) => s.toLowerCase() === "public",
      );
      const defaultSchema = schemaList.find((s) => s.toLowerCase() === "dbo");
      const fallback = publicSchema || defaultSchema || schemaList[0];
      if (fallback) {
        await selectSchema(fallback);
      }
    } catch (err) {
      console.error("Failed to load schemas:", err);
      toast.error("Failed to load schemas");
      setSchemas(["default"]);
      onSchemaChange("default");
    }
  }, [
    connectionId,
    onSchemaChange,
    selectSchema,
    selectedDatabase,
    selectedSchema,
  ]);

  useEffect(() => {
    if (selectedDatabase) {
      void loadSchemas();
    }
  }, [selectedDatabase, loadSchemas]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      cleanup = await safeListen<{ connectionId: string }>(
        "database-reconnected",
        (event) => {
          if (event.payload.connectionId === connectionId) {
            void loadDatabases().then(() => {
              if (selectedDatabase) {
                void loadSchemas();
              }
            });
          }
        },
      );
    };

    void setupListener();

    return () => {
      if (cleanup) cleanup();
    };
  }, [connectionId, selectedDatabase, loadDatabases, loadSchemas]);

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
