import { Parser } from "@dbml/core";
import type { TableStructure, ForeignKeyInfo } from "@/types/tableStructure";
import type { ColumnMeta } from "@/types/database";
import type { DBMLRelationship } from "@/services/dbmlService";
import { ConstraintType } from "@/types/tableStructure";

const DEFAULT_SCHEMA = "public";

const relationToCardinality = (relation?: string | null): "1" | "n" => {
  if (!relation) return "1";
  const normalized = relation.toLowerCase();
  if (
    normalized.includes("*") ||
    normalized.includes("n") ||
    normalized.includes("many")
  ) {
    return "n";
  }
  return "1";
};

type ParserField = {
  name: string;
  type?: { type_name?: string; name?: string };
  not_null?: boolean;
  pk?: boolean;
  dbdefault?: { value?: unknown };
  note?: string | { text?: string };
};

type ParserTable = {
  name: string;
  fields: ParserField[];
  note?: string | { text?: string };
};

type ParserEndpoint = {
  relation?: string;
  schemaName?: string | null;
  tableName: string;
  fieldNames: string[];
};

type ParserRef = {
  name?: string | null;
  onDelete?: string;
  onUpdate?: string;
  endpoints?: ParserEndpoint[];
};

type ParserSchema = {
  name?: string;
  tables: ParserTable[];
  refs?: ParserRef[];
};

interface WorkerInput {
  dbml: string;
  targetDatabase: string;
}

interface WorkerOutput {
  success: boolean;
  result?: {
    tables: TableStructure[];
    relationships: DBMLRelationship[];
  };
  error?: string;
}

