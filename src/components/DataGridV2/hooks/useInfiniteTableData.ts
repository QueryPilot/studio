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
  const [hasInitialized, setHasInitialized] = useState(false);

  // Get the table data hook - each table gets its own instance
  const {
    isLoading,
    isLoadingMore,
    error,
    columns,
    rows,
    hasNextPage,
    nextCursor,
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
        setHasInitialized(false);
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

  // Track the current table to detect changes
  const [currentTable, setCurrentTable] = useState<string | null>(null);
  const tableKey = `${connectionId}:${database}:${schema || 'public'}:${table}`;

  // Clear data when table changes
  useEffect(() => {
    if (currentTable && currentTable !== tableKey) {
      clearData();
      setHasInitialized(false);
    }
    setCurrentTable(tableKey);
  }, [connectionId, database, schema, table, clearData]);

  // Load data when connected
  useEffect(() => {
    if (isConnected && !hasInitialized && !isLoading) {
      setHasInitialized(true);
      void loadData({
        connectionId,
        database,
        table,
        schema,
      });
    }
  }, [isConnected, hasInitialized, isLoading, connectionId, database, table, schema, loadData]);

  return {
    isLoading,
    isLoadingMore,
    error: connectionError || error,
    columns,
    rows,
    estimatedTotal,
    loadMore,
    hasNextPage,
    nextCursor,
    isFetchingNextPage: isLoadingMore,
    isConnected,
  };
}