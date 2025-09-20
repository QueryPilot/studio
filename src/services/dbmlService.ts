import { Parser } from "@dbml/core";
import type { TableStructure, ForeignKeyInfo } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";

export interface DBMLConversionOptions {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  includeTriggers?: boolean;
  includeComments?: boolean;
  includeEnums?: boolean;
  filterTables?: string[];
  excludeSystemTables?: boolean;
  databaseType?: string;
}

export interface DBMLRelationship {
  id: string;
  name: string;
  fromTable: string;
  fromSchema?: string;
  toTable: string;
  toSchema?: string;
  fromColumns: string[];
  toColumns: string[];
  onUpdate?: string;
  onDelete?: string;
  sourceCardinality?: "1" | "n";
  targetCardinality?: "1" | "n";
}

export interface DBMLSchema {
  dbml: string;
  ast: unknown;
  metadata: {
    tableCount: number;
    relationshipCount: number;
    enumCount: number;
    version: string;
    generatedAt: Date;
  };
  relationships: DBMLRelationship[];
  tables: TableStructure[];
}

const DEFAULT_OPTIONS: Required<
  Pick<
    DBMLConversionOptions,
    | "includeIndexes"
    | "includeConstraints"
    | "includeTriggers"
    | "includeComments"
    | "includeEnums"
    | "excludeSystemTables"
  >
> = {
  includeIndexes: true,
  includeConstraints: false,
  includeTriggers: false,
  includeComments: true,
  includeEnums: true,
  excludeSystemTables: true,
};

function shouldIncludeTable(
  table: TableStructure,
  options: DBMLConversionOptions,
): boolean {
  if (options.filterTables && options.filterTables.length > 0) {
    return options.filterTables.includes(table.name);
  }

  if (!options.excludeSystemTables) return true;

  const systemSchemas = ["information_schema", "pg_catalog"]; // extend as needed per engine
  return !systemSchemas.includes(table.schema.toLowerCase());
}

