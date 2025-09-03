import { useEffect, useState } from "react";
import { useTableData } from "@/hooks/useTableData";
import { databaseService } from "@/services/databaseService";

interface UseInfiniteTableDataParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export function useInfiniteTableData(params: UseInfiniteTableDataParams) {
  const { connectionId, database, table, schema } = params;
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Get the table data hook
  const {
    isLoading,
    isLoadingMore,
    error,
    columns,
    rows,
    hasNextPage,
    estimatedTotal,
    loadData,
    loadMore,
    clearData,
  } = useTableData();

  // Check connection status and listen for changes
  useEffect(() => {
    // Check if connection is active
    const checkConnection = () => {
      const activeConnection = databaseService.getActiveConnection(connectionId);
      if (activeConnection) {
        setIsConnected(true);
        setConnectionError(null);
      } else {
        setIsConnected(false);
        setConnectionError("Not connected to database");
        clearData(); // Clear any existing data
      }
    };

    // Initial check
    checkConnection();

    // Periodically check connection status
    const interval = setInterval(() => {
      checkConnection();
    }, 5000); // Check every 5 seconds

    return () => {
      clearInterval(interval);
    };
  }, [connectionId, clearData]);

  // Load initial data only when connected
  useEffect(() => {
    if (isConnected) {
      void loadData({
        connectionId,
        database,
        table,
        schema,
      });
    }
  }, [isConnected, connectionId, database, table, schema, loadData]);

  return {
    isLoading,
    isLoadingMore,
    error: connectionError || error,
    columns,
    rows,
    estimatedTotal,
    loadMore,
    hasNextPage,
    isFetchingNextPage: isLoadingMore,
    isConnected,
  };
}