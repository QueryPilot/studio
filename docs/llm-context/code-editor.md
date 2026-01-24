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
│   │   ├── linter-strategy.ts       # Unified dialect linter
│   │   ├── pg-parser-linter.ts      # PostgreSQL WASM parser
│   │   ├── linter-worker-manager.ts # Worker pool
│   │   ├── metadataProvider.ts      # Schema metadata
│   │   └── dialect-validators/      # Dialect-specific validators
│   └── dbml/                # DBML language for ERD
```

## Multi-Dialect Linting

Different strategies per dialect:

| Dialect | Linter | Notes |
|---------|--------|-------|
| PostgreSQL | `pg-parser` WASM | 100% compatibility, including PL/pgSQL |
| MySQL | Web Worker | Non-blocking validation |
| SQLite | Web Worker | Non-blocking validation |
| MSSQL | Web Worker | Non-blocking validation |

**Worker isolation**: CPU-intensive validation runs in Web Workers to prevent UI freezing.

## Smart SQL Features

- **Context-aware autocomplete**: Table/column suggestions from active connection
- **Real-time semantic linting**: Validates against actual schema
- **Hover tooltips**: Table/column information on hover
- **Symbol table tracking**: CTE and subquery reference resolution

## Key Components

| File | Purpose |
|------|---------|
| `context.ts` | SQL context analyzer - determines cursor position context |
| `completion.ts` | Autocomplete provider with schema awareness |
| `linter-strategy.ts` | Unified interface for dialect linters |
| `metadataProvider.ts` | Bridges schema metadata to editor features |

## DBML Support

Separate language support in `languages/dbml/` for Entity Relationship Diagram editing.

## Adding Dialect Support

1. Create validator in `dialect-validators/`
2. Implement linter strategy in `linter-strategy.ts`
3. Register in the dialect detection logic
4. Add Web Worker if needed for non-blocking validation
