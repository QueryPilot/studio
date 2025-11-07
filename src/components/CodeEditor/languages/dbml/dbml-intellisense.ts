import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
  snippetCompletion,
  autocompletion
} from "@codemirror/autocomplete";
import { type Extension, type Text } from "@codemirror/state";
import { DBMLValidator } from "./dbml-validator";
import { DBMLSchema } from "./dbml-schema";

export class DBMLIntelliSense {
  private schemaCache = new WeakMap<Text, DBMLSchema>();
  private validator: DBMLValidator;

  constructor() {
    this.validator = new DBMLValidator();
  }

  getCompletions(context: CompletionContext): CompletionResult | null {
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

    // Determine context and get completions
    const completions = this.getContextualCompletions(
      textBefore,
      textAfter,
      schema,
      context
    );

    if (!completions.length) return null;

    const word = context.matchBefore(/[\w.]*/) || { from: pos, to: pos };

    return {
      from: word.from,
      to: word.to,
      options: completions,
      validFor: /^[\w.]*$/
    };
  }

  private buildSchemaFromDoc(doc: Text): DBMLSchema {
    const parseResult = this.validator.parse(doc);
    if (parseResult.success && parseResult.ast) {
      return DBMLSchema.fromAST(parseResult.ast, doc);
    }
    return new DBMLSchema();
  }

  private getContextualCompletions(
    textBefore: string,
    textAfter: string,
    schema: DBMLSchema,
    context: CompletionContext
  ): Completion[] {
    const trimmedBefore = textBefore.trim();
    const lastWord = trimmedBefore.split(/\s+/).pop() || '';

    // Top-level completions
    if (trimmedBefore === '' || trimmedBefore.match(/^}.*$/)) {
      return this.getTopLevelCompletions();
    }

    // Inside table block
    if (this.isInsideTableBlock(context.state.doc, context.pos)) {
      return this.getTableContentCompletions(schema);
    }

    // Inside indexes block
    if (this.isInsideIndexesBlock(textBefore)) {
      return this.getIndexCompletions(schema, context);
    }

    // Column settings (inside square brackets)
    if (this.isInsideSettings(textBefore, textAfter)) {
      return this.getSettingsCompletions(textBefore);
    }

    // Relationship completions
    if (trimmedBefore.startsWith('Ref:') || trimmedBefore.includes('ref:')) {
      return this.getRelationshipCompletions(schema, textBefore);
    }

    // After a dot (table.column completion)
    if (lastWord.includes('.')) {
      const [tableName] = lastWord.split('.');
      if (tableName) {
        return this.getColumnCompletions(schema, tableName);
      }
      return [];
    }

    // Enum value completions
    if (this.isInsideEnumBlock(context.state.doc, context.pos)) {
      return this.getEnumValueCompletions();
    }

    // Data type completions
    if (this.mightBeTypingDataType(textBefore)) {
      return this.getDataTypeCompletions();
    }