function formatColumnAttributes(column: ColumnMeta): string {
  const attributes: string[] = [];

  if (!column.nullable) attributes.push("not null");
  if (column.is_pk) attributes.push("pk");
  if (column.default !== null) {
    const def = column.default.replace(/'/g, "\\'");
    attributes.push(`default: '${def}'`);
  }

  return attributes.length > 0 ? ` [${attributes.join(", ")}]` : "";
}

function formatColumn(column: ColumnMeta): string {
  const comment = column.comment?.trim();
  const commentSuffix = comment ? ` // ${comment.replace(/\n/g, " ")}` : "";
  return `  ${column.name} ${column.db_type}${formatColumnAttributes(
    column,
  )}${commentSuffix}`;
}

function formatIndexes(
  table: TableStructure,
  includeIndexes: boolean,
): string[] {
  if (!includeIndexes || table.indexes.length === 0) return [];

  // Filter out primary key indexes if we already have primaryKeys defined
  // to avoid duplicate primary key definitions
  return table.indexes
    .filter((idx) => {
      // Skip if this is a primary key index and we already have primary keys defined
      if (idx.is_primary && table.primaryKeys.length > 0) {
        // Check if this index matches the primary key columns
        const pkSet = new Set(table.primaryKeys);
        const idxSet = new Set(idx.columns);
        if (
          pkSet.size === idxSet.size &&
          [...pkSet].every((col) => idxSet.has(col))
        ) {
          return false; // Skip this index as it's redundant with the pk definition
        }
      }
      return true;
    })
    .map((idx) => {
      const columns = idx.columns.join(", ");
      const settings: string[] = [];

      // Add index name if available
      if (idx.name) {
        settings.push(`name: '${idx.name}'`);
      }

      // Add flags
      if (idx.is_primary && table.primaryKeys.length === 0) {
        settings.push("pk");
      }
      if (idx.is_unique) {
        settings.push("unique");
      }

      // Format based on single or multi-column
      const columnPart = idx.columns.length === 1 ? columns : `(${columns})`;
      const settingsSection = settings.length > 0 ? ` [${settings.join(", ")}]` : "";

      return `    ${columnPart}${settingsSection}`;
    });
}

function formatTable(
  table: TableStructure,
  options: DBMLConversionOptions,
): string {
  const lines: string[] = [];
  lines.push(`Table ${table.schema}.${table.name} {`);

  table.columns.forEach((column) => {
    lines.push(formatColumn(column));
  });

  const includeIndexes =
    options.includeIndexes !== undefined
      ? options.includeIndexes
      : DEFAULT_OPTIONS.includeIndexes;

  const indexLines = formatIndexes(table, includeIndexes);
  if (table.primaryKeys.length > 0 || indexLines.length > 0) {
    lines.push("", "  indexes {");
    if (table.primaryKeys.length > 0) {
      const pkCols = table.primaryKeys.join(", ");
      lines.push(`    (${pkCols}) [pk]`);
    }
    indexLines.forEach((idxLine) => lines.push(idxLine));
    lines.push("  }");
  }

  lines.push("}");

  return lines.join("\n");
}

function formatRelationship(
  fk: ForeignKeyInfo,
  sourceTable: TableStructure,
): DBMLRelationship {
  return {
    id: `${sourceTable.schema}.${sourceTable.name}-${fk.name}`,
    name: fk.name,
    fromTable: sourceTable.name,
    fromSchema: sourceTable.schema,
    toTable: fk.foreignTable,
    toSchema: fk.foreignSchema,
    fromColumns: fk.columns,
    toColumns: fk.foreignColumns,
    onUpdate: fk.onUpdate,
    onDelete: fk.onDelete,
    // Determine cardinality based on the relationship type
    // Foreign key typically represents many-to-one (n:1)
    sourceCardinality: "n",
    targetCardinality: "1",
  };
}

class DBMLService {
  async schemaToDBML(
    tables: TableStructure[],
    options: DBMLConversionOptions = {},
  ): Promise<DBMLSchema> {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    const filteredTables = tables.filter((table) =>
      shouldIncludeTable(table, mergedOptions),
    );

    const tableBlocks = filteredTables.map((table) =>
      formatTable(table, mergedOptions),
    );
    const relationships = this.extractRelationships(filteredTables);
    const relationshipBlocks = relationships.map((rel) => {
      const from = rel.fromSchema
        ? `${rel.fromSchema}.${rel.fromTable}`
        : rel.fromTable;
      const to = rel.toSchema ? `${rel.toSchema}.${rel.toTable}` : rel.toTable;
      const fromCols = rel.fromColumns.join(", ");
      const toCols = rel.toColumns.join(", ");
      const actions: string[] = [];

      // Map database action names to DBML format
      const mapAction = (action: string | undefined): string | undefined => {
        if (!action) return undefined;
        const upperAction = action.toUpperCase().trim();

        // Handle database-specific formats
        switch (upperAction) {
          case "CASCADE":
            return "cascade";
          case "SET NULL":
          case "SETNULL":
            return "set null";
          case "RESTRICT":
            return "restrict";
          case "NO ACTION":
          case "NOACTION":
            return "no action";
          case "SET DEFAULT":
          case "SETDEFAULT":
            return "set default";
          default:
            // Handle edge cases where database might return partial values
            if (upperAction === "SET") {
              // If we just have "SET", assume it's "SET NULL" as it's most common
              console.warn(`Ambiguous foreign key action "SET" - assuming "SET NULL"`);
              return "set null";
            }
            // Log unrecognized action for debugging
            console.warn(`Unrecognized foreign key action: "${action}" - using lowercase`);
            return action.toLowerCase();
        }
      };

      const deleteAction = mapAction(rel.onDelete);
      const updateAction = mapAction(rel.onUpdate);

      if (deleteAction) actions.push(`delete: ${deleteAction}`);
      if (updateAction) actions.push(`update: ${updateAction}`);
      const actionSection =
        actions.length > 0 ? ` [${actions.join(", ")}]` : "";
      return `Ref ${rel.name} {
  ${from}.${fromCols} > ${to}.${toCols}${actionSection}
}`;
    });

    const dbmlParts: string[] = [];

    const databaseType = mergedOptions.databaseType
      ? mergedOptions.databaseType.toLowerCase()
      : "postgresql";

    dbmlParts.push(
      `Project devdb {`,
      `  database_type: "${databaseType}"`,
      `}`,
    );
    dbmlParts.push("", ...tableBlocks);
    if (relationshipBlocks.length > 0) {
      dbmlParts.push("", ...relationshipBlocks);
    }

    const dbml = dbmlParts.join("\n\n");
    const ast = await Promise.resolve(this.parseDBML(dbml));

    return {
      dbml,
      ast,
      metadata: {
        tableCount: filteredTables.length,
        relationshipCount: relationships.length,
        enumCount: 0,
        version: "1.0",
        generatedAt: new Date(),
      },
      relationships,
      tables: filteredTables,
    };
  }

  parseDBML(dbml: string): unknown {
    try {
      return Parser.parse(dbml, "dbml");
    } catch (error) {
      console.error("Failed to parse DBML", error);
      return null;
    }
  }

  validateDBML(dbml: string): { valid: boolean; errors?: string[] } {
    try {
      Parser.parse(dbml, "dbml");
      return { valid: true };
    } catch (error) {
      if (error instanceof Error) {
        return { valid: false, errors: [error.message] };
      }
      return { valid: false, errors: ["Unknown DBML parsing error"] };
    }
  }

  extractRelationships(tables: TableStructure[]): DBMLRelationship[] {
    const relationships: DBMLRelationship[] = [];

    tables.forEach((table) => {
      table.foreignKeys.forEach((fk) => {
        relationships.push(formatRelationship(fk, table));
      });
    });

    return relationships;
  }
}

export const dbmlService = new DBMLService();
