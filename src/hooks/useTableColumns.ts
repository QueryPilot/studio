import { useState, useEffect } from "react";
import { databaseService } from "@/services/databaseService";

interface Column {
  name: string;
  db_type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  is_fk: boolean;
  comment: string | null;
}

interface UseTableColumnsOptions {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

interface UseTableColumnsResult {
  columns: Column[];
  isLoading: boolean;
  error: string | null;
}

export function useTableColumns({
  connectionId,
  database,
  table,
  schema,
}: UseTableColumnsOptions): UseTableColumnsResult {
  const [columns, setColumns] = useState<Column[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchColumns = async () => {
      if (!connectionId || !database || !table) {
        setColumns([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await databaseService.getTableColumns(
          connectionId,
          database,
          schema || "public",
          table
        );
        setColumns(result);
      } catch (err) {
        console.error("Failed to fetch table columns:", err);
        setError(err instanceof Error ? err.message : "Failed to load columns");
        setColumns([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchColumns();
  }, [connectionId, database, table, schema]);

  return { columns, isLoading, error };
}