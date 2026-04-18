/**
 * Hook to sync schema data from TypeScript to Rust.
 *
 * TypeScript adapters (via IntrospectionService) are the SINGLE SOURCE OF TRUTH
 * for schema introspection. This hook pushes that data to Rust's SchemaStore
 * for use by sql_complete and sql_validate.
 */

import { useEffect, useRef } from "react";
import { schemaCache } from "@/services/schemaCache";
import {
  SqlEngineService,
  type TableInput,
  type ForeignKeyInput,
  type EnumInput,
  type FunctionInput,
} from "@/services/sqlEngineService";
import { logger } from "@/lib/logger";
import { isTauri } from "@/utils/tauri";
import type { EditorDiagnosticsStatus } from "@/components/CodeEditor/types";

interface UseRustSchemaSyncOptions {
  connectionId: string;
  database?: string;
  schema: string;
  enabled?: boolean;
}

// Track which schemas have been synced to avoid redundant pushes
const syncedSchemas = new Map<string, number>(); // key -> timestamp
const SYNC_DEBOUNCE_MS = 5000; // Don't re-sync within 5 seconds

/**
 * Check if Rust schema sync is available (Tauri environment)
 */
export function isRustSchemaSyncAvailable(): boolean {
  return isTauri();
}

export function getRustSchemaSyncStatus(
  connectionId: string,
  schema: string,
): Extract<EditorDiagnosticsStatus, "ready" | "stale_schema" | "unavailable"> {
  if (!isRustSchemaSyncAvailable()) {
    return "unavailable";
  }

  const syncKey = `${connectionId}:${schema}`;
  const lastSync = syncedSchemas.get(syncKey);
  if (!lastSync) {
    return "stale_schema";
  }

  return "ready";
}

/**
 * Sync schema data to Rust for completion/validation.
 * Non-blocking - failures are logged but don't throw.
 */
export async function syncSchemaToRust(
  connectionId: string,
  schema: string,
  database = ""
): Promise<void> {
  if (!isRustSchemaSyncAvailable()) {
    return;
  }

  const syncKey = `${connectionId}:${schema}`;
  const lastSync = syncedSchemas.get(syncKey);

  if (lastSync && Date.now() - lastSync < SYNC_DEBOUNCE_MS) {
    return; // Recently synced, skip
  }

  try {
    // Fetch from TypeScript cache (source of truth)
    const [tables, graph, dbFunctions] = await Promise.all([
      schemaCache.getTables(connectionId, schema),
      schemaCache.getRelationshipGraph(connectionId, schema).catch(() => ({
        relationships: new Map(),
        reverseRelationships: new Map(),
      })),
      schemaCache.getFunctions(connectionId, schema).catch(() => []),
    ]);

    // Build table data with columns
    const tableInputs: TableInput[] = await Promise.all(
      tables.map(async (t) => {
        const columns = await schemaCache.getTableColumns(
          connectionId,
          schema,
          t.name
        );
        return {
          name: t.name,
          tableType: mapTableKind(t.kind),
          columns: columns.map((col) => ({
            name: col.name,
            dataType: col.db_type,
            nullable: col.nullable,
            isPrimaryKey: col.is_pk,
          })),
        };
      })
    );

    // Build FK data from relationship graph
    const foreignKeys: ForeignKeyInput[] = [];
    for (const [sourceTable, rels] of graph.relationships) {
      for (const rel of rels) {
        foreignKeys.push({
          constraintName:
            rel.constraintName || `fk_${sourceTable}_${rel.sourceColumn}`,
          sourceTable,
          sourceColumn: rel.sourceColumn,
          targetTable: rel.targetTable,
          targetColumn: rel.targetColumn,
        });
      }
    }

    // TODO: Fetch enums if needed (PostgreSQL only)
    const enums: EnumInput[] = [];

    // Map functions to the format expected by Rust
    const functions: FunctionInput[] = dbFunctions.map((f) => ({
      name: f.name,
      returnType: f.return_type,
      arguments: f.arguments,
    }));

    // Push to Rust
    const result = await SqlEngineService.setSchema(
      connectionId,
      database,
      schema,
      tableInputs,
      foreignKeys,
      enums,
      functions
    );

    syncedSchemas.set(syncKey, Date.now());

    logger.debug("rust-schema-sync", "Schema synced to Rust", {
      connectionId,
      schema,
      tables: result.tableCount,
      columns: result.columnCount,
      functions: functions.length,
    });
  } catch (error) {
    logger.warn("rust-schema-sync", "Failed to sync schema to Rust", {
      connectionId,
      schema,
      error,
    });
  }
}

function mapTableKind(kind: string): "table" | "view" | "materialized_view" {
  switch (kind) {
    case "View":
      return "view";
    case "MaterializedView":
      return "materialized_view";
    default:
      return "table";
  }
}

/**
 * Clear Rust schema cache and reset sync state
 */
export async function clearRustSchema(
  connectionId: string,
  schema?: string
): Promise<void> {
  if (!isRustSchemaSyncAvailable()) {
    return;
  }

  try {
    await SqlEngineService.clearSchema(connectionId, schema);

    // Clear sync tracking
    if (schema) {
      syncedSchemas.delete(`${connectionId}:${schema}`);
    } else {
      for (const key of syncedSchemas.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          syncedSchemas.delete(key);
        }
      }
    }
  } catch (error) {
    logger.warn("rust-schema-sync", "Failed to clear Rust schema", {
      connectionId,
      schema,
      error,
    });
  }
}

/**
 * Hook to automatically sync schema to Rust when connection/schema changes.
 * Use in SqlEditor or other components that need Rust completion.
 */
export function useRustSchemaSync(options: UseRustSchemaSyncOptions): void {
  const { connectionId, database = "", schema, enabled = true } = options;
  const syncInProgress = useRef(false);

  useEffect(() => {
    if (!enabled || !connectionId || syncInProgress.current) {
      return;
    }

    syncInProgress.current = true;

    void syncSchemaToRust(connectionId, schema, database).finally(() => {
      syncInProgress.current = false;
    });
  }, [connectionId, database, schema, enabled]);

  // Cleanup on unmount - don't clear schema, just reset state
  useEffect(() => {
    return () => {
      syncInProgress.current = false;
    };
  }, []);
}

export default useRustSchemaSync;
