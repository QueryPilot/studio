import { useQueries } from "@tanstack/react-query";
import { fetchTableStructure } from "./useTableFullStructure";

interface ForeignKeyRef {
  schema: string;
  table: string;
  column: string;
}

interface UseReferencedTableColumnsParams {
  connectionId: string;
  database: string;
  fkReferences: Map<string, ForeignKeyRef>;
  enabled?: boolean;
}

/**
 * Fetches columns for all referenced tables (for FK embed submenu)
 * Returns a map: fkColumnName -> referenced table columns
 */
export function useReferencedTableColumns({
  connectionId,
  database,
  fkReferences,
  enabled = true,
}: UseReferencedTableColumnsParams): Record<string, Array<{ name: string; db_type: string }>> {
  // Get unique referenced tables (schema.table)
  const uniqueTables = new Map<string, { schema: string; table: string; fkColumns: string[] }>();

  for (const [fkColumn, ref] of fkReferences) {
    const key = `${ref.schema}.${ref.table}`;
    const existing = uniqueTables.get(key);
    if (existing) {
      existing.fkColumns.push(fkColumn);
    } else {
      uniqueTables.set(key, { schema: ref.schema, table: ref.table, fkColumns: [fkColumn] });
    }
  }

  const tableEntries = Array.from(uniqueTables.entries());

  const queries = useQueries({
    queries: tableEntries.map(([key, { schema, table }]) => ({
      queryKey: ["referenced-table-columns", connectionId, database, schema, table],
      queryFn: async () => {
        const structure = await fetchTableStructure({
          connectionId,
          database,
          schema,
          table,
        });
        return {
          key,
          columns: structure.columns.map((col) => ({
            name: col.name,
            db_type: col.db_type,
          })),
        };
      },
      enabled: enabled && !!connectionId && !!database,
      staleTime: 5 * 60 * 1000, // 5 minutes
    })),
  });

  // Build result map: fkColumnName -> columns
  const result: Record<string, Array<{ name: string; db_type: string }>> = {};

  for (const query of queries) {
    if (query.data) {
      const { key, columns } = query.data;
      const tableInfo = uniqueTables.get(key);
      if (tableInfo) {
        for (const fkColumn of tableInfo.fkColumns) {
          result[fkColumn] = columns;
        }
      }
    }
  }

  return result;
}
