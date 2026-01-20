# MongoDB IntelliShell Design

## Overview

Build a MongoDB shell-style query editor with full IntelliShell experience including autocomplete, syntax validation, method chaining, and parameter hints.

## User Request

Replace the current JSON-based MongoDB query panel with a shell-style syntax (`db.collection.method()`) similar to Studio 3T, NoSQLBooster, and DataGrip, while keeping JSON mode as a toggle option.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| JavaScript execution | Parser-based (no eval) | Safer, no sandbox needed, predictable |
| Editor mode | Toggle (Shell/JSON) | Accommodates both preferences |
| Method chaining | Comprehensive | Cover all cursor methods |
| Field autocomplete | Hybrid (cache + sample) | Fast when cached, fresh when needed |
| Editor integration | Extend JavaScript mode | Leverage existing syntax highlighting |
| MongoDB packages | Apache-2.0 only | Avoid SSPL restrictions |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MongoQueryPanel                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  CodeEditor (CodeMirror 6 + JavaScript mode)        │   │
│  │  + MongoShellExtension                              │   │
│  │    - Autocomplete (fields, operators, methods)      │   │
│  │    - Syntax validation (real-time linting)          │   │
│  │    - Method signature hints                         │   │
│  │                                                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  Toolbar: [Run] [Format] [Clear]      [Shell | JSON]│   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Results Panel (JSON viewer)                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Shell Parser

### Supported Syntax

```javascript
// Simple find
db.users.find({ age: { $gt: 18 } })

// Method chaining
db.orders.find({ status: "active" }).sort({ created: -1 }).limit(20).skip(10)

// Aggregation
db.products.aggregate([
  { $match: { category: "electronics" } },
  { $group: { _id: "$brand", total: { $sum: 1 } } }
])

// CRUD operations
db.users.insertOne({ name: "John", email: "john@example.com" })
db.users.updateOne({ _id: ObjectId("...") }, { $set: { name: "Jane" } })
db.users.deleteMany({ status: "inactive" })
```

### Parser Output

```typescript
interface ParsedShellCommand {
  collection: string;
  method: 'find' | 'findOne' | 'aggregate' | 'insertOne' | 'insertMany' | 
          'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 
          'countDocuments' | 'distinct' | 'createIndex' | 'dropIndex';
  args: unknown[];
  options: {
    limit?: number;
    skip?: number;
    sort?: object;
    projection?: object;
    hint?: object;
    maxTimeMS?: number;
    explain?: boolean;
  };
}
```

### Supported Chain Methods

| Method | Example | Purpose |
|--------|---------|---------|
| `.limit(n)` | `.limit(20)` | Limit results |
| `.skip(n)` | `.skip(10)` | Skip results |
| `.sort({...})` | `.sort({ name: 1 })` | Sort order |
| `.projection({...})` | `.projection({ name: 1 })` | Field selection |
| `.count()` | `.count()` | Return count |
| `.explain()` | `.explain()` | Execution plan |
| `.hint({...})` | `.hint({ idx: 1 })` | Index hint |
| `.maxTimeMS(n)` | `.maxTimeMS(5000)` | Timeout |
| `.toArray()` | `.toArray()` | Explicit array |

## Auto-completion System

### Completion Triggers

| Context | Trigger | Suggestions |
|---------|---------|-------------|
| After `db.` | `db.` | Collection names |
| After `db.collection.` | `.` | Methods: `find`, `aggregate`, etc. |
| Inside `find({` | `{` | Field names |
| Inside `{ $` | `$` | Query operators: `$eq`, `$gt`, etc. |
| Inside `aggregate([{ $` | `$` | Stage operators: `$match`, `$group`, etc. |
| After `.find().` | `.` | Cursor methods: `limit`, `skip`, etc. |
| Inside `$group: { $` | `$` | Accumulators: `$sum`, `$avg`, etc. |

### Data Sources

1. **Collections** - From existing introspection service
2. **Fields** - Hybrid: cached from sidebar + sample on demand (100 docs)
3. **Operators** - From `@mongodb-js/mongodb-constants`

## Syntax Validation

### Linting Layers

