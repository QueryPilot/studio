import { type Diagnostic, linter } from "@codemirror/lint";
import { type EditorView } from "@codemirror/view";
import { type Text, type Extension } from "@codemirror/state";
import {
  DBMLValidator,
  type ValidationError,
  ValidationCode,
} from "./dbml-validator";
import { DBMLSchema } from "./dbml-schema";

export interface DBMLDiagnostic extends Diagnostic {
  code?: string;
  data?: any;
  from: number;
  to: number;
}

class DBMLLinter {
  private validator: DBMLValidator;
  private schemaCache = new WeakMap<Text, DBMLSchema>();
  private diagnosticsCache = new WeakMap<Text, DBMLDiagnostic[]>();

  constructor() {
    this.validator = new DBMLValidator();
  }

  lint(view: EditorView): DBMLDiagnostic[] {
    const doc = view.state.doc;

    // Check cache first
    const cached = this.diagnosticsCache.get(doc);
    if (cached) return cached;

    const diagnostics: DBMLDiagnostic[] = [];

    // Parse the document
    const parseResult = this.validator.parse(doc);

    // Add parse errors
    for (const error of parseResult.errors) {
      diagnostics.push(this.toDiagnostic(error));
    }

    if (!parseResult.success || !parseResult.ast) {
      this.diagnosticsCache.set(doc, diagnostics);
      return diagnostics;
    }

    // Build schema from AST
    const schema = DBMLSchema.fromAST(parseResult.ast, doc);
    this.schemaCache.set(doc, schema);

    // Run semantic validations
    diagnostics.push(...this.validateSemantics(schema, doc));

    // Run best practice checks
    diagnostics.push(...this.validateBestPractices(schema, doc));

    // Cache results
    this.diagnosticsCache.set(doc, diagnostics);
    return diagnostics;
  }

  private validateSemantics(schema: DBMLSchema, _doc: Text): DBMLDiagnostic[] {
    const diagnostics: DBMLDiagnostic[] = [];

    // Check for undefined table references in relationships
    for (const rel of schema.relationships) {
      if (!schema.hasTable(rel.fromTable)) {
        diagnostics.push({
          from: rel.position.from || 0,
          to: rel.position.to || 0,
          severity: "error",
          message: `Table '${rel.fromTable}' is not defined`,
          code: ValidationCode.UNDEFINED_TABLE,
          data: {
            tableName: rel.fromTable,
            suggestions: this.findSimilarTables(rel.fromTable, schema),
          },
        });
      }

      if (!schema.hasTable(rel.toTable)) {
        diagnostics.push({
          from: rel.position.from || 0,
          to: rel.position.to || 0,
          severity: "error",
          message: `Table '${rel.toTable}' is not defined`,
          code: ValidationCode.UNDEFINED_TABLE,
          data: {
            tableName: rel.toTable,
            suggestions: this.findSimilarTables(rel.toTable, schema),
          },
        });
      }

      // Check for undefined columns
      if (schema.hasTable(rel.fromTable)) {
        for (const col of rel.fromColumns) {
          if (!schema.hasColumn(rel.fromTable, col)) {
            diagnostics.push({
              from: rel.position.from || 0,
              to: rel.position.to || 0,
              severity: "error",
              message: `Column '${col}' not found in table '${rel.fromTable}'`,
              code: ValidationCode.UNDEFINED_COLUMN,
              data: {
                tableName: rel.fromTable,
                columnName: col,
                suggestions: this.findSimilarColumns(
                  col,
                  rel.fromTable,
                  schema,
                ),
              },
            });
          }
        }
      }

      if (schema.hasTable(rel.toTable)) {
        for (const col of rel.toColumns) {
          if (!schema.hasColumn(rel.toTable, col)) {
            diagnostics.push({
              from: rel.position.from || 0,
              to: rel.position.to || 0,
              severity: "error",
              message: `Column '${col}' not found in table '${rel.toTable}'`,
              code: ValidationCode.UNDEFINED_COLUMN,
              data: {
                tableName: rel.toTable,
                columnName: col,
                suggestions: this.findSimilarColumns(col, rel.toTable, schema),
              },
            });
          }
        }
      }
    }

    // Check for circular references
    const cycle = schema.detectCircularReferences();
    if (cycle) {
      diagnostics.push({
        from: cycle.position.from,
        to: cycle.position.to,
        severity: "error",
        message: `Circular reference detected: ${cycle.cycle.join(" -> ")} -> ${
          cycle.cycle[0]
        }`,
        code: ValidationCode.CIRCULAR_REFERENCE,
        data: { cycle: cycle.cycle },
      });
    }

    // Check for conflicting primary key definitions
    // Only flag if table has BOTH column-level PKs AND index-level PK (different definitions)
    for (const [tableName, table] of schema.tables) {
      // Skip schema-prefixed duplicates
      if (tableName.includes(".")) continue;

      const pkColumns = Array.from(table.columns.values()).filter(
        (col) => col.pk,
      );
      const pkIndex = table.indexes.find((idx) => idx.pk);

      // Only error if we have both column PKs and index PK, and they're different
      if (pkColumns.length > 0 && pkIndex) {
        const columnPKNames = pkColumns.map((col) => col.name).sort();
        const indexPKNames = pkIndex.columns.sort();

        if (JSON.stringify(columnPKNames) !== JSON.stringify(indexPKNames)) {
          diagnostics.push({
            from: table.position.from,
            to: table.position.to,
            severity: "error",
            message: `Table '${tableName}' has conflicting primary key definitions in columns and indexes`,
            code: ValidationCode.DUPLICATE_PRIMARY_KEY,
            data: {
              tableName,
              columnPKs: columnPKNames,
              indexPKs: indexPKNames,
            },
          });
        }
      }
    }

    // Check column references in inline refs
    for (const [tableName, table] of schema.tables) {
      if (tableName.includes(".")) continue;

      for (const [, col] of table.columns) {
        if (col.ref) {
          const [refTable, refColumn = "id"] = col.ref.split(".");
          if (refTable && !schema.hasTable(refTable)) {
            diagnostics.push({
              from: col.position.from,
              to: col.position.to,
              severity: "error",
              message: `Referenced table '${refTable}' not found`,
              code: ValidationCode.UNDEFINED_TABLE,
              data: {
                tableName: refTable,
                suggestions: refTable
                  ? this.findSimilarTables(refTable, schema)
                  : [],
              },
            });
          } else if (refTable && !schema.hasColumn(refTable, refColumn)) {
            diagnostics.push({
              from: col.position.from,
              to: col.position.to,
              severity: "error",
              message: `Referenced column '${refColumn}' not found in table '${refTable}'`,
              code: ValidationCode.UNDEFINED_COLUMN,
              data: {
                tableName: refTable,
                columnName: refColumn,
                suggestions: refTable
                  ? this.findSimilarColumns(refColumn, refTable, schema)
                  : [],
              },
            });
          }
        }
      }
    }

    return diagnostics;
  }

