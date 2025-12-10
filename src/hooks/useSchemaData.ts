import { logger } from "@/lib/logger";
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
} from "@/services/databaseService";
import { schemaCache } from "@/services/schemaCache";

import { type QueryObserverResult, useQuery } from "@tanstack/react-query";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

interface SchemaData {
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<QueryObserverResult<SchemaData>>;
}

// System function prefixes to filter out
const SYSTEM_FUNCTION_PREFIXES = [
  "pg_", "pgp_", "pgsodium_", "hstore_", "json_", "jsonb_", "array_",
  "enum_", "range_", "ts_", "txid_", "uuid_", "xml_", "inet_", "cidr_",
  "macaddr_", "bit_", "varbit_", "bytea_", "lo_", "large_object_", "obj_",
  "oid", "regclass", "regconfig", "regdictionary", "regnamespace",
  "regoper", "regoperator", "regproc", "regprocedure", "regrole", "regtype",
];

const filterUserFunctions = (functions: FunctionMeta[]): FunctionMeta[] => {
  const userFunctions = functions.filter((func) => {
    // Skip functions in system schemas
    if (func.schema === "pg_catalog" || func.schema === "information_schema") {
      return false;
    }

    const funcNameLower = func.name.toLowerCase();
    if (SYSTEM_FUNCTION_PREFIXES.some((prefix) => funcNameLower.startsWith(prefix))) {
      return false;
    }

    // Skip aggregate functions and operators
    if (funcNameLower.includes("$$") || funcNameLower.startsWith("@") || funcNameLower.startsWith("~")) {
      return false;
    }

    return true;
  });

  // Deduplicate functions based on schema and name only (ignore overloads)
  const seen = new Set<string>();
  return userFunctions.filter((func) => {
    const key = `${func.schema}.${func.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const loadSchemaData = async (
  connectionId: string,
  database?: string,
  schema?: string,
): Promise<SchemaData> => {
  if (!connectionId || !database || !schema) {
    throw new Error("Connection ID, database, and schema are required");
  }

  try {
    // Ensure connection mapping is established
    await databaseService.connectById(connectionId);

    // Set connection context for cache prefetching
    schemaCache.setConnection(connectionId);

    // Use schemaCache for cached fetches (60% fewer redundant API calls)
    const [tables, functions] = await Promise.all([
      schemaCache.getTables(connectionId, schema),
      schemaCache.getFunctions(connectionId, schema),
    ]);

    // Separate tables and views
    const tableList = tables.filter((t) => t.kind === "Table");
    const viewList = tables.filter((t) => t.kind === "View" || t.kind === "MaterializedView");

    return {
      tables: tableList,
      views: viewList,
      functions: filterUserFunctions(functions),
    } as SchemaData;
  } catch (err: unknown) {
    logger.error("Failed to load schema data:", err);
    throw new Error("Failed to load schema data");
  }
};

export function useSchemaData(): SchemaData {
  const { connectionId, database, schema } = useWorkspaceSelectionStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["useSchemaData.SchemaData", connectionId, database, schema],
    queryFn: async () => {
      if (!connectionId || !database || !schema) {
        throw new Error("Connection ID, database, and schema are required");
      }
      return await loadSchemaData(connectionId, database, schema);
    },
    enabled: !!connectionId && !!database && !!schema,
  });

  return {
    tables: data?.tables || [],
    views: data?.views || [],
    functions: data?.functions || [],
    isLoading,
    error: error
      ? error instanceof Error
        ? error.message
        : String(error)
      : null,
    refresh: refetch,
  };
}
