# AGENTS.md

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

**Package manager**: `pnpm`

## Architecture at a Glance

```
Frontend (src/)           Backend (src-tauri/src/)
├── React 19 + TS         ├── Rust + Tauri 2
├── Zustand (state)       ├── commands/ (IPC handlers)
├── shadcn/ui + Tailwind  ├── adapters/ (DB implementations)
└── CodeMirror (editor)   └── core/manager.rs (connection pool)
```

**Multi-paradigm databases**: SQL (Postgres, MySQL, SQLite, MSSQL) | Document (MongoDB) | Key-Value (Redis)

## Verification Protocol

**After frontend changes**:
```bash
pnpm typecheck && pnpm lint
```

**After backend changes**:
```bash
cd src-tauri && cargo clippy
```

## Deep Dives

Read these as needed for your task:

| Topic | File |
|-------|------|
| System architecture | [docs/llm-context/architecture-overview.md](docs/llm-context/architecture-overview.md) |
| React/Zustand patterns | [docs/llm-context/frontend-patterns.md](docs/llm-context/frontend-patterns.md) |
| Rust commands & adapters | [docs/llm-context/backend-patterns.md](docs/llm-context/backend-patterns.md) |
| Running tests | [docs/llm-context/testing.md](docs/llm-context/testing.md) |
| AI sidecar | [docs/llm-context/ai-sidecar.md](docs/llm-context/ai-sidecar.md) |
| SQL editor & linting | [docs/llm-context/code-editor.md](docs/llm-context/code-editor.md) |
| Vault & keychain | [docs/llm-context/security.md](docs/llm-context/security.md) |
| Building & releases | [docs/llm-context/build-and-release.md](docs/llm-context/build-and-release.md) |
| Local databases | [docs/llm-context/dev-database-setup.md](docs/llm-context/dev-database-setup.md) |

## Existing Architecture Docs

- [Query Execution](docs/architecture/query-execution.md) - Dual-path query system
- [DataGrid Adapters](docs/guides/datagrid-adapter-architecture.md) - Grid implementation
- [Adding Databases](docs/guides/CONTRIBUTING_DB.md) - New adapter guide