  private validateBestPractices(
    schema: DBMLSchema,
    _doc: Text,
  ): DBMLDiagnostic[] {
    const diagnostics: DBMLDiagnostic[] = [];

    // Check for tables without primary keys
    const tablesWithoutPK = schema.findTablesWithoutPrimaryKeys();
    for (const tableName of tablesWithoutPK) {
      const table = schema.getTable(tableName);
      if (table) {
        diagnostics.push({
          from: table.position.from,
          to: table.position.to,
          severity: "warning",
          message: `Table '${tableName}' should have a primary key`,
          code: ValidationCode.MISSING_PRIMARY_KEY,
          data: { tableName },
        });
      }
    }

    // REMOVED: Foreign key index suggestion (not always necessary)

    // REMOVED: Documentation check (too opinionated)
    // REMOVED: Naming convention check (too opinionated)

    // Check for reserved keywords
    const reserved = [
      "user",
      "order",
      "group",
      "table",
      "column",
      "index",
      "key",
      "value",
    ];
    for (const [tableName, table] of schema.tables) {
      if (tableName.includes(".")) continue;

      if (reserved.includes(tableName.toLowerCase())) {
        diagnostics.push({
          from: table.position.from,
          to: table.position.to,
          severity: "warning",
          message: `'${tableName}' might be a reserved keyword in some databases`,
          code: ValidationCode.RESERVED_KEYWORD,
          data: { name: tableName, type: "table" },
        });
      }

      for (const colName of table.columns.keys()) {
        if (reserved.includes(colName.toLowerCase())) {
          const col = table.columns.get(colName)!;
          diagnostics.push({
            from: col.position.from,
            to: col.position.to,
            severity: "warning",
            message: `'${colName}' might be a reserved keyword in some databases`,
            code: ValidationCode.RESERVED_KEYWORD,
            data: { name: colName, type: "column" },
          });
        }
      }
    }

    return diagnostics;
  }

  private toDiagnostic(error: ValidationError): DBMLDiagnostic {
    return {
      from: error.from,
      to: error.to,
      severity: error.severity,
      message: error.message,
      code: error.code,
      data: error.data,
    };
  }

  private findSimilarTables(name: string, schema: DBMLSchema): string[] {
    const allTables = schema.getAllTableNames();
    return this.findSimilar(name, allTables);
  }

  private findSimilarColumns(
    name: string,
    tableName: string,
    schema: DBMLSchema,
  ): string[] {
    const columns = schema.getTableColumns(tableName);
    return this.findSimilar(name, columns);
  }

  private findSimilar(target: string, candidates: string[]): string[] {
    const results: { name: string; distance: number }[] = [];

    for (const candidate of candidates) {
      const distance = this.levenshteinDistance(
        target.toLowerCase(),
        candidate.toLowerCase(),
      );
      if (distance <= 2) {
        results.push({ name: candidate, distance });
      }
    }

    return results
      .sort((a, b) => a.distance - b.distance)
      .map((r) => r.name)
      .slice(0, 3);
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      if (!matrix[0]) matrix[0] = [];
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      if (!matrix[i]) matrix[i] = [];
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1]?.[j - 1] ?? 0;
        } else {
          matrix[i][j] = Math.min(
            (matrix[i - 1]?.[j - 1] ?? 0) + 1,
            (matrix[i]?.[j - 1] ?? 0) + 1,
            (matrix[i - 1]?.[j] ?? 0) + 1,
          );
        }
      }
    }

    return matrix[b.length]?.[a.length] ?? 0;
  }

  invalidateCache(doc: Text) {
    this.schemaCache.delete(doc);
    this.diagnosticsCache.delete(doc);
    this.validator.invalidateCache(doc);
  }
}

// Create the linter extension
export function dbmlLinter(): Extension {
  const linterInstance = new DBMLLinter();
  let lintTimeout: NodeJS.Timeout;

  return linter(
    (view) => {
      // Debounce linting
      clearTimeout(lintTimeout);
      return new Promise((resolve) => {
        lintTimeout = setTimeout(() => {
          resolve(linterInstance.lint(view));
        }, 300);
      });
    },
    {
      delay: 500,
      needsRefresh: (update) => {
        // Only re-lint on document changes
        if (update.docChanged) {
          linterInstance.invalidateCache(update.state.doc);
          return true;
        }
        return false;
      },
      tooltipFilter: (diagnostics) => {
        // Remove duplicate diagnostics
        const seen = new Set<string>();
        return diagnostics.filter((d) => {
          const key = `${d.from}-${d.to}-${d.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
    },
  );
}
