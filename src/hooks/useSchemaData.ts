import { logger } from "@/lib/logger";
import {
  databaseService,
  type TableMeta,
  type FunctionMeta,
  type SequenceMeta,
  type PackageMeta,
  type SynonymMeta,
} from "@/services/databaseService";
import { schemaCache } from "@/services/schemaCache";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";

import { type QueryObserverResult, useQuery } from "@tanstack/react-query";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useEffect, useMemo } from "react";

interface SchemaDataResult {
  tables: TableMeta[];
  views: TableMeta[];
  functions: FunctionMeta[];
  allFunctions: FunctionMeta[];
  sequences: SequenceMeta[];
  packages: PackageMeta[];
  synonyms: SynonymMeta[];
}

interface SchemaData extends SchemaDataResult {
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<QueryObserverResult<SchemaDataResult>>;
}

const filterUserFunctions = (functions: FunctionMeta[]): FunctionMeta[] => {
  const userFunctions = functions.filter((func) => {
    // Skip extension functions (flagged by pg_depend + pg_extension query)
    if (func.is_extension) {
      return false;
    }

    // Skip functions in system schemas
    if (func.schema === "pg_catalog" || func.schema === "information_schema") {
      return false;
    }

    const funcNameLower = func.name.toLowerCase();

    // Skip aggregate functions and operators
    if (funcNameLower.includes("$$") || funcNameLower.startsWith("@") || funcNameLower.startsWith("~")) {
      return false;
    }

    return true;
  });

  return deduplicateFunctions(userFunctions);
};

