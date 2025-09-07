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
  
  // Create a unique key for this table to ensure data isolation
  const tableKey = `${connectionId}:${database}:${schema || 'public'}:${table}`;
  
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

  // Track the current table key to detect changes
  const [currentTableKey, setCurrentTableKey] = useState<string | null>(null);
  
  // Clear data when table changes
  useEffect(() => {
    if (currentTableKey && currentTableKey !== tableKey) {
      console.log(`[useInfiniteTableData] Table changed, clearing data`);
      clearData();
      setHasInitialized(false);
    }
    setCurrentTableKey(tableKey);
  }, [tableKey, currentTableKey, clearData]);

  // Load data when connected
  useEffect(() => {
    if (isConnected && !hasInitialized && !isLoading) {
      console.log(`[useInfiniteTableData] Loading data for table ${table} (key: ${tableKey})`);
      console.log(`[useInfiniteTableData] Connection ID: ${connectionId}`);
      console.log(`[useInfiniteTableData] Database: ${database}`);
      console.log(`[useInfiniteTableData] Schema: ${schema}`);
      setHasInitialized(true);
      void loadData({
        connectionId,
        database,
        table,
        schema,
      });
    }
  }, [isConnected, hasInitialized, isLoading, connectionId, database, table, schema, loadData, tableKey]);

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