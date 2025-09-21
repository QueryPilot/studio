# DBML Linter & IntelliSense Specification

## Executive Summary

This document specifies the implementation of a comprehensive DBML linter and code suggestion system for CodeMirror 6, building upon the syntax highlighting foundation described in `dbml-syntax-highlighter.spec.md`. The system will provide real-time validation, intelligent code completion, and contextual suggestions for DBML (Database Markup Language).

## Goals

1. **Real-time Validation**: Detect and report DBML syntax errors, semantic issues, and best practice violations
2. **Intelligent Suggestions**: Context-aware code completion for keywords, identifiers, and structures
3. **Schema Validation**: Validate references, relationships, and constraints
4. **Best Practice Enforcement**: Warn about anti-patterns and suggest improvements
5. **Quick Fixes**: Provide automatic fixes for common issues

## Architecture Overview

### Core Components

```
┌─────────────────────────────────────────────┐
│             CodeMirror Editor                │
├─────────────────────────────────────────────┤
│          DBML Language Support               │
│  ┌─────────────────────────────────────┐    │
│  │  Syntax Highlighting (StreamLang)   │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │         DBML Linter                 │    │
│  │  ┌────────────┐  ┌───────────────┐ │    │
│  │  │ @dbml/core │  │  Validator    │ │    │
│  │  └────────────┘  └───────────────┘ │    │
│  │  ┌────────────┐  ┌───────────────┐ │    │
│  │  │   Rules    │  │  Diagnostics  │ │    │
│  │  └────────────┘  └───────────────┘ │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │      IntelliSense Provider          │    │
│  │  ┌────────────┐  ┌───────────────┐ │    │
│  │  │   Schema   │  │  Suggestions  │ │    │
│  │  │   Cache    │  │   Generator   │ │    │
│  │  └────────────┘  └───────────────┘ │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## Part 1: DBML Linter Implementation

### 1.1 Validation Rules Categories

#### Syntax Rules (Errors)
```typescript
enum SyntaxError {
  // Structure errors
  UNCLOSED_BLOCK = "Unclosed block - missing '}'",
  MISSING_BLOCK_NAME = "Block definition missing name",
  INVALID_IDENTIFIER = "Invalid identifier format",
  DUPLICATE_DEFINITION = "Duplicate definition",

  // Relationship errors
  INVALID_REF_SYNTAX = "Invalid relationship syntax",
  MISSING_REF_TARGET = "Missing relationship target",
  INVALID_REF_OPERATOR = "Invalid relationship operator",

  // Settings errors
  INVALID_SETTING_KEY = "Unknown setting key",
  INVALID_SETTING_VALUE = "Invalid setting value",
  MALFORMED_SETTINGS = "Malformed settings syntax",

  // String errors
  UNCLOSED_STRING = "Unclosed string literal",
  UNCLOSED_MULTILINE = "Unclosed multi-line string",
  INVALID_ESCAPE = "Invalid escape sequence",
}
```

#### Semantic Rules (Errors)
```typescript
enum SemanticError {
  // Reference errors
  UNDEFINED_TABLE = "Reference to undefined table",
  UNDEFINED_COLUMN = "Reference to undefined column",
  UNDEFINED_ENUM = "Reference to undefined enum",
  UNDEFINED_SCHEMA = "Reference to undefined schema",

  // Type errors
  TYPE_MISMATCH = "Type mismatch in relationship",
  INVALID_DEFAULT_VALUE = "Default value type mismatch",

  // Constraint errors
  DUPLICATE_PRIMARY_KEY = "Multiple primary keys defined",
  CIRCULAR_REFERENCE = "Circular reference detected",
  ORPHANED_RELATIONSHIP = "Relationship references non-existent entity",
}
```

#### Best Practice Rules (Warnings)
```typescript
enum BestPractice {
  // Naming conventions
  INCONSISTENT_NAMING = "Inconsistent naming convention",
  RESERVED_KEYWORD = "Using reserved keyword as identifier",

  // Schema design
  MISSING_PRIMARY_KEY = "Table missing primary key",
  MISSING_INDEXES = "Foreign key without index",
  REDUNDANT_INDEX = "Redundant index definition",

  // Documentation
  MISSING_TABLE_NOTE = "Table missing documentation",
  MISSING_COLUMN_NOTE = "Important column missing documentation",

