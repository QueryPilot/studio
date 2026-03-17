import { quoteIdentifier } from "@/adapters/formatting";
import { schemaCache } from "@/services/schemaCache";
import type { ForeignKeyRelationship } from "@/types/relationships";
import type {
  MetadataProvider,
  EntityMeta,
  FieldMeta,
  EntityDetails,
  JoinConditionSuggestion,
  FunctionMeta,
  SqlDialect,
} from "../../types";

/**
 * SQL implementation of MetadataProvider.
 * Wraps schemaCache to provide table and column metadata.
 */
export class SqlMetadataProvider implements MetadataProvider {
  private connectionId: string;
  private defaultSchema: string;
  private dialect: SqlDialect;

  constructor(
    connectionId: string,
    defaultSchema: string = "public",
    dialect: SqlDialect = "postgresql"
  ) {
    this.connectionId = connectionId;
    this.defaultSchema = defaultSchema;
    this.dialect = dialect;
  }

  private isSameTable(
    scopeTable: { name: string; schema?: string },
    targetTable: { name: string; schema?: string },
    targetSchema: string
  ): boolean {
    const scopeSchema = (scopeTable.schema || targetSchema).toLowerCase();
    const candidateSchema = (targetTable.schema || targetSchema).toLowerCase();

    return (
      scopeSchema === candidateSchema &&
      scopeTable.name.toLowerCase() === targetTable.name.toLowerCase()
    );
  }

  private formatQualifier(name: string, isAlias: boolean): string {
    return isAlias ? name : quoteIdentifier(name, this.dialect);
  }

  private formatColumnRef(
    tableRef: { name: string; alias?: string },
    column: string
  ): string {
    const qualifier = tableRef.alias || tableRef.name;
    return `${this.formatQualifier(qualifier, Boolean(tableRef.alias))}.${quoteIdentifier(column, this.dialect)}`;
  }

  private buildJoinCondition(
    leftTable: { name: string; alias?: string },
    leftFallbackColumn: string,
    rightTable: { name: string; alias?: string },
    rightFallbackColumn: string,
    relationship?: Pick<ForeignKeyRelationship, "sourceColumns" | "targetColumns">
  ): string {
    const leftColumns =
      relationship?.sourceColumns && relationship.sourceColumns.length > 0
        ? relationship.sourceColumns
        : [leftFallbackColumn];
    const rightColumns =
      relationship?.targetColumns && relationship.targetColumns.length > 0
        ? relationship.targetColumns
        : [rightFallbackColumn];
    const pairCount = Math.min(leftColumns.length, rightColumns.length);

    return Array.from({ length: pairCount }, (_, index) => {
      const leftColumn = leftColumns[index] ?? leftFallbackColumn;
      const rightColumn = rightColumns[index] ?? rightFallbackColumn;
      return `${this.formatColumnRef(leftTable, leftColumn)} = ${this.formatColumnRef(rightTable, rightColumn)}`;
    }).join(" AND ");
  }

  private normalizeTypeFamily(dataType: string | undefined): string {
    if (!dataType) return "unknown";

    const normalized = dataType.toLowerCase();
    const base = normalized.split("(")[0]?.trim() || normalized.trim();

    if (
      /(smallint|integer|bigint|serial|bigserial|numeric|decimal|number|float|double|real|money)/.test(
        base
      )
    ) {
      return "number";
    }
    if (/(uuid|uniqueidentifier)/.test(base)) return "uuid";
    if (/(char|varchar|nvarchar|nchar|text|clob|string)/.test(base)) return "text";
    if (/(timestamp|datetime|date|time)/.test(base)) return "datetime";
    if (/(bool)/.test(base)) return "boolean";
    if (/(json|jsonb)/.test(base)) return "json";
    if (/(blob|binary|varbinary|bytea)/.test(base)) return "binary";

    return base;
  }

  private areJoinTypesCompatible(
    leftType: string | undefined,
    rightType: string | undefined
  ): boolean {
    const left = this.normalizeTypeFamily(leftType);
    const right = this.normalizeTypeFamily(rightType);

    if (left === "unknown" || right === "unknown") {
      return true;
    }

    return left === right;
  }

