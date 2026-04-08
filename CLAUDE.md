# CLAUDE.md

Query Pilot is a local-first desktop database IDE built with Tauri 2 + React 19 + Rust.

## Quick Reference

| Task | Command |
|------|---------|
| Dev server | `make dev` |
| Lint (frontend) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Lint (backend) | `cargo clippy` (in src-tauri/) |
| Test all | `make test` |
| Test frontend | `pnpm test:unit` |
| Test backend | `make test-backend` |
| Test single (frontend) | `pnpm vitest run src/path/to/file.test.ts` |
| Test single (backend) | `cd src-tauri && cargo test test_name` |
| Test watch | `pnpm test:watch` |
| Format check (backend) | `cd src-tauri && cargo fmt -- --check` |
| Dev databases up | `make docker-up` |
| Dev databases down | `make docker-down` |
| First-time setup | `make setup` |

**Package manager**: `pnpm`

## Architecture at a Glance

```
Frontend (src/)           Backend (src-tauri/src/)
├── React 19 + TS         ├── Rust + Tauri 2
├── Zustand (state)       ├── commands/ (IPC handlers)
├── shadcn/ui + Tailwind  ├── adapters/ (DB implementations)
└── CodeMirror (editor)   └── core/manager.rs (connection pool)
                           ├── sql_engine/ (SQL parser, completion, linting)
```

**Multi-paradigm databases**: SQL (Postgres, MySQL, SQLite, MSSQL) | Document (MongoDB) | Key-Value (Redis)

**Cargo workspace**: Two crates — `src-tauri/` (main Tauri app) and `src-cli/` (QueryPilot CLI for AI agent access)

## Verification Protocol

**After frontend changes**: `pnpm typecheck && pnpm lint`

**After backend changes**: `cd src-tauri && cargo clippy`

## Deep Dives

Read these as needed for your task:

| Topic | File |
|-------|------|
| System architecture | [docs/llm-context/architecture-overview.md](docs/llm-context/architecture-overview.md) |
| React/Zustand patterns | [docs/llm-context/frontend-patterns.md](docs/llm-context/frontend-patterns.md) |
| Rust commands & adapters | [docs/llm-context/backend-patterns.md](docs/llm-context/backend-patterns.md) |
| Running tests | [docs/llm-context/testing.md](docs/llm-context/testing.md) |
| AI features & CLI | [docs/guides/ai-features.md](docs/guides/ai-features.md) |
| SQL editor & linting | [docs/llm-context/code-editor.md](docs/llm-context/code-editor.md) |
| Vault & keychain | [docs/llm-context/security.md](docs/llm-context/security.md) |
| Building & releases | [docs/llm-context/build-and-release.md](docs/llm-context/build-and-release.md) |
| Local databases | [docs/llm-context/dev-database-setup.md](docs/llm-context/dev-database-setup.md) |

## Existing Architecture Docs

For even deeper detail:

- [Query Execution](docs/architecture/query-execution.md) - Dual-path query system (Direct vs Streaming)
- [DataGrid Adapters](docs/guides/datagrid-adapter-architecture.md) - Grid implementation guide
- [Adding Databases](docs/guides/CONTRIBUTING_DB.md) - New database adapter guide