function convertProjectToStructures(
  dbml: string,
  targetDatabase: string,
): { tables: TableStructure[]; relationships: DBMLRelationship[] } {
  const project = Parser.parse(dbml, "dbml");
  const schemas = project.schemas as unknown as ParserSchema[];
  const derivedTables: TableStructure[] = [];
  const relationships: DBMLRelationship[] = [];
  const foreignKeyMap = new Map<string, ForeignKeyInfo[]>();
  const databaseName =
    typeof project.name === "string" && project.name.length > 0
      ? project.name
      : targetDatabase;

  const getTableKey = (
    schemaName: string | null | undefined,
    tableName: string,
  ) => `${(schemaName ?? DEFAULT_SCHEMA).toLowerCase()}::${tableName}`;

  schemas.forEach((schemaEntry) => {
    const schemaName = schemaEntry.name ?? DEFAULT_SCHEMA;

    schemaEntry.tables.forEach((table) => {
      let columns: ColumnMeta[] = table.fields.map((field, index) => {
        let defaultValue: string | null = null;
        if (field.dbdefault && field.dbdefault.value != null) {
          const rawDefault = field.dbdefault.value;
          if (typeof rawDefault === "string") {
            defaultValue = rawDefault;
          } else if (
            typeof rawDefault === "number" ||
            typeof rawDefault === "boolean"
          ) {
            defaultValue = String(rawDefault);
          } else {
            defaultValue = JSON.stringify(rawDefault);
          }
        }

        return {
          name: field.name,
          db_type: field.type?.type_name ?? field.type?.name ?? "text",
          nullable: field.not_null !== true,
          default: defaultValue,
          is_pk: field.pk === true,
          is_fk: false,
          ordinal: index,
          precision: null,
          scale: null,
          comment:
            typeof field.note === "string"
              ? field.note
              : field.note?.text ?? null,
        } satisfies ColumnMeta;
      });

      // Pre-sort columns in worker for better render performance
      // This prevents expensive sorting on every render in the UI
      columns.sort((a, b) => {
        // Primary keys always come first
        if (a.is_pk && !b.is_pk) return -1;
        if (!a.is_pk && b.is_pk) return 1;

        // Among primary keys, 'id' comes first
        if (a.is_pk && b.is_pk) {
          if (a.name.toLowerCase() === "id") return -1;
          if (b.name.toLowerCase() === "id") return 1;
          return 0;
        }

        // Then FKs (including _id columns that aren't PKs)
        const aIsFk =
          a.is_fk || (!a.is_pk && a.name.toLowerCase().includes("_id"));
        const bIsFk =
          b.is_fk || (!b.is_pk && b.name.toLowerCase().includes("_id"));
        if (aIsFk && !bIsFk) return -1;
        if (!aIsFk && bIsFk) return 1;

        // Keep original order for remaining columns
        return 0;
      });

      // Extract primary keys from indexes if present
      let primaryKeys: string[] = [];

      // First check if columns are directly marked as PKs
      const directPks = columns
        .filter((column) => column.is_pk)
        .map((column) => column.name);

      if (directPks.length > 0) {
        primaryKeys = directPks;
      } else {
        // Check for indexes in the table object (DBML parser structure)
        const tableObj = table as any;

        // Try different possible locations for indexes in DBML AST
        if (tableObj.indexes && Array.isArray(tableObj.indexes)) {
          for (const idx of tableObj.indexes) {
            const hasPkSetting =
              idx.settings &&
              (idx.settings.pk === true ||
                idx.settings.primary === true ||
                idx.settings.primaryKey === true);

            const isPrimaryKey =
              idx.pk === true ||
              idx.primary === true ||
              idx.type === "pk" ||
              hasPkSetting ||
              (idx.unique === true && idx.name?.includes("pkey"));

            if (isPrimaryKey) {
              if (idx.columns && Array.isArray(idx.columns)) {
                primaryKeys = idx.columns.map((col: any) => {
                  if (typeof col === "object" && col.value) {
                    return col.value;
                  }
                  if (typeof col === "string") {
                    return col;
                  }
                  if (typeof col === "object" && col.name) {
                    return col.name;
                  }
                  if (typeof col === "object" && col.column) {
                    return col.column.name || col.column;
                  }
                  return col;
                });
                break;
              }
            }
          }
        }

        // Also check if there's an indexes array at the schema level
        const schemaIndexes = (schemaEntry as any).indexes;
        if (schemaIndexes && Array.isArray(schemaIndexes)) {
          const tablePkIndex = schemaIndexes.find(
            (idx: any) =>
              idx.tableName === table.name &&
              (idx.pk === true || idx.primary === true),
          );
          if (tablePkIndex && tablePkIndex.columns) {
            primaryKeys = tablePkIndex.columns.map((c: any) =>
              typeof c === "string" ? c : c.name,
            );
          }
        }
      }

      // Mark columns as PKs if they're in the primaryKeys list
      if (primaryKeys.length > 0) {
        columns = columns.map((col) => ({
          ...col,
          is_pk: primaryKeys.includes(col.name),
        }));
      }

      const tableStructure: TableStructure = {
        name: table.name,
        schema: schemaName,
        database: databaseName,
        owner: undefined,
        comment: typeof table.note === "string" ? table.note : table.note?.text,
        rowCount: undefined,
        size: undefined,
        columns,
        primaryKeys,
        foreignKeys: [],
        indexes: [],
        constraints: [],
        triggers: [],
        stats: undefined,
      };

      derivedTables.push(tableStructure);
      foreignKeyMap.set(getTableKey(schemaName, table.name), []);
    });

    (schemaEntry.refs ?? []).forEach((ref, index) => {
      if (!ref.endpoints || ref.endpoints.length < 2) return;

      const [endpointA, endpointB] = ref.endpoints;
      if (!endpointA || !endpointB) return;

      let source = endpointA;
      let target = endpointB;

      const relationWeight = (endpoint: ParserEndpoint): number => {
        const relation = (endpoint.relation ?? "").toLowerCase();
        if (relation.includes("*")) return 2;
        if (relation.includes("n")) return 2;
        if (relation.includes("many")) return 2;
        if (relation.includes("1")) return 1;
        return 1;
      };

      if (relationWeight(endpointB) > relationWeight(endpointA)) {
        source = endpointB;
        target = endpointA;
      }

      const sourceSchema = source.schemaName ?? schemaName;
      const targetSchema = target.schemaName ?? schemaName;

      const sourceCardinality = relationToCardinality(source.relation);
      const targetCardinality = relationToCardinality(target.relation);

      const fkName =
        typeof ref.name === "string" && ref.name.length > 0
          ? ref.name
          : `ref_${source.tableName}_${target.tableName}_${index + 1}`;

      const fk: ForeignKeyInfo = {
        name: fkName,
        columns: source.fieldNames,
        foreignTable: target.tableName,
        foreignSchema: targetSchema,
        foreignColumns: target.fieldNames,
        onDelete: ref.onDelete,
        onUpdate: ref.onUpdate,
      };

      const key = getTableKey(sourceSchema, source.tableName);
      const existing = foreignKeyMap.get(key) ?? [];
      foreignKeyMap.set(key, [...existing, fk]);

      relationships.push({
        id: `${sourceSchema}.${source.tableName}-${fkName}`,
        name: fkName,
        fromTable: source.tableName,
        fromSchema: sourceSchema,
        toTable: target.tableName,
        toSchema: targetSchema,
        fromColumns: source.fieldNames,
        toColumns: target.fieldNames,
        onDelete: ref.onDelete,
        onUpdate: ref.onUpdate,
        sourceCardinality,
        targetCardinality,
      });
    });
  });

  derivedTables.forEach((table) => {
    const key = `${table.schema.toLowerCase()}::${table.name}`;
    const foreignKeys = foreignKeyMap.get(key) ?? [];
    table.foreignKeys = foreignKeys;

    const fkColumnNames = new Set(
      foreignKeys.flatMap((fk) =>
        fk.columns.map((column) => column.toLowerCase()),
      ),
    );
    table.columns = table.columns.map((column, idx) => ({
      ...column,
      ordinal: idx,
      is_fk: fkColumnNames.has(column.name.toLowerCase()),
    }));

    // Backfill constraint info for primary keys
    if (table.primaryKeys.length > 0) {
      table.constraints.push({
        name: `${table.name}_pkey`,
        table_name: table.name,
        constraint_type: ConstraintType.PrimaryKey,
        definition: `PRIMARY KEY (${table.primaryKeys.join(", ")})`,
        foreign_table: undefined,
      });
    }
  });

  return { tables: derivedTables, relationships };
}

// Web Worker message handler
self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    const { dbml, targetDatabase } = e.data;
    const result = convertProjectToStructures(dbml, targetDatabase);

    const output: WorkerOutput = {
      success: true,
      result,
    };

    self.postMessage(output);
  } catch (error) {
    const output: WorkerOutput = {
      success: false,
      error: error instanceof Error ? error.message : "Parse failed",
    };

    self.postMessage(output);
  }
};
