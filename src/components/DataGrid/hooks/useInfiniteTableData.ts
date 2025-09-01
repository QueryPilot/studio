import { useEffect } from "react";
import { useTableData } from "@/hooks/useTableData";

interface UseInfiniteTableDataParams {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export function useInfiniteTableData(params: UseInfiniteTableDataParams) {
  const { connectionId, database, table, schema } = params;

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
  } = useTableData();

  // Load initial data when component mounts or params change
  useEffect(() => {
    void loadData({
      connectionId,
      database,
      table,
      schema,
    });
  }, [connectionId, database, table, schema, loadData]);

  return {
    isLoading,
    isLoadingMore,
    error,
    columns,
    rows,
    estimatedTotal,
    loadMore,
    hasNextPage,
    isFetchingNextPage: isLoadingMore,
  };
}