    return [];
  }

  private getTopLevelCompletions(): Completion[] {
    return [
      snippetCompletion("Table ${1:table_name} {\n  id integer [pk, increment]\n  $2\n}", {
        label: "Table",
        type: "keyword",
        detail: "Create a new table",
        boost: 10
      }),
      snippetCompletion("Enum ${1:enum_name} {\n  ${2:value1}\n  ${3:value2}\n}", {
        label: "Enum",
        type: "keyword",
        detail: "Create an enum type",
        boost: 8
      }),
      snippetCompletion("Ref: ${1:from_table}.${2:from_col} > ${3:to_table}.${4:to_col}", {
        label: "Ref",
        type: "keyword",
        detail: "Define a relationship",
        boost: 7
      }),
      snippetCompletion("TableGroup ${1:group_name} {\n  ${2:table1}\n  ${3:table2}\n}", {
        label: "TableGroup",
        type: "keyword",
        detail: "Group related tables",
        boost: 5
      }),
      snippetCompletion("Project ${1:project_name} {\n  database_type: '${2:PostgreSQL}'\n  Note: '$3'\n}", {
        label: "Project",
        type: "keyword",
        detail: "Define project metadata",
        boost: 9
      }),
      snippetCompletion("Note ${1:note_name} {\n  '${2:content}'\n}", {
        label: "Note",
        type: "keyword",
        detail: "Add a sticky note",
        boost: 3
      }),
      snippetCompletion("TablePartial ${1:table_name} {\n  $2\n}", {
        label: "TablePartial",
        type: "keyword",
        detail: "Extend an existing table",
        boost: 6
      })
    ];
  }

  private getTableContentCompletions(_schema: DBMLSchema): Completion[] {
    const completions: Completion[] = [];

    // Common column patterns
    completions.push(
      snippetCompletion("id integer [pk, increment]", {
        label: "id (auto)",
        type: "property",
        detail: "Primary key with auto-increment",
        boost: 20
      }),
      snippetCompletion("created_at timestamp [default: `now()`]", {
        label: "created_at",
        type: "property",
        detail: "Creation timestamp",
        boost: 18
      }),
      snippetCompletion("updated_at timestamp [default: `now()`]", {
        label: "updated_at",
        type: "property",
        detail: "Update timestamp",
        boost: 17
      }),
      snippetCompletion("${1:name} varchar(${2:255}) [not null]", {
        label: "string column",
        type: "property",
        detail: "String column with length",
        boost: 15
      }),
      snippetCompletion("${1:user_id} integer [ref: > ${2:users}.id]", {
        label: "foreign key",
        type: "property",
        detail: "Foreign key column",
        boost: 14
      }),
      snippetCompletion("is_${1:active} boolean [default: ${2:true}]", {
        label: "boolean flag",
        type: "property",
        detail: "Boolean column with default",
        boost: 13
      }),
      snippetCompletion("indexes {\n    ${1:column_name}\n  }", {
        label: "indexes",
        type: "keyword",
        detail: "Define indexes",
        boost: 12
      }),
      snippetCompletion("Note: '${1:description}'", {
        label: "Note",
        type: "keyword",
        detail: "Add table note",
        boost: 8
      })
    );

    // Data types
    this.getDataTypeCompletions().forEach(type => {
      completions.push(type);
    });

    return completions;
  }

  private getDataTypeCompletions(): Completion[] {
    const types = [
      // Numeric types
      { label: "integer", detail: "32-bit integer" },
      { label: "bigint", detail: "64-bit integer" },
      { label: "smallint", detail: "16-bit integer" },
      { label: "decimal", detail: "Exact decimal" },
      { label: "numeric", detail: "Exact numeric" },
      { label: "real", detail: "Single precision float" },
      { label: "double precision", detail: "Double precision float" },
      { label: "serial", detail: "Auto-incrementing integer" },
      { label: "bigserial", detail: "Auto-incrementing bigint" },

      // String types
      { label: "varchar", detail: "Variable length string" },
      { label: "char", detail: "Fixed length string" },
      { label: "text", detail: "Unlimited text" },

      // Date/Time types
      { label: "timestamp", detail: "Date and time" },
      { label: "timestamptz", detail: "Timestamp with timezone" },
      { label: "date", detail: "Date only" },
      { label: "time", detail: "Time only" },
      { label: "interval", detail: "Time interval" },

      // Boolean
      { label: "boolean", detail: "True/False" },
      { label: "bool", detail: "Boolean alias" },

      // JSON types
      { label: "json", detail: "JSON data" },
      { label: "jsonb", detail: "Binary JSON" },

      // Other types
      { label: "uuid", detail: "UUID type" },
      { label: "xml", detail: "XML data" },
      { label: "bytea", detail: "Binary data" },
      { label: "array", detail: "Array type" }
    ];

    return types.map(type => ({
      label: type.label,
      type: "type",
      detail: type.detail,
      boost: 5
    }));
  }

  private getSettingsCompletions(textBefore: string): Completion[] {
    const completions: Completion[] = [];

    // Column settings
    if (!textBefore.includes('indexes')) {
      completions.push(
        { label: "pk", type: "keyword", detail: "Primary key", boost: 20 },
        { label: "primary key", type: "keyword", detail: "Primary key", boost: 19 },
        { label: "unique", type: "keyword", detail: "Unique constraint", boost: 18 },
        { label: "not null", type: "keyword", detail: "Not null constraint", boost: 17 },
        { label: "null", type: "keyword", detail: "Nullable", boost: 16 },
        { label: "increment", type: "keyword", detail: "Auto-increment", boost: 15 },
        snippetCompletion("default: ${1:value}", {
          label: "default",
          type: "keyword",
          detail: "Default value",
          boost: 14
        }),
        snippetCompletion("default: `${1:now()}`", {
          label: "default (SQL)",
          type: "keyword",
          detail: "SQL expression default",
          boost: 13
        }),
        snippetCompletion("note: '${1:description}'", {
          label: "note",
          type: "keyword",
          detail: "Column note",
          boost: 12
        }),
        snippetCompletion("ref: > ${1:table}.${2:column}", {
          label: "ref (many-to-one)",
          type: "keyword",
          detail: "Foreign key reference",
          boost: 11
        }),
        snippetCompletion("ref: < ${1:table}.${2:column}", {
          label: "ref (one-to-many)",
          type: "keyword",
          detail: "Reverse reference",
          boost: 10
        }),
        snippetCompletion("ref: - ${1:table}.${2:column}", {
          label: "ref (one-to-one)",
          type: "keyword",
          detail: "One-to-one reference",
          boost: 9
        })
      );
    }

    // Table settings
    if (textBefore.match(/Table\s+\w+\s*\[/)) {
      completions.push(
        snippetCompletion("headercolor: #${1:3498DB}", {
          label: "headercolor",
          type: "keyword",
          detail: "Table header color",
          boost: 10
        })
      );
    }

    // Ref settings
    if (textBefore.includes('Ref')) {
      completions.push(
        { label: "delete: cascade", type: "keyword", detail: "Cascade delete", boost: 10 },
        { label: "delete: restrict", type: "keyword", detail: "Restrict delete", boost: 9 },
        { label: "delete: set null", type: "keyword", detail: "Set null on delete", boost: 8 },
        { label: "delete: set default", type: "keyword", detail: "Set default on delete", boost: 7 },
        { label: "delete: no action", type: "keyword", detail: "No action on delete", boost: 6 },
        { label: "update: cascade", type: "keyword", detail: "Cascade update", boost: 10 },
        { label: "update: restrict", type: "keyword", detail: "Restrict update", boost: 9 },
        { label: "update: set null", type: "keyword", detail: "Set null on update", boost: 8 },
        { label: "update: set default", type: "keyword", detail: "Set default on update", boost: 7 },
        { label: "update: no action", type: "keyword", detail: "No action on update", boost: 6 }
      );
    }

    return completions;
  }

  private getRelationshipCompletions(schema: DBMLSchema, textBefore: string): Completion[] {
    const completions: Completion[] = [];

    // Determine position in relationship
    const parts = textBefore.split(/[><-]/);
    const isTypingFrom = parts.length === 1;
    const isTypingOperator = textBefore.match(/\.\w+\s*$/);
    const isTypingTo = parts.length === 2;

    if (isTypingOperator) {
      // Relationship operators
      return [
        { label: ">", type: "operator", detail: "many-to-one", boost: 10 },
        { label: "<", type: "operator", detail: "one-to-many", boost: 9 },
        { label: "-", type: "operator", detail: "one-to-one", boost: 8 },
        { label: "<>", type: "operator", detail: "many-to-many", boost: 7 }
      ];
    }

    // Table suggestions
    const tables = schema.getAllTableNames();
    for (const tableName of tables) {
      const table = schema.getTable(tableName);
      if (table) {
        completions.push({
          label: tableName,
          type: "type",
          detail: `Table (${table.columns.size} columns)`,
          boost: 20
        });

        // Also suggest table.column combinations
        if (isTypingFrom || isTypingTo) {
          for (const colName of table.columns.keys()) {
            const col = table.columns.get(colName);
            if (col) {
              completions.push({
                label: `${tableName}.${colName}`,
                type: "property",
                detail: col.type,
                boost: 15
              });
            }
          }
        }
      }
    }

    return completions;
  }

  private getColumnCompletions(schema: DBMLSchema, tableName: string): Completion[] {
    const completions: Completion[] = [];
    const table = schema.getTable(tableName);

    if (table) {
      for (const [colName, col] of table.columns) {
        completions.push({
          label: colName,
          type: "property",
          detail: `${col.type}${col.pk ? ' (PK)' : ''}${col.unique ? ' (unique)' : ''}`,
          boost: col.pk ? 20 : 10
        });
      }
    }

    return completions;
  }

  private getIndexCompletions(schema: DBMLSchema, context: CompletionContext): Completion[] {
    const completions: Completion[] = [];

    // Find the parent table
    const tableName = this.findParentTableName(context.state.doc, context.pos);
    if (tableName) {
      const table = schema.getTable(tableName);
      if (table) {
        // Suggest columns from the table
        for (const colName of table.columns.keys()) {
          completions.push({
            label: colName,
            type: "property",
            detail: "Column index",
            boost: 10
          });
        }

        // Composite index
        completions.push(
          snippetCompletion("(${1:col1}, ${2:col2})", {
            label: "(composite)",
            type: "keyword",
            detail: "Composite index",
            boost: 8
          }),
          snippetCompletion("${1:column} [unique]", {
            label: "unique index",
            type: "keyword",
            detail: "Unique index",
            boost: 7
          }),
          snippetCompletion("${1:column} [type: ${2:hash}]", {
            label: "typed index",
            type: "keyword",
            detail: "Index with type",
            boost: 6
          }),
          snippetCompletion("(${1:col1}, ${2:col2}) [pk]", {
            label: "composite pk",
            type: "keyword",
            detail: "Composite primary key",
            boost: 9
          })
        );
      }
    }

    return completions;
  }

  private getEnumValueCompletions(): Completion[] {
    return [
      snippetCompletion("${1:value} [note: '${2:description}']", {
        label: "value with note",
        type: "property",
        detail: "Enum value with note",
        boost: 10
      }),
      { label: "active", type: "property", detail: "Common enum value", boost: 5 },
      { label: "inactive", type: "property", detail: "Common enum value", boost: 5 },
      { label: "pending", type: "property", detail: "Common enum value", boost: 5 },
      { label: "approved", type: "property", detail: "Common enum value", boost: 5 },
      { label: "rejected", type: "property", detail: "Common enum value", boost: 5 },
      { label: "draft", type: "property", detail: "Common enum value", boost: 5 },
      { label: "published", type: "property", detail: "Common enum value", boost: 5 }
    ];
  }

  private isInsideTableBlock(doc: Text, pos: number): boolean {
    const text = doc.toString().slice(0, pos);
    let braceCount = 0;
    let inTable = false;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^(Table|TablePartial)\s+\w+.*\{/)) {
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

    return inTable && braceCount > 0;
  }

  private isInsideEnumBlock(doc: Text, pos: number): boolean {
    const text = doc.toString().slice(0, pos);
    let braceCount = 0;
    let inEnum = false;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^Enum\s+\w+.*\{/)) {
        inEnum = true;
        braceCount = 1;
      } else if (inEnum) {
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) inEnum = false;
          }
        }
      }
    }

    return inEnum && braceCount > 0;
  }

  private isInsideIndexesBlock(textBefore: string): boolean {
    const lastIndexes = textBefore.lastIndexOf('indexes {');
    if (lastIndexes === -1) return false;

    const afterIndexes = textBefore.slice(lastIndexes);
    const openBraces = (afterIndexes.match(/\{/g) || []).length;
    const closeBraces = (afterIndexes.match(/\}/g) || []).length;

    return openBraces > closeBraces;
  }

  private isInsideSettings(textBefore: string, textAfter: string): boolean {
    const lastOpen = textBefore.lastIndexOf('[');
    const lastClose = textBefore.lastIndexOf(']');
    const nextClose = textAfter.indexOf(']');

    return lastOpen > lastClose && nextClose !== -1;
  }

  private mightBeTypingDataType(textBefore: string): boolean {
    // Check if we're after a column name but before settings
    return textBefore.match(/^\s*\w+\s+\w*$/) !== null &&
           !textBefore.includes('[') &&
           !textBefore.includes('{');
  }

  private findParentTableName(doc: Text, pos: number): string | undefined {
    const text = doc.toString().slice(0, pos);
    const tableMatch = text.match(/(?:^|\n)\s*Table\s+(\w+)[^{]*\{[^}]*$/);
    return tableMatch ? tableMatch[1] : undefined;
  }

  invalidateCache(doc: Text) {
    this.schemaCache.delete(doc);
    this.validator.invalidateCache(doc);
  }
}

// Create the IntelliSense extension
export function dbmlCompletions(): Extension {
  const intelliSense = new DBMLIntelliSense();

  return autocompletion({
    override: [(context) => intelliSense.getCompletions(context)],
    activateOnTyping: true,
    maxRenderedOptions: 50,
    defaultKeymap: true,
    tooltipClass: () => "dbml-autocomplete"
  });
}