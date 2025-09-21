# DBML Syntax Highlighting Support

## Current Implementation Status

The DBML syntax highlighter for CodeEditor is implemented using CodeMirror's StreamLanguage parser. This provides good syntax highlighting coverage for all major DBML features.

## ✅ Fully Supported Features

### 1. **Core Definitions**
- ✅ `Project` definition with settings
- ✅ `Table` definition (with schema qualification)
- ✅ `TablePartial` for reusable fields
- ✅ `TableGroup` for organizing tables
- ✅ `Enum` definitions (schema-qualified)
- ✅ `Ref` relationships (all forms)
- ✅ `Note` blocks (standalone and inline)

### 2. **Table Features**
- ✅ Schema-qualified tables (`schema.table`)
- ✅ Table aliases (`Table long_name as alias`)
- ✅ Table settings (`[headercolor: #color]`)
- ✅ Partial injection (`~partial_name`)
- ✅ Column definitions with all constraints
- ✅ Quoted identifiers (`"column name"`)
- ✅ Index blocks with expressions

### 3. **Column Constraints**
- ✅ `pk` / `primary key`
- ✅ `unique`
- ✅ `not null` / `null`
- ✅ `increment`
- ✅ `default: value`
- ✅ `note: 'description'`
- ✅ Inline references (`ref: > table.column`)

### 4. **Data Types**
All common SQL data types including:
- ✅ PostgreSQL: integer, varchar, text, boolean, timestamp, json, jsonb, uuid, serial, etc.
- ✅ MySQL: tinyint, mediumint, tinytext, mediumtext, longtext, blob variants
- ✅ Generic: decimal, numeric, float, double, date, time, datetime
- ✅ Special: money, inet, cidr, xml, array, hstore, geometric types

### 5. **Relationships**
- ✅ One-to-many (`>`)
- ✅ Many-to-one (`<`)
- ✅ One-to-one (`-`)
- ✅ Many-to-many (`<>`)
- ✅ Composite foreign keys
- ✅ Cross-schema references
- ✅ Relationship settings (cascade, restrict, colors)

### 6. **String Types**
- ✅ Single quotes (`'string'`)
- ✅ Double quotes (`"identifier"`)
- ✅ Triple quotes (`'''multiline'''`)
- ✅ Backticks for expressions (`` `now()` ``)
- ✅ Escape sequences

### 7. **Comments**
- ✅ Single-line comments (`//`)
- ✅ Multi-line comments (`/* */`)
- ✅ Inline notes

### 8. **Special Features**
- ✅ Color codes (`#RRGGBB`)
- ✅ Numbers (integers, decimals, negative)
- ✅ Booleans (`true`, `false`, `null`)
- ✅ Index expressions
- ✅ Default value expressions

### 9. **Index Features**
- ✅ Single column indexes
- ✅ Composite indexes
- ✅ Expression-based indexes
- ✅ Index settings (type, name, unique)

### 10. **Settings & Modifiers**
- ✅ Table settings (headercolor)
- ✅ TableGroup settings (color, note)
- ✅ Relationship settings (delete/update actions, color)
- ✅ Index settings (type: btree/hash, name, unique)

## ⚠️ Limitations

### Current Parser Limitations
1. **No Code Folding**: StreamLanguage doesn't support automatic code folding for blocks
2. **No Auto-indentation**: Basic indentation only, no smart indent
3. **No Error Detection**: No syntax error highlighting
4. **No Autocomplete**: No built-in DBML-aware autocomplete
5. **Simple Token Matching**: Regex-based, not full AST parsing

### Syntax Edge Cases
1. **Nested Comments**: Nested block comments may not highlight correctly
2. **Complex Expressions**: Very complex SQL expressions in backticks may not fully parse
3. **Custom Types**: User-defined types might be highlighted as identifiers instead of types
4. **Case Sensitivity**: Keywords are case-insensitive (DBML spec says they should be case-sensitive)

## 🚀 Future Enhancements

### Phase 1: Lezer Grammar (Recommended)
- Full AST parsing for better accuracy
- Code folding support
- Smart indentation
- Error recovery
- Faster incremental parsing

### Phase 2: Advanced Features
- DBML-aware autocomplete
- Syntax validation using @dbml/core
- Hover documentation
- Go-to definition for tables/columns
- Refactoring support

### Phase 3: Integration
- Live DBML to SQL conversion
- Visual diagram preview
- Schema validation
- Import/export features

## Usage

```tsx
import { CodeEditor } from "@/components/CodeEditor";

function DBMLEditor() {
  return (
    <CodeEditor
      value={dbmlCode}
      onChange={handleChange}
      language="dbml"  // ← Enable DBML highlighting
      theme="auto"
      lineNumbers={true}
    />
  );
}
```

## Testing

Test file available at: `src/components/CodeEditor/languages/dbml/test-coverage.dbml`

This file contains comprehensive examples of all DBML features to verify syntax highlighting.

## Performance

- **Parsing Speed**: Fast (regex-based streaming)
- **File Size Limit**: No practical limit (streaming parser)
- **Memory Usage**: Low (no full AST in memory)
- **Incremental Updates**: Partial (line-by-line reparsing)