const deduplicateFunctions = (functions: FunctionMeta[]): FunctionMeta[] => {
  const seen = new Set<string>();
  return functions.filter((func) => {
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
): Promise<SchemaDataResult> => {
  if (!connectionId || !database || !schema) {
    logger.warn(`[useSchemaData] Missing required params - connectionId: ${connectionId}, database: ${database}, schema: ${schema}`);
    throw new Error("Connection ID, database, and schema are required");
  }

  try {
    logger.info(`[useSchemaData] Loading schema data for ${database}.${schema}`);
    
    // Ensure connection mapping is established
    await databaseService.connectById(connectionId);

    // Set connection context for cache prefetching
    schemaCache.setConnection(connectionId);

    // Use schemaCache for cached fetches (60% fewer redundant API calls)
    const [tables, functions, sequences, packages, synonyms] = await Promise.all([
      schemaCache.getTables(connectionId, schema),
      schemaCache.getFunctions(connectionId, schema),
      databaseService.listSequences(connectionId, database, schema).catch(() => []),
      databaseService.listPackages(connectionId, database, schema).catch(() => []),
      databaseService.listSynonyms(connectionId, database, schema).catch(() => []),
    ]);

    // Separate tables and views
    const tableList = tables.filter((t) => t.kind === "Table");
    const viewList = tables.filter((t) => t.kind === "View" || t.kind === "MaterializedView");

    const allFunctions = deduplicateFunctions(functions);
    logger.info(`[useSchemaData] Loaded ${tableList.length} tables, ${viewList.length} views, ${allFunctions.length} functions`);

    return {
      tables: tableList,
      views: viewList,
      functions: filterUserFunctions(functions),
      allFunctions,
      sequences,
      packages,
      synonyms,
    };
  } catch (err: unknown) {
    logger.error("Failed to load schema data:", err);
    throw new Error("Failed to load schema data");
  }
};

/**
 * Hook to load schema data (tables, views, functions) for a connection.
 *
 * @param overrideConnectionId - Optional connectionId to use instead of focused connection.
 *                               When provided, loads schema data for that specific connection.
 *                               When omitted, uses the currently focused connection.
 */
export function useSchemaData(overrideConnectionId?: string): SchemaData {
  // Narrow selectors — only re-render when the values we actually USE change.
  // Subscribing to the entire activeWorkspace caused every ConnectionSection
  // to re-render on any workspace change (e.g. setFocusedConnection), which
  // in multi-connection workspaces created a massive re-render cascade.

  // When overrideConnectionId is provided, subscribe to that connection's db/schema only
  const overrideDatabase = useWorkspaceBundleStore((s) =>
    overrideConnectionId
      ? (s.activeWorkspace?.connections.get(overrideConnectionId)?.database ??
        null)
      : null,
  );
  const overrideSchema = useWorkspaceBundleStore((s) =>
    overrideConnectionId
      ? (s.activeWorkspace?.connections.get(overrideConnectionId)?.schema ??
        null)
      : null,
  );

  // When no override, subscribe to focused connection's db/schema
  const focusedConnectionId = useWorkspaceBundleStore(
    (s) => s.activeWorkspace?.focusedConnectionId ?? null,
  );
  const focusedDatabase = useWorkspaceBundleStore((s) => {
    if (overrideConnectionId) return null; // skip if override is set
    const ws = s.activeWorkspace;
    if (!ws?.focusedConnectionId) return null;
    return ws.connections.get(ws.focusedConnectionId)?.database ?? null;
  });
  const focusedSchema = useWorkspaceBundleStore((s) => {
    if (overrideConnectionId) return null; // skip if override is set
    const ws = s.activeWorkspace;
    if (!ws?.focusedConnectionId) return null;
    return ws.connections.get(ws.focusedConnectionId)?.schema ?? null;
  });

  // Subscribe to legacy store for backwards compatibility (fallback only)
  const legacyConnectionId = useWorkspaceSelectionStore((s) => s.connectionId);
  const legacyDatabase = useWorkspaceSelectionStore((s) => s.database);
  const legacySchema = useWorkspaceSelectionStore((s) => s.schema);

  // Determine effective connection context
  let connectionId: string | null;
  let database: string | null;
  let schema: string | null;

  if (overrideConnectionId) {
    // Use override - get state from bundle store
    connectionId = overrideConnectionId;
    database = overrideDatabase;
    schema = overrideSchema;
  } else if (focusedConnectionId) {
    // Use focused connection from bundle store
    connectionId = focusedConnectionId;
    database = focusedDatabase;
    schema = focusedSchema;
  } else {
    // Fall back to legacy store
    connectionId = legacyConnectionId;
    database = legacyDatabase;
    schema = legacySchema;
  }

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

  // Subscribe to schema invalidations (table create/drop/duplicate)
  useEffect(() => {
    if (!connectionId || !database || !schema) return;

    const unsubscribe = useDataInvalidationStore.getState().subscribeSchema(
      connectionId,
      database,
      schema,
      () => {
        logger.info(`[useSchemaData] Schema invalidated, refreshing: ${database}.${schema}`);
        // Clear the schema cache so refetch gets fresh data from the database
        // Without this, schemaCache.getTables() returns stale cached data
        schemaCache.invalidateSchema(connectionId, schema);
        void refetch();
      }
    );

    return unsubscribe;
  }, [connectionId, database, schema, refetch]);

  // Stable empty arrays — avoids creating new [] references on every render
  // when data is undefined (which would cause downstream useMemo/useEffect churn)
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;

  return useMemo(
    () => ({
      tables: data?.tables ?? EMPTY_TABLES,
      views: data?.views ?? EMPTY_TABLES,
      functions: data?.functions ?? EMPTY_FUNCTIONS,
      allFunctions: data?.allFunctions ?? EMPTY_FUNCTIONS,
      sequences: data?.sequences ?? EMPTY_SEQUENCES,
      packages: data?.packages ?? EMPTY_PACKAGES,
      synonyms: data?.synonyms ?? EMPTY_SYNONYMS,
      isLoading,
      error: errorMessage,
      refresh: refetch,
    }),
    [data, isLoading, errorMessage, refetch],
  );
}

// Stable empty arrays shared across all hook instances
const EMPTY_TABLES: TableMeta[] = [];
const EMPTY_FUNCTIONS: FunctionMeta[] = [];
const EMPTY_SEQUENCES: SequenceMeta[] = [];
const EMPTY_PACKAGES: PackageMeta[] = [];
const EMPTY_SYNONYMS: SynonymMeta[] = [];
