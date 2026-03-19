import { logger } from "@/lib/logger";
import React, { useEffect, useState, useMemo } from "react";
import { databaseService } from "@/services/databaseService";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import type { SqlDialect } from "@/components/CodeEditor";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { detectDialectForObject } from "@/utils/dialectDetector";
import { formatSql } from "@/utils/codeFormatter";
import type { ObjectDefinitionType } from "@/adapters/types";

interface ObjectDefinitionProps {
  connectionId: string;
  database: string;
  schema: string;
  objectName: string;
  objectType: ObjectDefinitionType;
  className?: string;
  onDefinitionLoad?: (definition: string) => void;
  onLoaded?: () => void;
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
    onLoaded,
  }) => {
    const [definition, setDefinition] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { if (!loading) onLoaded?.(); }, [loading, onLoaded]);
    const connections = useConnectionStore((state) => state.connections);

    // Determine database dialect from connection using smart detection
    const dialect = useMemo<SqlDialect>(() => {
      const profile = connections.find(
        (c) => c.profile.id === connectionId,
      )?.profile;
      if (!profile) return "plsql";

      return detectDialectForObject(profile.db_type, objectType);
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

          const formatted = formatSql(def, dialect);
          setDefinition(formatted);
          onDefinitionLoad?.(formatted);
        } catch (err) {
          logger.error("Failed to fetch object definition:", err);
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
      dialect,
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
          <div className="text-red-500 select-text">Error: {error}</div>
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
