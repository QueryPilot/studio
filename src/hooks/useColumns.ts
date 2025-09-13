import { useState, useEffect } from 'react';
import { BackendAPI, type ColumnMeta } from '@/services/backend';

interface UseColumnsParams {
  connectionId: string;
  schema: string;
  table: string;
}

interface UseColumnsResult {
  columns: ColumnMeta[];
  isLoading: boolean;
  error: Error | null;
}

export function useColumns({ connectionId, schema, table }: UseColumnsParams): UseColumnsResult {
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!connectionId || !table) {
      setColumns([]);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const fetchColumns = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const result = await BackendAPI.getColumns(connectionId, schema, table);
        
        if (!isCancelled) {
          setColumns(result);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err as Error);
          setColumns([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchColumns();

    return () => {
      isCancelled = true;
    };
  }, [connectionId, schema, table]);

  return { columns, isLoading, error };
}