  // Performance
  LARGE_COMPOSITE_KEY = "Composite key with many columns",
  MISSING_NOT_NULL = "Column should probably be NOT NULL",
}
```

### 1.2 Linter Implementation

```typescript
// src/components/CodeEditor/languages/dbml/linter.ts
import { Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { Parser as DBMLParser } from "@dbml/core";

interface DBMLDiagnostic extends Diagnostic {
  code?: string;
  data?: any; // For quick fixes
}

class DBMLLinter {
  private schemaCache = new WeakMap<Text, DBMLSchema>();
  private parseCache = new WeakMap<Text, any>();
  private lastDocVersion: number = 0;
  private parser = new DBMLParser();

  constructor() {
    // Initialize validation rules
  }

  lint(view: EditorView): DBMLDiagnostic[] {
    const diagnostics: DBMLDiagnostic[] = [];
    const doc = view.state.doc;
    const docString = doc.toString();

    // Use cached parse if document unchanged
    let parseResult = this.parseCache.get(doc);
    if (!parseResult) {
      try {
        // Use @dbml/core for parsing
        parseResult = this.parser.parse(docString, 'dbml');
        this.parseCache.set(doc, parseResult);
      } catch (error: any) {
        // Handle parse errors
        if (error.location) {
          diagnostics.push({
            from: this.getOffsetFromLocation(doc, error.location.start),
            to: this.getOffsetFromLocation(doc, error.location.end),
            severity: "error",
            message: error.message,
            code: "PARSE_ERROR",
          });
        }
        return diagnostics;
      }
    }

    // Build/update schema from parse result
    const schema = this.buildSchema(parseResult, doc);

    // Run validation rules
    diagnostics.push(...this.validateSyntax(parseResult, doc));
    diagnostics.push(...this.validateSemantics(schema, doc));
    diagnostics.push(...this.validateBestPractices(schema, doc));

    return diagnostics;
  }

  private buildSchema(parseResult: any, doc: Text): DBMLSchema {
    let schema = this.schemaCache.get(doc);
    if (!schema) {
      schema = new DBMLSchema();
      // Process DBML AST from @dbml/core
      if (parseResult.schemas) {
        for (const schemaObj of parseResult.schemas) {
          for (const table of schemaObj.tables) {
            schema.addTable({
              name: table.name,
              schema: schemaObj.name,
              columns: new Map(table.fields.map((f: any) => [f.name, {
                type: f.type.type_name,
                nullable: !f.not_null,
                pk: f.pk,
                unique: f.unique,
              }])),
              position: { from: 0, to: 0 } // TODO: map positions
            });
          }

          for (const enumObj of schemaObj.enums) {
            schema.addEnum({
              name: enumObj.name,
              values: enumObj.values.map((v: any) => v.name),
              position: { from: 0, to: 0 }
            });
          }

          for (const ref of schemaObj.refs) {
            schema.addRelationship({
              fromTable: ref.endpoints[0].tableName,
              fromColumn: ref.endpoints[0].fieldNames[0],
              toTable: ref.endpoints[1].tableName,
              toColumn: ref.endpoints[1].fieldNames[0],
              type: ref.endpoints[0].relation,
              position: { from: 0, to: 0 }
            });
          }
        }
      }
      this.schemaCache.set(doc, schema);
    }
    return schema;
  }

  private getOffsetFromLocation(doc: Text, location: {line: number, column: number}): number {
    const line = doc.line(location.line);
    return line.from + location.column - 1;
  }

  private validateGlobal(): DBMLDiagnostic[] {
    const diagnostics: DBMLDiagnostic[] = [];

    // Check for orphaned relationships
    for (const ref of this.schema.relationships) {
      if (!this.schema.hasTable(ref.fromTable)) {
        diagnostics.push({
          from: ref.position.from,
          to: ref.position.to,
          severity: "error",
          message: `Table '${ref.fromTable}' not found`,
          code: "UNDEFINED_TABLE",
        });
      }
    }

    return diagnostics;
  }
}

// Schema model for semantic analysis
class DBMLSchema {
  tables: Map<string, TableInfo> = new Map();
  enums: Map<string, EnumInfo> = new Map();
  relationships: RelationshipInfo[] = [];
  tableGroups: Map<string, string[]> = new Map();
  tablePartials: Map<string, TableInfo> = new Map(); // DBML-specific

  addTable(table: TableInfo) {
    const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;
    this.tables.set(fullName, table);
    this.tables.set(table.name, table); // Also store without schema for convenience
  }

  addTablePartial(partial: TableInfo) {
    this.tablePartials.set(partial.name, partial);
    // Merge with existing table if exists
    const existing = this.tables.get(partial.name);
    if (existing) {
      // Merge columns
      for (const [name, col] of partial.columns) {
        existing.columns.set(name, col);
      }
    }
  }

  addEnum(enumInfo: EnumInfo) {
    this.enums.set(enumInfo.name, enumInfo);
  }

  addRelationship(rel: RelationshipInfo) {
    this.relationships.push(rel);
  }

  hasTable(name: string): boolean {
    // Check with and without schema prefix
    return this.tables.has(name) ||
           this.tables.has(`public.${name}`) ||
           this.tablePartials.has(name);
  }

  getTable(name: string): TableInfo | undefined {
    return this.tables.get(name) ||
           this.tables.get(`public.${name}`) ||
           this.tablePartials.get(name);
  }

  hasColumn(table: string, column: string): boolean {
    const tableInfo = this.getTable(table);
    return tableInfo ? tableInfo.columns.has(column) : false;
  }

  // Check for circular references
  hasCircularReference(): {cycle: string[], position: any} | null {
    const graph = new Map<string, Set<string>>();

    for (const rel of this.relationships) {
      if (!graph.has(rel.fromTable)) {
        graph.set(rel.fromTable, new Set());
      }
      graph.get(rel.fromTable)!.add(rel.toTable);
    }

    // DFS to find cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const table of graph.keys()) {
      const cycle = this.findCycleDFS(table, graph, visited, recursionStack, []);
      if (cycle) {
        return cycle;
      }
    }

    return null;
  }

  private findCycleDFS(
    node: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[]
  ): {cycle: string[], position: any} | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const result = this.findCycleDFS(neighbor, graph, visited, recursionStack, [...path]);
          if (result) return result;
        } else if (recursionStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          return {
            cycle: path.slice(cycleStart),
            position: { from: 0, to: 0 } // Would need actual positions
          };
        }
      }
    }

    recursionStack.delete(node);
    return null;
  }
}