| Layer | What it catches | Example |
|-------|-----------------|---------|
| JavaScript syntax | Invalid JS | `db.users.find({ name: }` |
| BSON parsing | Invalid BSON types | `ObjectId("not-valid")` |
| Shell pattern | Missing `db.` prefix | `users.find({})` |
| Method validation | Unknown methods | `db.users.findAll({})` |
| Operator validation | Invalid operators | `{ $invalid: 1 }` |
| Chain validation | Invalid chaining | `.find().insert()` |

### Error Display

- Red squiggly underline on error location
- Hover tooltip shows error message
- Error summary in gutter

## Method Signature Hints

```javascript
db.users.find(|
              ↓
┌─────────────────────────────────────────────────────────┐
│ find(filter?: object, projection?: object)              │
│                                                         │
│ filter     - Query filter document                      │
│ projection - Fields to include/exclude                  │
└─────────────────────────────────────────────────────────┘
```

### Signatures

| Method | Signature |
|--------|-----------|
| `find` | `(filter?, projection?)` |
| `findOne` | `(filter?, projection?)` |
| `aggregate` | `(pipeline[])` |
| `insertOne` | `(document)` |
| `insertMany` | `(documents[])` |
| `updateOne` | `(filter, update, options?)` |
| `updateMany` | `(filter, update, options?)` |
| `deleteOne` | `(filter)` |
| `deleteMany` | `(filter)` |
| `countDocuments` | `(filter?)` |
| `distinct` | `(field, filter?)` |

## Mode Toggle (Shell ↔ JSON)

### Conversion

```javascript
// Shell mode:
db.users.find({ age: { $gt: 18 } }).sort({ name: 1 }).limit(20)

// Converts to JSON mode:
{
  "find": "users",
  "filter": { "age": { "$gt": 18 } },
  "sort": { "name": 1 },
  "limit": 20
}
```

### Behavior

- Auto-detect mode on paste
- Persist mode preference per tab
- Graceful fallback if conversion fails

## File Structure

```
src/components/MongoQueryPanel/
├── MongoQueryPanel.tsx          # Update - add mode toggle
├── MongoQueryToolbar.tsx        # Update - add mode toggle button
├── parser/
│   ├── index.ts                 # Main parser exports
│   ├── shell-parser.ts          # Parse db.collection.method() syntax
│   ├── chain-parser.ts          # Parse method chains
│   └── types.ts                 # ParsedShellCommand, etc.
├── intellisense/
│   ├── index.ts                 # Main intellisense exports
│   ├── completions.ts           # Completion provider
│   ├── field-cache.ts           # Field name caching
│   ├── signatures.ts            # Method signature definitions
│   └── operators.ts             # Wrapper around mongodb-constants
└── converter.ts                 # Shell ↔ JSON conversion

src/components/CodeEditor/languages/mongodb/
├── index.ts                     # Language registration
├── linter.ts                    # Real-time validation
├── completion.ts                # CodeMirror autocomplete integration
├── hints.ts                     # Parameter hints extension
└── highlight.ts                 # Custom decorations
```

## Dependencies

```bash
pnpm add @mongodb-js/shell-bson-parser mongodb-query-parser @mongodb-js/mongodb-constants
```

All Apache-2.0 licensed (avoiding SSPL).

## Implementation Phases

| Phase | Scope | Priority |
|-------|-------|----------|
| 1 | Parser + basic execution | Core |
| 2 | Autocomplete (collections, methods, operators) | High |
| 3 | Field completion (sample + cache) | Medium |
| 4 | Linting + error detection | Polish |
| 5 | Method signatures + hints | Polish |
| 6 | Mode toggle + conversion | Complete |

## Research Notes

### Existing Tools Analysis

| Tool | Approach |
|------|----------|
| MongoDB Compass | JSON filter only (no shell syntax) |
| Studio 3T | Full shell + Visual Builder + SQL |
| NoSQLBooster | Embedded V8, full JS execution |
| DataGrip | Full mongosh compatibility |
| Robo 3T | Shell with autocomplete |

### MongoDB Compass Packages (Apache-2.0)

- `@mongodb-js/shell-bson-parser` - Parse BSON types
- `mongodb-query-parser` - Parse queries from shell syntax
- `@mongodb-js/mongodb-constants` - Operators, stages, accumulators
- `mongodb-schema` - Schema inference for field names
