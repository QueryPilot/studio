import { useState, useEffect } from "react";
import type { ColumnMeta } from "@/types/database";
import { databaseService } from "@/services/databaseService";

interface UseTableStructureParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

interface UseTableStructureReturn {
  columns: ColumnMeta[];
  isLoading: boolean;
  error: string | null;
}

export function useTableStructure({
  connectionId,
  database,
  table,
  schema,
}: UseTableStructureParams): UseTableStructureReturn {
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId || !database || !table) return;

    const fetchStructure = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const targetSchema = schema || "public";
        const columns = await databaseService.getTableColumns(
          connectionId,
          database,
          targetSchema,
          table
        );
        
        setColumns(columns);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load table structure");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchStructure();
  }, [connectionId, database, table, schema]);

  return { columns, isLoading, error };
}