  private isKeyLikeColumn(column: {
    name: string;
    is_pk?: boolean;
    is_fk?: boolean;
  }): boolean {
    if (column.is_pk || column.is_fk) return true;
    const lower = column.name.toLowerCase();
    return lower === "id" || lower.endsWith("_id");
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
    } catch {
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
    } catch {
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
    } catch {
      return null;
    }
  }

  /**
   * Get suggested JOIN conditions between tables in scope and a target table.
   * Uses FK relationships and column name matching as fallback.
   */
  async getJoinConditions(
    tablesInScope: Array<{ name: string; alias?: string; schema?: string }>,
    targetTable: { name: string; alias?: string; schema?: string },
    schema?: string
  ): Promise<JoinConditionSuggestion[]> {
    const targetSchema = schema || this.defaultSchema;
    const suggestions: JoinConditionSuggestion[] = [];
    const seenConditions = new Set<string>();

    try {
      // Get relationship graph from cache
      const graph = await schemaCache.getRelationshipGraph(
        this.connectionId,
        targetSchema
      );

      const targetTableName = targetTable.name;
      // Check each table in scope for FK relationships with the target
      for (const scopeTable of tablesInScope) {
        const scopeTableName = scopeTable.name;

        // Check forward relationships: scopeTable -> targetTable
        const outgoing = graph.relationships.get(scopeTableName) || [];
        for (const rel of outgoing) {
          if (rel.targetTable.toLowerCase() === targetTableName.toLowerCase()) {
            const condition = this.buildJoinCondition(
              scopeTable,
              rel.sourceColumn,
              targetTable,
              rel.targetColumn,
              rel
            );
            if (!seenConditions.has(condition.toLowerCase())) {
              seenConditions.add(condition.toLowerCase());
              suggestions.push({
                condition,
                description: `FK: ${scopeTableName}.${rel.sourceColumn} → ${targetTableName}.${rel.targetColumn}`,
                source: "fk",
                score: 100,
              });
            }
          }
        }

        // Check reverse relationships: targetTable -> scopeTable
        const incoming = graph.reverseRelationships.get(scopeTableName) || [];
        for (const rel of incoming) {
          if (rel.sourceTable.toLowerCase() === targetTableName.toLowerCase()) {
            const condition = this.buildJoinCondition(
              targetTable,
              rel.sourceColumn,
              scopeTable,
              rel.targetColumn,
              rel
            );
            if (!seenConditions.has(condition.toLowerCase())) {
              seenConditions.add(condition.toLowerCase());
              suggestions.push({
                condition,
                description: `FK: ${targetTableName}.${rel.sourceColumn} → ${scopeTableName}.${rel.targetColumn}`,
                source: "fk",
                score: 95,
              });
            }
          }
        }

        // Also check if target has FK to scope table
        const targetOutgoing = graph.relationships.get(targetTableName) || [];
        for (const rel of targetOutgoing) {
          if (rel.targetTable.toLowerCase() === scopeTableName.toLowerCase()) {
            const condition = this.buildJoinCondition(
              targetTable,
              rel.sourceColumn,
              scopeTable,
              rel.targetColumn,
              rel
            );
            if (!seenConditions.has(condition.toLowerCase())) {
              seenConditions.add(condition.toLowerCase());
              suggestions.push({
                condition,
                description: `FK: ${targetTableName}.${rel.sourceColumn} → ${scopeTableName}.${rel.targetColumn}`,
                source: "fk",
                score: 90,
              });
            }
          }
        }
      }

      // If no FK relationships found, try column name matching as fallback
      if (suggestions.length === 0) {
        await this.addColumnMatchSuggestions(
          tablesInScope,
          targetTable,
          targetSchema,
          suggestions,
          seenConditions
        );
      }

      // Sort by score (highest first)
      return suggestions.sort((a, b) => b.score - a.score);
    } catch {
      // On error, try column matching as fallback
      try {
        await this.addColumnMatchSuggestions(
          tablesInScope,
          targetTable,
          targetSchema,
          suggestions,
          seenConditions
        );
        return suggestions.sort((a, b) => b.score - a.score);
      } catch {
        return [];
      }
    }
  }

  /**
   * Add join suggestions based on matching column names (fallback when no FK)
   */
  private async addColumnMatchSuggestions(
    tablesInScope: Array<{ name: string; alias?: string; schema?: string }>,
    targetTable: { name: string; alias?: string; schema?: string },
    targetSchema: string,
    suggestions: JoinConditionSuggestion[],
    seenConditions: Set<string>
  ): Promise<void> {
    // Get target table columns
    const targetColumns = await schemaCache.getTableColumns(
      this.connectionId,
      targetTable.schema || targetSchema,
      targetTable.name
    );

    // Build a map of column names for quick lookup
    const targetColumnsByName = new Map(
      targetColumns.map((c) => [c.name.toLowerCase(), c])
    );
    const targetColumnNames = new Set(targetColumns.map(c => c.name.toLowerCase()));
    const targetPkColumns = targetColumns.filter(c => c.is_pk).map(c => c.name);

    for (const scopeTable of tablesInScope) {
      if (this.isSameTable(scopeTable, targetTable, targetSchema)) {
        continue;
      }

      // Get scope table columns
      const scopeColumns = await schemaCache.getTableColumns(
        this.connectionId,
        scopeTable.schema || targetSchema,
        scopeTable.name
      );
      const scopeColumnsByName = new Map(
        scopeColumns.map((c) => [c.name.toLowerCase(), c])
      );

      const scopePkColumns = scopeColumns.filter(c => c.is_pk).map(c => c.name);

      // Strategy 1: Look for common "id" patterns
      // e.g., scopeTable.target_id = targetTable.id
      const targetIdColumn = targetPkColumns[0] || "id";
      const expectedFkName = `${targetTable.name.toLowerCase()}_${targetIdColumn.toLowerCase()}`;
      
      for (const col of scopeColumns) {
        const targetIdMeta = targetColumnsByName.get(targetIdColumn.toLowerCase());
        if (
          col.name.toLowerCase() === expectedFkName &&
          targetColumnNames.has(targetIdColumn.toLowerCase()) &&
          targetIdMeta &&
          this.areJoinTypesCompatible(col.db_type, targetIdMeta.db_type)
        ) {
          const condition = `${this.formatColumnRef(scopeTable, col.name)} = ${this.formatColumnRef(targetTable, targetIdColumn)}`;
          if (!seenConditions.has(condition.toLowerCase())) {
            seenConditions.add(condition.toLowerCase());
            suggestions.push({
              condition,
              description: `Column match: ${scopeTable.name}.${col.name} ≈ ${targetTable.name}.${targetIdColumn}`,
              source: "column_match",
              score: 50,
            });
          }
        }
      }

      // Strategy 2: Check reverse - target has fk pattern to scope
      const scopeIdColumn = scopePkColumns[0] || "id";
      const expectedReverseFkName = `${scopeTable.name.toLowerCase()}_${scopeIdColumn.toLowerCase()}`;
      const scopeIdMeta = scopeColumnsByName.get(scopeIdColumn.toLowerCase());
      
      for (const col of targetColumns) {
        if (
          col.name.toLowerCase() === expectedReverseFkName &&
          scopeIdMeta &&
          this.areJoinTypesCompatible(col.db_type, scopeIdMeta.db_type)
        ) {
          const condition = `${this.formatColumnRef(targetTable, col.name)} = ${this.formatColumnRef(scopeTable, scopeIdColumn)}`;
          if (!seenConditions.has(condition.toLowerCase())) {
            seenConditions.add(condition.toLowerCase());
            suggestions.push({
              condition,
              description: `Column match: ${targetTable.name}.${col.name} ≈ ${scopeTable.name}.${scopeIdColumn}`,
              source: "column_match",
              score: 45,
            });
          }
        }
      }

      // Strategy 3: Match same column names (both tables have same column)
      for (const scopeCol of scopeColumns) {
        const targetCol = targetColumnsByName.get(scopeCol.name.toLowerCase());
        if (targetCol) {
          // Prefer PK/FK columns, skip very common names like "id", "created_at"
          const commonNonJoinColumns = new Set(["id", "created_at", "updated_at", "deleted_at", "name", "description", "status"]);
          if (commonNonJoinColumns.has(scopeCol.name.toLowerCase())) continue;
          if (!this.isKeyLikeColumn(scopeCol) && !this.isKeyLikeColumn(targetCol)) continue;
          if (!this.areJoinTypesCompatible(scopeCol.db_type, targetCol.db_type)) continue;

          const condition = `${this.formatColumnRef(scopeTable, scopeCol.name)} = ${this.formatColumnRef(targetTable, scopeCol.name)}`;
          if (!seenConditions.has(condition.toLowerCase())) {
            seenConditions.add(condition.toLowerCase());
            suggestions.push({
              condition,
              description: `Same column: ${scopeCol.name}`,
              source: "column_match",
              score: 30,
            });
          }
        }
      }
    }
  }

  /**
   * List database functions in the given schema.
   * Returns user-defined and built-in functions from the database.
   */
  async listFunctions(schema?: string): Promise<FunctionMeta[]> {
    const targetSchema = schema || this.defaultSchema;

    try {
      const functions = await schemaCache.getFunctions(this.connectionId, targetSchema);

      return functions.map((f) => ({
        name: f.name,
        returnType: f.return_type,
        arguments: f.arguments.join(", "),
        description: undefined,
      }));
    } catch {
      return [];
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

// Provider instance cache keyed by "connectionId:schema"
const providerCache = new Map<string, MetadataProvider>();

/**
 * Factory function to create or retrieve a cached SqlMetadataProvider.
 * Memoizes instances by connectionId + schema to avoid recreation on every extension rebuild.
 */
export function createSqlMetadataProvider(
  connectionId: string,
  defaultSchema?: string,
  dialect: SqlDialect = "postgresql"
): MetadataProvider {
  const schema = defaultSchema || "public";
  const cacheKey = `${connectionId}:${schema}:${dialect}`;
  
  let provider = providerCache.get(cacheKey);
  if (!provider) {
    provider = new SqlMetadataProvider(connectionId, schema, dialect);
    providerCache.set(cacheKey, provider);
  }
  
  return provider;
}

/**
 * Clear the provider cache. Call when connections are closed or schema is refreshed.
 */
export function clearProviderCache(connectionId?: string): void {
  if (connectionId === undefined) {
    providerCache.clear();
    return;
  }

  const normalizedConnectionId = connectionId.trim();
  if (!normalizedConnectionId) {
    return;
  }

  if (normalizedConnectionId) {
    // Clear entries for specific connection
    for (const key of providerCache.keys()) {
      if (key.startsWith(`${normalizedConnectionId}:`)) {
        providerCache.delete(key);
      }
    }
  }
}
