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
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";

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

const loadSchemaDataForOne = async (
  connectionId: string,
  database: string,
  schema: string,
): Promise<SchemaDataResult> => {
  // Use schemaCache for cached fetches (60% fewer redundant API calls)
  const [tables, functions, sequences, packages, synonyms] = await Promise.all([
    schemaCache.getTables(connectionId, schema),
    schemaCache.getFunctions(connectionId, schema),
    databaseService.listSequences(connectionId, database, schema).catch(() => []),
    databaseService.listPackages(connectionId, database, schema).catch(() => []),
    databaseService.listSynonyms(connectionId, database, schema).catch(() => []),
  ]);

  const tableList = tables.filter((t) => t.kind === "Table");
  const viewList = tables.filter((t) => t.kind === "View" || t.kind === "MaterializedView");

  return {
    tables: tableList,
    views: viewList,
    functions: filterUserFunctions(functions),
    allFunctions: deduplicateFunctions(functions),
    sequences,
    packages,
    synonyms,
  };
};

const loadSchemaData = async (
  connectionId: string,
  database?: string,
  schemas?: string[],
): Promise<SchemaDataResult> => {
  if (!connectionId || !database || !schemas || schemas.length === 0) {
    logger.warn(`[useSchemaData] Missing required params - connectionId: ${connectionId}, database: ${database}, schemas: ${schemas}`);
    throw new Error("Connection ID, database, and schemas are required");
  }

  try {
    logger.info(`[useSchemaData] Loading schema data for ${database} schemas: [${schemas.join(", ")}]`);

    // Ensure connection mapping is established
    await databaseService.connectById(connectionId);

    // Set connection context for cache prefetching
    schemaCache.setConnection(connectionId);

    // Fetch all visible schemas in parallel
    const results = await Promise.all(
      schemas.map((s) => loadSchemaDataForOne(connectionId, database, s)),
    );

    // Merge results from all schemas
    const merged: SchemaDataResult = {
      tables: results.flatMap((r) => r.tables),
      views: results.flatMap((r) => r.views),
      functions: results.flatMap((r) => r.functions),
      allFunctions: deduplicateFunctions(results.flatMap((r) => r.allFunctions)),
      sequences: results.flatMap((r) => r.sequences),
      packages: results.flatMap((r) => r.packages),
      synonyms: results.flatMap((r) => r.synonyms),
    };

    logger.info(`[useSchemaData] Loaded ${merged.tables.length} tables, ${merged.views.length} views, ${merged.allFunctions.length} functions across ${schemas.length} schemas`);

    return merged;
  } catch (err: unknown) {
    logger.error("Failed to load schema data:", err);
    throw new Error("Failed to load schema data", { cause: err });
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

  // Resolve all visible schemas for this connection+database.
  // Returns a stable JSON string to avoid Zustand re-render loops from new array references.
  const visibleSchemasKey = useConnectionStore((s) => {
    if (!connectionId) return null;
    let vs: string[] = [];
    // Try workspace database first, then fall back to connection profile's database
    if (database) {
      vs = s.getVisibleSchemas(connectionId, database);
    }
    if (vs.length === 0) {
      // Fallback: try the connection profile's database field (handles DuckDB file paths, etc.)
      const conn = s.getConnection(connectionId);
      if (conn?.profile.database) {
        vs = s.getVisibleSchemas(connectionId, conn.profile.database);
      }
      // Last resort: check if there's exactly one database entry with visible schemas
      if (vs.length === 0) {
        const dbs = conn?.profile.databases;
        const singleDb = dbs?.[0];
        if (dbs?.length === 1 && singleDb && singleDb.visible_schemas.length > 0) {
          vs = singleDb.visible_schemas;
        }
      }
    }
    if (vs.length === 0) return null;
    // For DuckDB/MotherDuck, filter out attached database schemas (e.g. "pg.public")
    // — those are loaded separately by DuckDbAttachedDatabaseSection
    const conn = s.getConnection(connectionId);
    if (conn && (conn.profile.db_type === DbType.DuckDB || conn.profile.db_type === DbType.MotherDuck)) {
      vs = vs.filter((name) => !name.includes("."));
    }
    // Return a stable primitive (string) instead of a new array to prevent infinite re-renders
    return vs.length > 0 ? vs.join("\0") : null;
  });
  // Parse the stable key back into an array
  const visibleSchemas = visibleSchemasKey ? visibleSchemasKey.split("\0") : null;
  const schemas = visibleSchemas ?? (schema ? [schema] : null);
  // Stable key for react-query: sorted copy so order changes don't refetch
  const schemasKey = schemas ? [...schemas].sort().join(",") : null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["useSchemaData.SchemaData", connectionId, database, schemasKey],
    queryFn: async () => {
      if (!connectionId || !database || !schemas || schemas.length === 0) {
        throw new Error("Connection ID, database, and schemas are required");
      }
      return await loadSchemaData(connectionId, database, schemas);
    },
    enabled: !!connectionId && !!database && !!schemasKey,
  });

  // Subscribe to schema invalidations (table create/drop/duplicate)
  useEffect(() => {
    if (!connectionId || !database || !schemas) return;

    const unsubs = schemas.map((s) =>
      useDataInvalidationStore.getState().subscribeSchema(
        connectionId,
        database,
        s,
        () => {
          logger.info(`[useSchemaData] Schema invalidated, refreshing: ${database}.${s}`);
          schemaCache.invalidateSchema(connectionId, s);
          void refetch();
        },
      ),
    );

    return () => { unsubs.forEach((u) => { u(); }); };
  }, [connectionId, database, schemasKey, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

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
