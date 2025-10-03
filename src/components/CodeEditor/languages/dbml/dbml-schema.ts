import { type Text } from "@codemirror/state";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  pk?: boolean;
  unique?: boolean;
  increment?: boolean;
  default?: string;
  note?: string;
  ref?: string;
  position: { from: number; to: number };
}

export interface TableInfo {
  name: string;
  schema?: string;
  alias?: string;
  columns: Map<string, ColumnInfo>;
  indexes: IndexInfo[];
  note?: string;
  headerColor?: string;
  position: { from: number; to: number };
}

export interface IndexInfo {
  columns: string[];
  unique: boolean;
  pk?: boolean;
  type?: string;
  note?: string;
  position: { from: number; to: number };
}

export interface EnumInfo {
  name: string;
  values: EnumValueInfo[];
  note?: string;
  position: { from: number; to: number };
}

export interface EnumValueInfo {
  name: string;
  note?: string;
}

export interface RelationshipInfo {
  name?: string;
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  type: ">" | "<" | "-" | "<>";
  onDelete?: string;
  onUpdate?: string;
  position: { from: number; to: number };
}

export interface TableGroupInfo {
  name: string;
  tables: string[];
  position: { from: number; to: number };
}

export class DBMLSchema {
  tables: Map<string, TableInfo> = new Map();
  tablePartials: Map<string, TableInfo> = new Map();
  enums: Map<string, EnumInfo> = new Map();
  relationships: RelationshipInfo[] = [];
  tableGroups: Map<string, TableGroupInfo> = new Map();
  project?: {
    name?: string;
    databaseType?: string;
    note?: string;
  };

  constructor() {}

  // Helper to extract position from AST node
  private static extractPosition(node: any, doc?: Text): { from: number; to: number } {
    if (!node) {
      return { from: 0, to: 0 };
    }

    // @dbml/core provides token with start/end offsets
    // The token property is the primary source of position info
    const token = node.token;
    if (token?.start?.offset !== undefined && token?.end?.offset !== undefined) {
      return {
        from: token.start.offset,
        to: token.end.offset
      };
    }

    // Fallback: convert line/column to offset if doc is provided
    if (token?.start && token?.end && doc) {
      const from = this.getOffsetFromLineColumn(doc, token.start.line, token.start.column);
      const to = this.getOffsetFromLineColumn(doc, token.end.line, token.end.column);
      return { from, to };
    }

    // Last resort: check for other location properties
    const location = node.location || node.loc || node._location;
    if (location?.start?.offset !== undefined && location?.end?.offset !== undefined) {
      return {
        from: location.start.offset,
        to: location.end.offset
      };
    }

    // If we have line/column but no offset
    if (location?.start && location?.end && doc) {
      const from = this.getOffsetFromLineColumn(doc, location.start.line, location.start.column);
      const to = this.getOffsetFromLineColumn(doc, location.end.line, location.end.column);
      return { from, to };
    }

    return { from: 0, to: 0 };
  }

  // Helper to convert line/column to offset
  private static getOffsetFromLineColumn(doc: Text, line?: number, column?: number): number {
    if (!doc || line === undefined || column === undefined) return 0;

    try {
      // DBML parser uses 1-based line numbers and columns
      const lineNumber = Math.max(1, line);
      const columnNumber = Math.max(1, column);

      if (lineNumber > doc.lines) return 0;

      const docLine = doc.line(lineNumber);
      // Column is 1-based, so subtract 1
      return docLine.from + Math.min(columnNumber - 1, docLine.length);
    } catch {
      return 0;
    }
  }

