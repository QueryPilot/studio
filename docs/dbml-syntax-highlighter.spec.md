# DBML Syntax Highlighter Specification

## Overview
This document specifies the implementation of DBML (Database Markup Language) syntax highlighting for the CodeEditor component in Query Pilot. The implementation will be based on the official DBML specification from dbdiagram.io.

## Current State Analysis

### Existing Infrastructure
- **CodeEditor Component**: Located at `src/components/CodeEditor/`
- **Language Support**: Currently supports SQL (PostgreSQL, MySQL, SQLite), JSON, and text
- **Editor Framework**: CodeMirror 6 with @uiw/react-codemirror wrapper
- **Extension System**: Modular extension system in `extensions.ts`
- **Type Definition**: "dbml" already defined in `CodeEditorLanguage` type

### Gap Analysis
- No DBML language package exists for CodeMirror 6
- Official `@dbml/core` parser available but not integrated with CodeMirror
- Need custom Lezer grammar or stream parser implementation

## Implementation Approach

### Recommended Solution: Lezer Grammar Parser
Create a comprehensive Lezer grammar parser for full AST support, enabling advanced features like code folding, auto-indentation, and accurate syntax highlighting.

**Advantages:**
- Full AST support for structural awareness
- Incremental parsing for performance
- Error recovery for robust highlighting
- Enables advanced features (folding, smart indent)
- Future-proof for additional features

**Timeline:** 1-2 days

### Alternative: Stream Parser (Quick Start)
Implement a StreamLanguage parser for immediate basic highlighting.

**Advantages:**
- Quick implementation (2-3 hours)
- Lightweight solution
- Good enough for basic syntax highlighting

**Limitations:**
- No AST support
- Limited advanced features
- Less accurate parsing

## DBML Syntax Elements (Per Official Spec)

### 1. Keywords & Definitions

#### Primary Keywords
- `Project` - Project definition
- `Table` - Table definition
- `TablePartial` - Reusable table templates
- `TableGroup` - Table grouping
- `Enum` - Enum type definition
- `Ref` - Relationship/foreign key definition
- `Note` - Note blocks
- `indexes` - Index definition block

#### Column Constraints
- `primary key`, `pk` - Primary key constraint
- `unique` - Unique constraint
- `not null`, `null` - Nullability
- `increment` - Auto-increment
- `default` - Default value
- `note` - Column note

#### Relationship Operators
- `<` - One-to-many
- `>` - Many-to-one
- `-` - One-to-one
- `<>` - Many-to-many

### 2. Data Types
Support all single-word data types and complex expressions:
- Basic: `integer`, `varchar`, `text`, `boolean`, `timestamp`, `date`, `json`, `jsonb`
- Complex: `decimal(10,2)`, `varchar(255)`, custom types
- Expressions: Any valid database type expression

### 3. String & Identifier Rules

#### String Types
- **Single quotes** (`'string'`) - String values
- **Double quotes** (`"identifier"`) - Complex identifiers with spaces
- **Triple quotes** (`'''multiline'''`) - Multi-line strings
- **Backticks** (`` `expression` ``) - SQL expressions

#### Identifiers
- Plain text: `table_name`, `column_name`
- Schema qualified: `schema_name.table_name`
- Quoted: `"complex name with spaces"`

### 4. Comments
- Single-line: `//` comment
- Multi-line: `/* comment */`
- Inline notes: `note: 'comment'`

### 5. Settings Syntax
Settings use square brackets with key-value pairs:
```dbml
[setting1: value1, setting2: value2, keyword_setting]
```

Supported settings:
- Table: `headercolor: #3498DB`
- Column: `pk`, `unique`, `not null`, `default: value`, `increment`, `note: 'text'`
- Index: `type: btree`, `name: 'index_name'`, `unique`, `pk`
- Relationship: `delete: cascade`, `update: restrict`, `color: #79AD51`
- TableGroup: `color: #345`, `note: 'description'`

### 6. Special Syntax Elements

#### Index Definition
```dbml
indexes {
  column_name
  (column1, column2) [pk]
  column_name [unique, name: 'idx_name']
  (`expression`) [type: hash]
}
```

#### TablePartial (Template Injection)
```dbml
TablePartial base_fields {
  id int [pk]
  created_at timestamp
}

Table users {
  ~base_fields  // Injection syntax
  name varchar
}
```

#### Sticky Notes
```dbml
Note note_name {
  'Standalone note content'
}
```

## Grammar Implementation Structure

### File Organization
```
src/components/CodeEditor/
├── languages/
│   └── dbml/
│       ├── dbml.grammar       # Lezer grammar definition
│       ├── dbml-language.ts   # Language support configuration
│       ├── tokens.ts          # Token definitions
│       ├── highlighting.ts    # Syntax highlighting rules
│       └── folding.ts         # Code folding rules
```

### Lezer Grammar Structure (Simplified)

