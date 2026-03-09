import { clearConnectionCache } from "@/lib/cacheManager";
import { schemaCache } from "@/services/schemaCache";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { getParadigm } from "@/types/connection";
import type { OpenConnection } from "@/types/workspace";

export function refreshConnectionData(connection: OpenConnection): void {
  schemaCache.invalidateConnection(connection.id);
  clearConnectionCache(connection.id);

  if (
    getParadigm(connection.profile.db_type) === "sql" &&
    connection.database
  ) {
    useDataInvalidationStore.getState().invalidateSchema(
      connection.id,
      connection.database,
      connection.schema,
    );
  }
}