  static fromAST(ast: any, doc?: Text): DBMLSchema {
    const schema = new DBMLSchema();

    if (!ast || !ast.schemas) return schema;

    for (const schemaObj of ast.schemas) {
      // Process tables
      if (schemaObj.tables) {
        for (const table of schemaObj.tables) {
          const tableInfo: TableInfo = {
            name: table.name,
            schema: schemaObj.name || "public",
            alias: table.alias,
            columns: new Map(),
            indexes: [],
            note: table.note,
            headerColor: table.headerColor,
            position: this.extractPosition(table, doc)
          };

          // Process fields/columns
          if (table.fields) {
            for (const field of table.fields) {
              const columnInfo: ColumnInfo = {
                name: field.name,
                type: field.type?.type_name || "unknown",
                nullable: !field.not_null,
                pk: field.pk,
                unique: field.unique,
                increment: field.increment,
                default: field.dbdefault,
                note: field.note,
                position: this.extractPosition(field, doc)
              };

              // Handle inline references
              if (field.inline_refs && field.inline_refs.length > 0) {
                const ref = field.inline_refs[0];
                columnInfo.ref = `${ref.tableName}.${ref.fieldNames?.[0] || 'id'}`;
              }

              tableInfo.columns.set(field.name, columnInfo);
            }
          }

          // Process indexes
          if (table.indexes) {
            for (const index of table.indexes) {
              tableInfo.indexes.push({
                columns: index.columns?.map((c: any) => c.value) || [],
                unique: index.unique || false,
                pk: index.pk || false,
                type: index.type,
                note: index.note,
                position: this.extractPosition(index, doc)
              });
            }
          }

          schema.addTable(tableInfo);
        }
      }

      // Process enums
      if (schemaObj.enums) {
        for (const enumObj of schemaObj.enums) {
          const enumInfo: EnumInfo = {
            name: enumObj.name,
            values: enumObj.values?.map((v: any) => ({
              name: v.name,
              note: v.note
            })) || [],
            note: enumObj.note,
            position: this.extractPosition(enumObj, doc)
          };
          schema.addEnum(enumInfo);
        }
      }

      // Process relationships
      if (schemaObj.refs) {
        for (const ref of schemaObj.refs) {
          if (ref.endpoints && ref.endpoints.length === 2) {
            const endpoint0 = ref.endpoints[0];
            const endpoint1 = ref.endpoints[1];

            const relInfo: RelationshipInfo = {
              name: ref.name,
              fromTable: endpoint0.tableName,
              fromColumns: endpoint0.fieldNames || [],
              toTable: endpoint1.tableName,
              toColumns: endpoint1.fieldNames || [],
              type: endpoint0.relation || ">",
              onDelete: ref.onDelete,
              onUpdate: ref.onUpdate,
              position: this.extractPosition(ref, doc)
            };
            schema.addRelationship(relInfo);
          }
        }
      }

      // Process table groups
      if (schemaObj.tableGroups) {
        for (const group of schemaObj.tableGroups) {
          schema.addTableGroup({
            name: group.name,
            tables: group.tables || [],
            position: this.extractPosition(group, doc)
          });
        }
      }
    }

    // Process project info
    if (ast.project) {
      schema.project = {
        name: ast.project.name,
        databaseType: ast.project.database_type,
        note: ast.project.note
      };
    }

    return schema;
  }

  addTable(table: TableInfo) {
    const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;
    this.tables.set(fullName, table);
    this.tables.set(table.name, table); // Also store without schema

    if (table.alias) {
      this.tables.set(table.alias, table);
    }
  }

  addTablePartial(partial: TableInfo) {
    const existing = this.tablePartials.get(partial.name) || this.tables.get(partial.name);

    if (existing) {
      // Merge columns from partial into existing
      for (const [name, col] of partial.columns) {
        existing.columns.set(name, col);
      }

      // Merge indexes
      if (partial.indexes) {
        existing.indexes.push(...partial.indexes);
      }
    } else {
      this.tablePartials.set(partial.name, partial);
    }
  }

  addEnum(enumInfo: EnumInfo) {
    this.enums.set(enumInfo.name, enumInfo);
  }

  addRelationship(rel: RelationshipInfo) {
    this.relationships.push(rel);
  }

  addTableGroup(group: TableGroupInfo) {
    this.tableGroups.set(group.name, group);
  }

  hasTable(name: string): boolean {
    return this.tables.has(name) ||
           this.tables.has(`public.${name}`) ||
           this.tablePartials.has(name);
  }

  getTable(name: string): TableInfo | undefined {
    return this.tables.get(name) ||
           this.tables.get(`public.${name}`) ||
           this.tablePartials.get(name);
  }

  hasColumn(tableName: string, columnName: string): boolean {
    const table = this.getTable(tableName);
    return table ? table.columns.has(columnName) : false;
  }

  getColumn(tableName: string, columnName: string): ColumnInfo | undefined {
    const table = this.getTable(tableName);
    return table?.columns.get(columnName);
  }

