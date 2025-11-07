import React, { useEffect, useState, useMemo } from "react";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import type { SqlDialect } from "@/components/CodeEditor";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";

interface ObjectDefinitionProps {
  connectionId: string;
  database: string;
  schema: string;
  objectName: string;
  objectType: "table" | "view" | "materialized_view" | "function" | "procedure";
  className?: string;
  onDefinitionLoad?: (definition: string) => void;
}

export const ObjectDefinition: React.FC<ObjectDefinitionProps> = React.memo(
  ({
    connectionId,
    database,
    schema,
    objectName,
    objectType,
    className,
    onDefinitionLoad,
  }) => {
    const [definition, setDefinition] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const connections = useConnectionStore((state) => state.connections);

    // Determine database dialect from connection
    const dialect = useMemo<SqlDialect>(() => {
      const profile = connections.find((c) => c.profile.id === connectionId)?.profile;
      if (!profile) return "plsql";

      switch (profile.db_type) {
        case DbType.PostgreSQL:
          if (objectType === "function" || objectType === "procedure") {
            return "plsql";
          }
          return "postgresql";
        case DbType.MySQL:
          return "mysql";
        case DbType.SQLite:
          return "sqlite";
        case DbType.SQLServer:
          return "mssql";
        default:
          return "postgresql";
      }
    }, [connectionId, connections, objectType]);

    useEffect(() => {
      const fetchDefinition = async () => {
        try {
          setLoading(true);
          setError(null);

          const def = await databaseService.getObjectDefinition(
            connectionId,
            database,
            schema,
            objectName,
            objectType,
          );

          setDefinition(def);
          onDefinitionLoad?.(def);
        } catch (err) {
          console.error("Failed to fetch object definition:", err);
          setError(
            err instanceof Error ? err.message : "Failed to fetch definition",
          );
        } finally {
          setLoading(false);
        }
      };

      void fetchDefinition();
    }, [
      connectionId,
      database,
      schema,
      objectName,
      objectType,
      onDefinitionLoad,
    ]);

    if (loading) {
      return (
        <div
          className={cn("flex items-center justify-center h-full", className)}
        >
          <div className="text-muted-foreground">Loading definition...</div>
        </div>
      );
    }

    if (error) {
      return (
        <div
          className={cn("flex items-center justify-center h-full", className)}
        >
          <div className="text-red-500">Error: {error}</div>
        </div>
      );
    }

    return (
      <div className={cn("h-full overflow-hidden", className)}>
        <CodeEditor
          value={definition}
          language="sql"
          dialect={dialect}
          readOnly={true}
          height="100%"
          theme="auto"
          lineNumbers={true}
          autoFocus={false}
        />
      </div>
    );
  },
);

ObjectDefinition.displayName = "ObjectDefinition";