// Example rule implementation
class UndefinedReferenceRule implements LintRule {
  constructor(private schema: DBMLSchema) {}

  check(node: SyntaxNode, doc: Text, schema: DBMLSchema): DBMLDiagnostic[] {
    const diagnostics: DBMLDiagnostic[] = [];

    if (node.name === "TableReference") {
      const tableName = doc.sliceString(node.from, node.to);
      if (!schema.hasTable(tableName)) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: `Table '${tableName}' is not defined`,
          code: "UNDEFINED_TABLE",
          data: {
            tableName,
            suggestions: this.findSimilarTables(tableName, schema),
          },
        });
      }
    }

    return diagnostics;
  }

  private findSimilarTables(name: string, schema: DBMLSchema): string[] {
    // Levenshtein distance for suggestions
    return Array.from(schema.tables.keys())
      .map(table => ({ table, distance: levenshtein(name, table) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance)
      .map(({ table }) => table);
  }
}

// Create the linter extension
export function dbmlLinter(): Extension {
  const linterInstance = new DBMLLinter();
  let lintTimeout: NodeJS.Timeout;

  return linter(
    (view) => {
      // Debounce linting for performance
      clearTimeout(lintTimeout);
      return new Promise((resolve) => {
        lintTimeout = setTimeout(() => {
          resolve(linterInstance.lint(view));
        }, 300);
      });
    },
    {
      delay: 500, // Debounce delay
      needsRefresh: (update) => {
        // Only re-lint on actual document changes
        return update.docChanged;
      },
      tooltipFilter: (diagnostics) => {
        // Group similar diagnostics
        const seen = new Set<string>();
        return diagnostics.filter(d => {
          const key = `${d.from}-${d.to}-${d.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
    }
  );
}
```

### 1.3 Quick Fix Provider

```typescript
// src/components/CodeEditor/languages/dbml/quickfix.ts
import { Action } from "@codemirror/lint";

interface QuickFix {
  title: string;
  apply: (view: EditorView, diagnostic: DBMLDiagnostic) => void;
}

class QuickFixProvider {
  getQuickFixes(diagnostic: DBMLDiagnostic): Action[] {
    const fixes: Action[] = [];

    switch (diagnostic.code) {
      case "UNDEFINED_TABLE":
        fixes.push(...this.getUndefinedTableFixes(diagnostic));
        break;
      case "MISSING_PRIMARY_KEY":
        fixes.push(this.getAddPrimaryKeyFix(diagnostic));
        break;
      case "INCONSISTENT_NAMING":
        fixes.push(this.getRenamefix(diagnostic));
        break;
    }

    return fixes;
  }

  private getUndefinedTableFixes(diagnostic: DBMLDiagnostic): Action[] {
    const fixes: Action[] = [];
    const { tableName, suggestions } = diagnostic.data;

    // Suggest similar tables
    for (const suggestion of suggestions) {
      fixes.push({
        name: `Change to '${suggestion}'`,
        apply: (view) => {
          view.dispatch({
            changes: {
              from: diagnostic.from,
              to: diagnostic.to,
              insert: suggestion,
            },
          });
        },
      });
    }

    // Create table
    fixes.push({
      name: `Create table '${tableName}'`,
      apply: (view) => {
        const insertion = `\n\nTable ${tableName} {\n  id integer [pk]\n}\n`;
        view.dispatch({
          changes: {
            from: view.state.doc.length,
            insert: insertion,
          },
        });
      },
    });

    return fixes;
  }
}
```

## Part 2: IntelliSense Implementation

### 2.1 Context-Aware Suggestions

```typescript
// src/components/CodeEditor/languages/dbml/intellisense.ts
import {
  CompletionContext,
  CompletionResult,
  Completion,
  snippetCompletion,
  completeFromList
} from "@codemirror/autocomplete";

class DBMLIntelliSense {
  private schemaCache = new WeakMap<Text, DBMLSchema>();
  private parser = new DBMLParser();

  async getCompletions(context: CompletionContext): Promise<CompletionResult | null> {
    const doc = context.state.doc;
    const pos = context.pos;
    const line = doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const textAfter = line.text.slice(pos - line.from);

    // Get or build schema
    let schema = this.schemaCache.get(doc);
    if (!schema) {
      schema = this.buildSchemaFromDoc(doc);
      this.schemaCache.set(doc, schema);
    }

    // Determine context from cursor position and text patterns
    const completions = this.getContextualCompletions(textBefore, textAfter, schema, context);

    if (!completions.length) return null;

    return {
      from: context.matchBefore(/\w*/)?.from ?? context.pos,
      options: completions,
      validFor: /^\w*$/,
    };
  }

  private buildSchemaFromDoc(doc: Text): DBMLSchema {
    const schema = new DBMLSchema();
    try {
      const result = this.parser.parse(doc.toString(), 'dbml');
      // Build schema from parse result (same as linter)
      // ... implementation
    } catch (e) {
      // Return empty schema if parse fails
    }
    return schema;
  }

  private getContextualCompletions(
    textBefore: string,
    textAfter: string,
    schema: DBMLSchema,
    context: CompletionContext
  ): Completion[] {
    // Pattern-based context detection
    const trimmedBefore = textBefore.trim();
    const lastWord = trimmedBefore.split(/\s+/).pop() || '';

    // Top-level completions
    if (trimmedBefore === '' || trimmedBefore.match(/^}\s*$/)) {
      return this.getTopLevelCompletions();
    }

    // Inside table block (detect by looking for unclosed Table {)
    if (this.isInsideTableBlock(context.state.doc, context.pos)) {
      return this.getTableContentCompletions(schema);
    }

    // Inside indexes block
    if (trimmedBefore.includes('indexes {') && !trimmedBefore.includes('}')) {
      return this.getIndexCompletions(schema, context);
    }

    // Column settings (inside square brackets)
    if (textBefore.includes('[') && !textBefore.includes(']')) {
      return this.getSettingsCompletions(context);
    }

    // Relationship completions
    if (trimmedBefore.startsWith('Ref:') || trimmedBefore.includes('ref:')) {
      return this.getRelationshipCompletions(schema, textBefore);
    }

    // After a dot (table.column completion)
    if (lastWord.includes('.')) {
      const [tableName] = lastWord.split('.');
      return this.getColumnCompletions(schema, tableName);
    }

    return [];
  }

  private isInsideTableBlock(doc: Text, pos: number): boolean {
    // Scan backwards to find if we're inside a Table { ... } block
    const text = doc.toString().slice(0, pos);
    let braceCount = 0;
    let inTable = false;

    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim().match(/^Table\s+\w+.*\{/)) {
        inTable = true;
        braceCount = 1;
      } else if (inTable) {
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) inTable = false;
          }
        }
      }
    }

    return inTable;
  }

  private getTopLevelCompletions(): Completion[] {
    return [
      snippetCompletion("Table ${name} {\n  $0\n}", {
        label: "Table",
        type: "keyword",
        detail: "Create a new table",
        boost: 10,
      }),
      snippetCompletion("Enum ${name} {\n  $0\n}", {
        label: "Enum",
        type: "keyword",
        detail: "Create an enum type",
        boost: 8,
      }),
      snippetCompletion("Ref: ${from_table}.${from_col} ${op} ${to_table}.${to_col}", {
        label: "Ref",
        type: "keyword",
        detail: "Define a relationship",
        boost: 7,
      }),
      snippetCompletion("TableGroup ${name} {\n  $0\n}", {
        label: "TableGroup",
        type: "keyword",
        detail: "Group related tables",
        boost: 5,
      }),
      snippetCompletion("Project ${name} {\n  database_type: '${PostgreSQL}'\n  Note: '$0'\n}", {
        label: "Project",
        type: "keyword",
        detail: "Define project metadata",
        boost: 9,
      }),
      snippetCompletion("Note ${name} {\n  '$0'\n}", {
        label: "Note",
        type: "keyword",
        detail: "Add a sticky note",
        boost: 3,
      }),
    ];
  }

  private getTableContentCompletions(node: SyntaxNode): Completion[] {
    const completions: Completion[] = [];

    // Column type suggestions
    const dataTypes = [
      "integer", "bigint", "smallint",
      "varchar", "text", "char",
      "boolean", "bool",
      "timestamp", "timestamptz", "date", "time",
      "decimal", "numeric", "real", "double",
      "json", "jsonb",
      "uuid", "xml",
      "array", "bytea"
    ];

    dataTypes.forEach(type => {
      completions.push({
        label: type,
        type: "type",
        apply: type,
        boost: 5,
      });
    });

    // Common column patterns
    completions.push(
      snippetCompletion("id integer [pk, increment]", {
        label: "id (auto-increment)",
        type: "property",
        detail: "Primary key with auto-increment",
        boost: 10,
      }),
      snippetCompletion("created_at timestamp [default: `now()`]", {
        label: "created_at",
        type: "property",
        detail: "Creation timestamp",
        boost: 8,
      }),
      snippetCompletion("updated_at timestamp [default: `now()`]", {
        label: "updated_at",
        type: "property",
        detail: "Update timestamp",
        boost: 8,
      }),
      snippetCompletion("${name} ${type} [ref: > ${table}.id]", {
        label: "foreign_key",
        type: "property",
        detail: "Foreign key column",
        boost: 7,
      }),
      snippetCompletion("indexes {\n    $0\n  }", {
        label: "indexes",
        type: "keyword",
        detail: "Define indexes",
        boost: 6,
      }),
      snippetCompletion("Note: '$0'", {
        label: "Note",
        type: "keyword",
        detail: "Add table note",
        boost: 4,
      }),
    );

    return completions;
  }

  private getSettingsCompletions(node: SyntaxNode): Completion[] {
    // Context-aware settings based on parent
    const parent = this.findParentBlock(node);

    if (parent?.name === "ColumnDef") {
      return [
        { label: "pk", type: "keyword", detail: "Primary key" },
        { label: "primary key", type: "keyword", detail: "Primary key" },
        { label: "unique", type: "keyword", detail: "Unique constraint" },
        { label: "not null", type: "keyword", detail: "Not null constraint" },
        { label: "null", type: "keyword", detail: "Nullable" },
        { label: "increment", type: "keyword", detail: "Auto-increment" },
        snippetCompletion("default: ${value}", {
          label: "default",
          type: "keyword",
          detail: "Default value",
        }),
        snippetCompletion("note: '${text}'", {
          label: "note",
          type: "keyword",
          detail: "Column note",
        }),
        snippetCompletion("ref: > ${table}.${column}", {
          label: "ref",
          type: "keyword",
          detail: "Inline foreign key",
        }),
      ];
    }

    if (parent?.name === "TableDef") {
      return [
        snippetCompletion("headercolor: #${3498DB}", {
          label: "headercolor",
          type: "keyword",
          detail: "Table header color",
        }),
      ];
    }

    if (parent?.name === "RefDef") {
      return [
        { label: "delete: cascade", type: "keyword" },
        { label: "delete: restrict", type: "keyword" },
        { label: "delete: set null", type: "keyword" },
        { label: "delete: set default", type: "keyword" },
        { label: "delete: no action", type: "keyword" },
        { label: "update: cascade", type: "keyword" },
        { label: "update: restrict", type: "keyword" },
        { label: "update: set null", type: "keyword" },
        { label: "update: set default", type: "keyword" },
        { label: "update: no action", type: "keyword" },
      ];
    }

    return [];
  }

  private getRelationshipCompletions(node: SyntaxNode): Completion[] {
    const completions: Completion[] = [];
    const position = this.determineRelPosition(node);

    if (position === "from" || position === "to") {
      // Suggest existing tables
      for (const [name, table] of this.schema.tables) {
        completions.push({
          label: name,
          type: "type",
          detail: `Table (${table.columns.size} columns)`,
          boost: 10,
        });

        // Also suggest table.column combinations
        for (const column of table.columns.keys()) {
          completions.push({
            label: `${name}.${column}`,
            type: "property",
            detail: table.columns.get(column)?.type,
            boost: 8,
          });
        }
      }
    }

    if (position === "operator") {
      return [
        { label: ">", type: "operator", detail: "many-to-one" },
        { label: "<", type: "operator", detail: "one-to-many" },
        { label: "-", type: "operator", detail: "one-to-one" },
        { label: "<>", type: "operator", detail: "many-to-many" },
      ];
    }

    return completions;
  }

  private getIndexCompletions(node: SyntaxNode): Completion[] {
    const table = this.findParentTable(node);
    if (!table) return [];

    const completions: Completion[] = [];

    // Suggest columns from current table
    for (const column of table.columns.keys()) {
      completions.push({
        label: column,
        type: "property",
        detail: "Column index",
        boost: 10,
      });
    }

    // Composite index
    completions.push(
      snippetCompletion("(${col1}, ${col2})", {
        label: "(composite)",
        type: "keyword",
        detail: "Composite index",
        boost: 8,
      })
    );

    // Index settings
    completions.push(
      snippetCompletion("${column} [unique]", {
        label: "unique index",
        type: "keyword",
        detail: "Unique index",
        boost: 7,
      }),
      snippetCompletion("${column} [type: ${hash}]", {
        label: "typed index",
        type: "keyword",
        detail: "Index with type",
        boost: 6,
      })
    );

    return completions;
  }
}

// Export the completion source
export function dbmlCompletions(): Extension {
  const intelliSense = new DBMLIntelliSense();

  return autocompletion({
    override: [(context) => intelliSense.getCompletions(context)],
    activateOnTyping: true,
    maxRenderedOptions: 50,
    defaultKeymap: true,
  });
}
```

### 2.2 Snippet Library

```typescript
// src/components/CodeEditor/languages/dbml/snippets.ts
export const dbmlSnippets: Completion[] = [
  // Complete table with common fields
  snippetCompletion(`Table \${1:table_name} {
  id integer [pk, increment]
  created_at timestamp [default: \`now()\`]
  updated_at timestamp [default: \`now()\`]
  \$0
}`, {
    label: "table-timestamps",
    type: "snippet",
    detail: "Table with timestamps",
  }),

  // User table template
  snippetCompletion(`Table users {
  id integer [pk, increment]
  email varchar [unique, not null]
  password_hash varchar [not null]
  username varchar [unique]
  first_name varchar
  last_name varchar
  created_at timestamp [default: \`now()\`]
  updated_at timestamp [default: \`now()\`]

  indexes {
    email
    username
  }
}`, {
    label: "table-users",
    type: "snippet",
    detail: "User table template",
  }),

  // Many-to-many junction table
  snippetCompletion(`Table \${1:table1}_\${2:table2} {
  \${1}_id integer [ref: > \${1}s.id]
  \${2}_id integer [ref: > \${2}s.id]
  created_at timestamp [default: \`now()\`]

  indexes {
    (\${1}_id, \${2}_id) [pk]
  }
}`, {
    label: "table-junction",
    type: "snippet",
    detail: "Many-to-many junction table",
  }),

  // Enum for status
  snippetCompletion(`Enum \${1:status} {
  pending
  processing
  completed
  failed
  cancelled
}`, {
    label: "enum-status",
    type: "snippet",
    detail: "Status enum",
  }),
];
```

## Part 3: Integration & Configuration

### 3.1 Editor Integration

```typescript
// src/components/CodeEditor/languages/dbml/index.ts
import { LanguageSupport } from "@codemirror/language";
import { dbmlLanguage } from "./dbml-language";
import { dbmlHighlighting } from "./highlighting";
import { dbmlLinter, lintGutter } from "./linter";
import { dbmlCompletions } from "./intellisense";
import { dbmlFolding } from "./folding";

export function dbml(): LanguageSupport {
  return new LanguageSupport(
    dbmlLanguage, // StreamLanguage-based
    [
      dbmlHighlighting,
      dbmlLinter(),
      lintGutter(),
      dbmlCompletions(),
      dbmlFolding,
      dbmlHover,
      // Performance optimization
      EditorView.updateListener.of((update) => {
        if (update.docChanged && update.changes.length > 1000) {
          // Invalidate caches on large changes
          cache.invalidate(update.state.doc);
        }
      }),
    ]
  );
}

// Configuration options
export interface DBMLConfig {
  lint: {
    enabled: boolean;
    delay: number;
    severityLevels: {
      syntax: "error" | "warning" | "info";
      semantic: "error" | "warning" | "info";
      bestPractice: "warning" | "info" | "ignore";
    };
  };
  intellisense: {
    enabled: boolean;
    triggerCharacters: string[];
    maxSuggestions: number;
    includeSnippets: boolean;
  };
}
```

### 3.2 Performance Optimizations

```typescript
// src/components/CodeEditor/languages/dbml/performance.ts
class DBMLCache {
  private schemaCache: WeakMap<Text, DBMLSchema> = new WeakMap();
  private diagnosticsCache: WeakMap<Text, DBMLDiagnostic[]> = new WeakMap();
  private parseCache: WeakMap<Text, any> = new WeakMap();
  private parser = new DBMLParser();

  getSchema(doc: Text, force = false): DBMLSchema {
    if (!force && this.schemaCache.has(doc)) {
      return this.schemaCache.get(doc)!;
    }

    // Get or create parse result
    let parseResult = this.parseCache.get(doc);
    if (!parseResult || force) {
      try {
        parseResult = this.parser.parse(doc.toString(), 'dbml');
        this.parseCache.set(doc, parseResult);
      } catch (e) {
        // Return empty schema on parse error
        return new DBMLSchema();
      }
    }

    const schema = this.buildSchemaFromParse(parseResult);
    this.schemaCache.set(doc, schema);
    return schema;
  }

  getDiagnostics(doc: Text, force = false): DBMLDiagnostic[] {
    if (!force && this.diagnosticsCache.has(doc)) {
      return this.diagnosticsCache.get(doc)!;
    }

    const diagnostics = this.computeDiagnostics(doc);
    this.diagnosticsCache.set(doc, diagnostics);
    return diagnostics;
  }

  invalidate(doc: Text) {
    // Clear caches when document changes significantly
    this.schemaCache.delete(doc);
    this.diagnosticsCache.delete(doc);
    this.parseCache.delete(doc);
  }

  private buildSchemaFromParse(parseResult: any): DBMLSchema {
    // Implementation to build schema from @dbml/core parse result
    const schema = new DBMLSchema();
    // ... build schema from parseResult
    return schema;
  }

  private computeDiagnostics(doc: Text): DBMLDiagnostic[] {
    // Implementation to compute diagnostics
    return [];
  }
}

// Debounced linting
function createDebouncedLinter(delay = 500): Extension {
  let timeout: NodeJS.Timeout;

  return EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Trigger lint
        update.view.dispatch({
          effects: forceRelint.of(null),
        });
      }, delay);
    }
  });
}
```

## Part 4: Advanced Features

### 4.1 Hover Information

```typescript
// src/components/CodeEditor/languages/dbml/hover.ts
import { hoverTooltip } from "@codemirror/view";

export const dbmlHover = hoverTooltip((view, pos, side) => {
  const tree = syntaxTree(view.state);
  const node = tree.resolveInner(pos, side);

  // Get information based on node type
  const info = getNodeInfo(node, view.state.doc);

  if (!info) return null;

  return {
    pos: node.from,
    end: node.to,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-tooltip-info";
      dom.innerHTML = `
        <div class="cm-tooltip-section">
          <strong>${info.title}</strong>
        </div>
        <div class="cm-tooltip-section">
          ${info.description}
        </div>
        ${info.example ? `
        <div class="cm-tooltip-section">
          <code>${info.example}</code>
        </div>
        ` : ""}
      `;
      return { dom };
    },
  };
});

function getNodeInfo(node: SyntaxNode, doc: Text): HoverInfo | null {
  switch (node.name) {
    case "Table":
      return {
        title: "Table Definition",
        description: "Defines a database table with columns and constraints",
        example: "Table users { id integer [pk] }",
      };
    case "Ref":
      return {
        title: "Relationship",
        description: "Defines a foreign key relationship between tables",
        example: "Ref: posts.user_id > users.id",
      };
    // ... more node types
  }
  return null;
}
```

### 4.2 Code Actions

```typescript
// src/components/CodeEditor/languages/dbml/codeactions.ts
interface CodeAction {
  title: string;
  kind: "quickfix" | "refactor" | "source";
  apply: (view: EditorView) => void;
}

class DBMLCodeActions {
  getActionsAtPosition(view: EditorView, pos: number): CodeAction[] {
    const actions: CodeAction[] = [];
    const node = syntaxTree(view.state).resolveInner(pos, -1);

    // Add primary key if missing
    if (node.name === "TableDef" && !this.hasPrimaryKey(node)) {
      actions.push({
        title: "Add primary key",
        kind: "quickfix",
        apply: (view) => this.addPrimaryKey(view, node),
      });
    }

    // Convert to TablePartial
    if (node.name === "TableDef") {
      actions.push({
        title: "Extract to TablePartial",
        kind: "refactor",
        apply: (view) => this.extractTablePartial(view, node),
      });
    }

    // Generate migration
    actions.push({
      title: "Generate SQL migration",
      kind: "source",
      apply: (view) => this.generateMigration(view),
    });

    return actions;
  }
}
```

## Part 5: Testing Strategy

### 5.1 Unit Tests

```typescript
// src/components/CodeEditor/languages/dbml/__tests__/linter.test.ts
describe("DBML Linter", () => {
  test("detects undefined table references", () => {
    const doc = `
      Table users { id integer }
      Ref: posts.user_id > users.id
    `;
    const diagnostics = linter.lint(doc);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNDEFINED_TABLE",
        message: "Table 'posts' is not defined",
      })
    );
  });

  test("detects duplicate primary keys", () => {
    const doc = `
      Table users {
        id integer [pk]
        uuid varchar [pk]
      }
    `;
    const diagnostics = linter.lint(doc);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_PRIMARY_KEY",
      })
    );
  });
});
```

### 5.2 Integration Tests

```typescript
describe("IntelliSense", () => {
  test("provides table suggestions after FROM", () => {
    const context = createContext("Ref: ", 4);
    const completions = intellisense.getCompletions(context);

    expect(completions.options).toContainEqual(
      expect.objectContaining({
        label: "users",
        type: "type",
      })
    );
  });

  test("provides column suggestions after table.", () => {
    const context = createContext("Ref: users.", 11);
    const completions = intellisense.getCompletions(context);

    expect(completions.options).toContainEqual(
      expect.objectContaining({
        label: "id",
        type: "property",
      })
    );
  });
});
```

## Implementation Timeline

### Phase 1: Core Linter (Week 1)
- [ ] Implement syntax validation rules
- [ ] Create diagnostic system
- [ ] Add basic error reporting
- [ ] Integrate with CodeMirror lint system

### Phase 2: Semantic Analysis (Week 2)
- [ ] Build schema model
- [ ] Implement reference validation
- [ ] Add type checking
- [ ] Create quick fix providers

### Phase 3: IntelliSense (Week 3)
- [ ] Implement context analyzer
- [ ] Create suggestion providers
- [ ] Add snippet library
- [ ] Integrate autocomplete

### Phase 4: Advanced Features (Week 4)
- [ ] Add hover information
- [ ] Implement code actions
- [ ] Create performance optimizations
- [ ] Add configuration options

## Success Metrics

1. **Accuracy**: > 95% of syntax errors detected
2. **Performance**: < 50ms lint time for 1000-line files
3. **Suggestions**: > 90% relevant completion suggestions
4. **User Satisfaction**: Positive feedback on usability

## Dependencies

```json
{
  "@codemirror/lint": "^6.x",
  "@codemirror/autocomplete": "^6.x",
  "@codemirror/language": "^6.x",
  "@dbml/core": "^3.x"
}
```

## Key Implementation Notes

1. **Hybrid Parsing Strategy**: Uses StreamLanguage for syntax highlighting and @dbml/core for semantic validation
2. **Incremental Updates**: Caches parse results and schemas, only re-parsing on document changes
3. **Performance Optimizations**:
   - Debounced linting (300ms)
   - WeakMap caching for garbage collection
   - Parse result caching to avoid redundant parsing
4. **DBML-Specific Features**:
   - TablePartial support and merging
   - Circular reference detection
   - Schema-qualified table names
5. **Pattern-Based Context Detection**: Since we can't use syntaxTree with StreamLanguage, context is determined by text patterns

## References

- [DBML Official Documentation](https://dbml.dbdiagram.io/docs)
- [CodeMirror 6 Lint Documentation](https://codemirror.net/docs/ref/#lint)
- [CodeMirror 6 Autocomplete](https://codemirror.net/docs/ref/#autocomplete)
- [Lezer Parser System](https://lezer.codemirror.net/)