  hasEnum(name: string): boolean {
    return this.enums.has(name);
  }

  getEnum(name: string): EnumInfo | undefined {
    return this.enums.get(name);
  }

  findRelationships(tableName: string): RelationshipInfo[] {
    return this.relationships.filter(rel =>
      rel.fromTable === tableName || rel.toTable === tableName
    );
  }

  // Check for circular references
  detectCircularReferences(): { cycle: string[]; position: any } | null {
    const graph = new Map<string, Set<string>>();
    const relMap = new Map<string, RelationshipInfo>();

    // Build dependency graph and track relationship positions
    for (const rel of this.relationships) {
      // Skip self-referential relationships (they're not circular references)
      if (rel.fromTable === rel.toTable) {
        continue;
      }

      if (!graph.has(rel.fromTable)) {
        graph.set(rel.fromTable, new Set());
      }
      graph.get(rel.fromTable)!.add(rel.toTable);

      // Store the relationship for position lookup
      const key = `${rel.fromTable}->${rel.toTable}`;
      relMap.set(key, rel);
    }

    // DFS to find cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const table of graph.keys()) {
      const cycle = this.findCycle(table, graph, visited, recursionStack, []);
      if (cycle) {
        // Find the relationship that creates the cycle
        const cycleStart = cycle.cycle[cycle.cycle.length - 1];
        const cycleEnd = cycle.cycle[0];
        const key = `${cycleStart}->${cycleEnd}`;
        const rel = relMap.get(key);

        // Return the position of the relationship that creates the cycle
        if (rel) {
          return {
            cycle: cycle.cycle,
            position: rel.position
          };
        }

        // If no specific relationship found, find any relationship in the cycle
        for (let i = 0; i < cycle.cycle.length - 1; i++) {
          const key = `${cycle.cycle[i]}->${cycle.cycle[i + 1]}`;
          const rel = relMap.get(key);
          if (rel) {
            return {
              cycle: cycle.cycle,
              position: rel.position
            };
          }
        }

        return cycle;
      }
    }

    return null;
  }

  private findCycle(
    node: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[]
  ): { cycle: string[]; position: any } | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const result = this.findCycle(neighbor, graph, visited, recursionStack, [...path]);
          if (result) return result;
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          return {
            cycle: path.slice(cycleStart),
            position: { from: 0, to: 0 }
          };
        }
      }
    }

    recursionStack.delete(node);
    return null;
  }

  // Find tables without primary keys
  findTablesWithoutPrimaryKeys(): string[] {
    const tables: string[] = [];

    for (const [name, table] of this.tables) {
      // Skip schema-prefixed duplicates
      if (name.includes('.')) continue;

      // Check if any column has pk flag
      const hasColumnPK = Array.from(table.columns.values()).some(col => col.pk);

      // Check if any index has pk flag (composite primary key)
      const hasIndexPK = table.indexes.some(idx => idx.pk === true);

      if (!hasColumnPK && !hasIndexPK) {
        tables.push(name);
      }
    }

    return tables;
  }

  // Find duplicate column definitions
  findDuplicateColumns(): { table: string; column: string }[] {
    const duplicates: { table: string; column: string }[] = [];

    for (const [tableName, table] of this.tables) {
      // Skip schema-prefixed duplicates
      if (tableName.includes('.')) continue;

      const columnNames = new Set<string>();
      for (const colName of table.columns.keys()) {
        const lowerName = colName.toLowerCase();
        if (columnNames.has(lowerName)) {
          duplicates.push({ table: tableName, column: colName });
        }
        columnNames.add(lowerName);
      }
    }

    return duplicates;
  }

  // Get all table names for autocomplete
  getAllTableNames(): string[] {
    const names = new Set<string>();
    for (const [name, table] of this.tables) {
      names.add(name);
      if (table.alias) {
        names.add(table.alias);
      }
    }
    return Array.from(names);
  }

  // Get all column names for a table
  getTableColumns(tableName: string): string[] {
    const table = this.getTable(tableName);
    return table ? Array.from(table.columns.keys()) : [];
  }

  // Get all enum values
  getEnumValues(enumName: string): string[] {
    const enumInfo = this.getEnum(enumName);
    return enumInfo ? enumInfo.values.map(v => v.name) : [];
  }
}