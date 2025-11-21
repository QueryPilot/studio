import { schemaCache } from "@/services/schemaCache";
import type { MetadataProvider, EntityMeta, FieldMeta, EntityDetails } from "../../types";

/**
 * SQL implementation of MetadataProvider.
 * Wraps schemaCache to provide table and column metadata.
 */
export class SqlMetadataProvider implements MetadataProvider {
  private connectionId: string;
  private defaultSchema: string;

  constructor(connectionId: string, defaultSchema: string = "public") {
    this.connectionId = connectionId;
    this.defaultSchema = defaultSchema;
  }

  async listEntities(schema?: string): Promise<EntityMeta[]> {
    const targetSchema = schema || this.defaultSchema;

    try {
      const tables = await schemaCache.getTables(this.connectionId, targetSchema);

      return tables.map((t) => ({
        name: t.name,
        type: this.mapTableKind(t.kind),
        schema: t.schema || targetSchema,
        description: undefined,
      }));
    } catch (err) {
      console.error(`[SqlMetadataProvider] Failed to list entities for schema "${targetSchema}":`, err);
      return [];
    }
  }

  async listFields(entityName: string, schema?: string): Promise<FieldMeta[]> {
    const targetSchema = schema || this.defaultSchema;

    try {
      const columns = await schemaCache.getTableColumns(
        this.connectionId,
        targetSchema,
        entityName
      );

      return columns.map((col) => ({
        name: col.name,
        dataType: col.db_type,
        parentEntity: entityName,
        description: col.comment || undefined,
        nullable: col.nullable,
        isPrimaryKey: col.is_pk,
      }));
    } catch (err) {
      console.error(`[SqlMetadataProvider] Failed to list fields for "${targetSchema}.${entityName}":`, err);
      return [];
    }
  }

  async getEntityDetails(entityName: string, schema?: string): Promise<EntityDetails | null> {
    const targetSchema = schema || this.defaultSchema;

    try {
      // Get table info
      const tables = await schemaCache.getTables(this.connectionId, targetSchema);
      const table = tables.find(t => t.name.toLowerCase() === entityName.toLowerCase());

      if (!table) return null;

      // Get columns for the table
      const columns = await schemaCache.getTableColumns(
        this.connectionId,
        targetSchema,
        entityName
      );

      const fields: FieldMeta[] = columns.map((col) => ({
        name: col.name,
        dataType: col.db_type,
        parentEntity: entityName,
        description: col.comment || undefined,
        nullable: col.nullable,
        isPrimaryKey: col.is_pk,
      }));

      return {
        name: table.name,
        type: table.kind,
        schema: targetSchema,
        description: undefined, // Could add table comment if available
        rowCount: table.row_estimate,
        fields,
      };
    } catch (err) {
      console.error(`[SqlMetadataProvider] Failed to get details for "${entityName}":`, err);
      return null;
    }
  }

  private mapTableKind(kind: string): EntityMeta["type"] {
    switch (kind) {
      case "Table":
        return "table";
      case "View":
        return "view";
      case "MaterializedView":
        return "materialized_view";
      default:
        return "table";
    }
  }
}

/**
 * Factory function to create a SqlMetadataProvider.
 */
export function createSqlMetadataProvider(
  connectionId: string,
  defaultSchema?: string
): MetadataProvider {
  return new SqlMetadataProvider(connectionId, defaultSchema);
}