```lezer
@top Schema { element* }

element {
  ProjectDef |
  TableDef |
  TablePartialDef |
  TableGroupDef |
  EnumDef |
  RefDef |
  NoteDef
}

TableDef {
  kw<"Table"> QualifiedName Alias? "{"
    TableContent*
  "}"
}

TableContent {
  ColumnDef |
  IndexBlock |
  NoteStatement |
  PartialRef
}

ColumnDef {
  Identifier Type ColumnSettings?
}

ColumnSettings {
  "[" (Setting ("," Setting)*)? "]"
}

@tokens {
  Identifier { $[a-zA-Z_][a-zA-Z0-9_]* }
  QuotedIdentifier { '"' (!["\\] | "\\" _)* '"' }
  String { "'" (!['\] | "\\" _)* "'" }
  MultilineString { "'''" (!"'''" _)* "'''" }
  Expression { "`" (![\`\\] | "\\" _)* "`" }
  Number { $[0-9]+ ("." $[0-9]+)? }
  LineComment { "//" ![\n]* }
  BlockComment { "/*" ![*]* ("*" ![*/])* "*/" }

  kw<term> { @specialize[@name={term}]<Identifier, term> }
}

@precedence {
  LineComment,
  BlockComment,
  MultilineString,
  String
}
```

### Syntax Highlighting Tags

```typescript
import {styleTags, tags as t} from "@lezer/highlight"

const dbmlHighlighting = styleTags({
  // Keywords
  "Project Table TablePartial TableGroup Enum Ref Note indexes": t.keyword,

  // Types & Constraints
  "pk primary key unique not null increment default": t.modifier,

  // Data types
  "integer varchar text boolean timestamp date json jsonb": t.typeName,

  // Identifiers
  Identifier: t.variableName,
  QuotedIdentifier: t.propertyName,
  QualifiedName: t.namespace,

  // Strings & Values
  String: t.string,
  MultilineString: t.string,
  Expression: t.special(t.string),
  Number: t.number,
  Boolean: t.bool,

  // Comments
  LineComment: t.lineComment,
  BlockComment: t.blockComment,

  // Operators
  "< > - <>": t.operator,

  // Punctuation
  "{ } [ ] ( )": t.bracket,
  ":": t.punctuation,
  ",": t.separator
})
```

### Code Folding Support

```typescript
const dbmlFolding = foldService.of((state, from) => {
  // Fold blocks: Table, TablePartial, TableGroup, Enum, indexes
  // Multi-line Notes and Comments
  // Based on curly braces and triple quotes
})
```

## Integration Plan

### Phase 1: Basic Implementation (Day 1)
1. Create directory structure
2. Implement basic Lezer grammar
3. Add syntax highlighting
4. Integrate with CodeEditor

### Phase 2: Advanced Features (Day 2)
1. Add code folding support
2. Implement auto-indentation
3. Add bracket matching
4. Test with complex DBML files

### Phase 3: Optional Enhancements (Future)
1. Autocomplete support (keywords, table/column names)
2. Error diagnostics
3. Integration with @dbml/core for validation
4. Hover documentation

## Testing Strategy

### Test Cases
1. **Basic Syntax**: Tables, columns, types
2. **Complex Features**: TablePartial, indexes, relationships
3. **Edge Cases**: Multi-line strings, nested comments, expressions
4. **Performance**: Large DBML files (1000+ lines)
5. **Error Recovery**: Incomplete syntax, syntax errors

### Sample Test File
```dbml
// Test all DBML features
Project test_db {
  database_type: 'PostgreSQL'
  Note: '''
    Multi-line project note
    Testing all features
  '''
}

TablePartial timestamps {
  created_at timestamp [default: `now()`]
  updated_at timestamp
}

Table public.users [headercolor: #3498DB] {
  ~timestamps
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  profile_id integer [ref: - profiles.id]

  indexes {
    email [unique, name: 'idx_users_email']
    (email, created_at)
  }

  Note: 'User accounts table'
}

Enum status {
  'active'
  'inactive'
  'suspended'
}

Ref: posts.author_id > users.id [delete: cascade]
```

## Success Criteria
1. ✅ Accurate syntax highlighting for all DBML elements
2. ✅ Performance: <50ms parse time for 1000-line files
3. ✅ Error recovery: Highlighting continues despite syntax errors
4. ✅ Code folding for blocks (Table, Enum, indexes, etc.)
5. ✅ Proper handling of all string types and comments
6. ✅ Schema-qualified identifiers highlighted correctly

## Dependencies
- `@lezer/generator` - Grammar compilation
- `@lezer/lr` - LR parser runtime
- `@lezer/highlight` - Syntax highlighting
- `@codemirror/language` - Language support

## References
- [Official DBML Documentation](https://dbml.dbdiagram.io/docs)
- [Lezer Documentation](https://lezer.codemirror.net/)
- [CodeMirror Language Package Example](https://codemirror.net/examples/lang-package/)
- [@dbml/core NPM Package](https://www.npmjs.com/package/@dbml/core)