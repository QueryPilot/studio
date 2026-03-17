# Code Editor

## Overview

Query Pilot uses CodeMirror 6 for SQL editing with dialect-specific features.

## Architecture

```
src/components/CodeEditor/
├── core/                    # Core editor logic
├── languages/
│   ├── sql/                 # SQL language support
│   │   ├── context.ts       # SQL context analyzer (the "Brain")
│   │   ├── completion.ts    # Intelligent autocomplete
│   │   ├── linter-strategy.ts       # Two-stage dialect linter entrypoint
│   │   ├── unified-linter.ts        # Fast pass + deferred semantic pass
│   │   ├── dialect-lint-adapter.ts  # Canonical SQL + offset remapping
│   │   ├── metadataProvider.ts      # Schema metadata
│   │   └── dialect-validators/      # Dialect-specific validators
├── services/
│   └── linter-coordinator.ts # Deduped semantic IPC batching + cache
└── languages/dbml/           # DBML language for ERD
```

## Multi-Dialect Linting

All SQL dialects now use the same two-stage CodeMirror pipeline:

1. **Fast pass**: local token-aware checks in the editor for cheap feedback (`SELECT *`, invalid `*`, keyword typos, destructive updates/deletes without `WHERE`).
2. **Semantic pass**: deferred Rust `sql_validate` call with schema-aware validation and nested-query traversal.

For PostgreSQL, the dialect adapter canonicalizes parser-hostile but semantics-preserving syntax before the Rust pass. Current examples include `EXPLAIN ANALYSE ...` normalization to `EXPLAIN ANALYZE ...`.

Semantic diagnostics are computed against canonical SQL and then remapped back to raw editor offsets before display.

## Smart SQL Features

- **Context-aware autocomplete**: Table/column suggestions from active connection
- **Real-time semantic linting**: Validates against actual schema
- **Fast local diagnostics**: Cheap lint rules stay responsive while typing
- **Hover tooltips**: Table/column information on hover
- **Symbol table tracking**: CTE, `EXPLAIN`, and nested subquery reference resolution

## Key Components

| File | Purpose |
|------|---------|
| `context.ts` | SQL context analyzer - determines cursor position context |
| `completion.ts` | Autocomplete provider with schema awareness |
| `linter-strategy.ts` | Public dialect linter entrypoint returning fast + semantic extensions |
| `unified-linter.ts` | CodeMirror lint sources for fast pass and semantic pass |
| `dialect-lint-adapter.ts` | Canonical SQL preparation, offset mapping, and fast diagnostics |
| `linter-coordinator.ts` | Semantic-only IPC batching, caching, and schema sync |
| `metadataProvider.ts` | Bridges schema metadata to editor features |

## DBML Support

Separate language support in `languages/dbml/` for Entity Relationship Diagram editing.

## Adding Dialect Support

1. Create validator in `dialect-validators/`
2. Implement linter strategy in `linter-strategy.ts`
3. Register in the dialect detection logic
4. Add any dialect-specific canonicalization to `dialect-lint-adapter.ts`
