import { useState, useEffect } from "react";
import { Database } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { databaseService } from "@/services/databaseService";
import { useConnectionStore } from "@/stores/connectionStore";
import { cn } from "@/lib/utils";

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
  const { connections } = useConnectionStore();
  const connection = connections.find(c => c.id === connectionId);

  // Load databases on mount
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
  }, [connectionId]);

  // Load schemas when database changes
  useEffect(() => {
    if (selectedDatabase) {
      void loadSchemas();
    }
  }, [selectedDatabase]);

  const loadDatabases = async () => {
    try {
      const dbs = await databaseService.listDatabases(connectionId);
      setDatabases(dbs);
      
      // Auto-select the current database or first available
      if (!selectedDatabase) {
        if (connection?.database && dbs.includes(connection.database)) {
          onDatabaseChange(connection.database);
        } else if (dbs.length > 0) {
          onDatabaseChange(dbs[0] || "");
        }
      }
    } catch (err) {
      console.error("Failed to load databases:", err);
      if (connection) {
        // Use the connection's database or fallback to default
        const dbName = connection.database || "default";
        setDatabases([dbName]);
        if (!selectedDatabase) {
          onDatabaseChange(dbName);
        }
      }
    }
  };

  const loadSchemas = async () => {
    try {
      const schemaList = await databaseService.listSchemas(
        connectionId,
        selectedDatabase,
      );
      setSchemas(schemaList);

      // Auto-select schema
      if (schemaList.length > 0) {
        const publicSchema = schemaList.find(
          (s) => s.toLowerCase() === "public",
        );
        const defaultSchema = schemaList.find((s) => s.toLowerCase() === "dbo");
        onSchemaChange(publicSchema || defaultSchema || schemaList[0] || "");
      }
    } catch (err) {
      console.error("Failed to load schemas:", err);
      setSchemas(["default"]);
      onSchemaChange("default");
    }
  };

  return (
    <div className="flex items-center gap-1 px-2">
      {databases.length > 0 && (
        <Select value={selectedDatabase} onValueChange={onDatabaseChange}>
          <SelectTrigger className="h-9 text-sm min-w-[120px] max-w-[180px] border-0 bg-transparent hover:bg-muted/50">
            <Database className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Select database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db} value={db}>
                {db}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {schemas.length > 0 && (
        <Select value={selectedSchema} onValueChange={onSchemaChange}>
          <SelectTrigger className={cn(
            "h-9 text-sm border-0 bg-transparent hover:bg-muted/50",
            databases.length > 1 ? "min-w-[100px] max-w-[150px]" : "min-w-[120px] max-w-[180px]"
          )}>
            <SelectValue placeholder="Select schema" />
          </SelectTrigger>
          <SelectContent>
            {schemas.map((schema) => (
              <SelectItem key={schema} value={schema}>
                {schema}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}