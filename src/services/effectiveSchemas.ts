import { useConnectionStore } from "@/stores/connectionStoreNew";
import useWorkbenchStore from "@/stores/workbenchStore";

/**
 * Phase 1: resolve the effective schema list and database for a query.
 * Phase 2: optional `tabId` overlays per-tab schema overrides.
 */
export function resolveEffective(
  connectionId: string,
  databaseName: string,
  tabId?: string,
): { effectiveSchemas: string[]; effectiveDatabase: string } {
  const override = tabId
    ? useWorkbenchStore.getState().getTabSchemaOverride(tabId)
    : undefined;
  if (override) {
    return {
      effectiveSchemas: override.visibleSchemas,
      effectiveDatabase: override.effectiveDatabase ?? databaseName,
    };
  }
  const schemas = useConnectionStore
    .getState()
    .getVisibleSchemas(connectionId, databaseName);
  return { effectiveSchemas: schemas, effectiveDatabase: databaseName };
}

/**
 * Appends a hint message to schema-missing errors when a tab override is in effect.
 * Shared by databaseService and tableStreamingService error paths.
 */
export function appendOverrideHint(err: unknown, tabId?: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  const match = /schema "([^"]+)" does not exist/.exec(msg);
  const override = tabId
    ? useWorkbenchStore.getState().getTabSchemaOverride(tabId)
    : undefined;
  if (match && override) {
    throw new Error(
      `${msg}\nTab overrides schema \`${match[1]}\` which may not exist`,
    );
  }
  throw err instanceof Error ? err : new Error(msg);
}
