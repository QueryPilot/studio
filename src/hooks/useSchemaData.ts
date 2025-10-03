import { useState, useEffect, useCallback } from "react";
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
} from "@/services/databaseService";

interface SchemaData {
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSchemaData(
  connectionId: string,
  database: string,
  schema: string,
): SchemaData {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    tables: TableMeta[];
    views: TableMeta[];
    functions: FunctionMeta[];
  }>({
    tables: [],
    views: [],
    functions: [],
  });

  const loadSchemaData = useCallback(async () => {
    if (!connectionId || !database || !schema) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Always ensure connection mapping is established before queries
      // The backend's get_or_create_connection is idempotent, so this is safe to call
      await databaseService.connectById(connectionId);

      // Load tables and functions in parallel
      const [tables, functions] = await Promise.all([
        databaseService.listTables(connectionId, database, schema),
        databaseService
          .listFunctions(connectionId, database, schema)
          .catch(() => []),
      ]);

      // Separate tables and views
      const tableList = tables.filter((t) => t.kind === "Table");
      const viewList = tables.filter(
        (t) => t.kind === "View" || t.kind === "MaterializedView",
      );

      // Filter out system functions and deduplicate
      const userFunctions = functions.filter((func) => {
        // Skip functions in system schemas
        if (
          func.schema === "pg_catalog" ||
          func.schema === "information_schema"
        ) {
          return false;
        }

        // Skip common PostgreSQL system function prefixes
        const systemPrefixes = [
          "pg_",
          "pgp_",
          "pgsodium_",
          "hstore_",
          "json_",
          "jsonb_",
          "array_",
          "enum_",
          "range_",
          "ts_",
          "txid_",
          "uuid_",
          "xml_",
          "inet_",
          "cidr_",
          "macaddr_",
          "bit_",
          "varbit_",
          "bytea_",
          "lo_",
          "large_object_",
          "obj_",
          "oid",
          "regclass",
          "regconfig",
          "regdictionary",
          "regnamespace",
          "regoper",
          "regoperator",
          "regproc",
          "regprocedure",
          "regrole",
          "regtype",
        ];

        const funcNameLower = func.name.toLowerCase();
        if (systemPrefixes.some((prefix) => funcNameLower.startsWith(prefix))) {
          return false;
        }

        // Skip aggregate functions and operators
        if (
          funcNameLower.includes("$$") ||
          funcNameLower.startsWith("@") ||
          funcNameLower.startsWith("~")
        ) {
          return false;
        }

        return true;
      });

      // Deduplicate functions based on schema and name only (ignore overloads)
      const uniqueFunctions = userFunctions.reduce<FunctionMeta[]>(
        (acc, func) => {
          const key = `${func.schema}.${func.name}`;
          if (!acc.some((f) => `${f.schema}.${f.name}` === key)) {
            acc.push(func);
          }
          return acc;
        },
        [],
      );

      setData({
        tables: tableList,
        views: viewList,
        functions: uniqueFunctions,
      });
    } catch (err) {
      console.error("Failed to load schema data:", err);
      setError("Failed to load schema objects");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema]);

  useEffect(() => {
    if (schema && database && connectionId) {
      void loadSchemaData();
    }
  }, [schema, database, connectionId, loadSchemaData]);

  return {
    tables: data.tables,
    views: data.views,
    functions: data.functions,
    isLoading,
    error,
    refresh: loadSchemaData,
  };
}
