# Query Pilot Agent Guide

This documentation outlines the development standards, commands, and architectural patterns for Query Pilot. Agents operating in this repository must adhere to these guidelines to ensure code consistency and stability.

## 1. Project Context
Query Pilot is a local-first desktop database IDE built on a hybrid architecture:
- **Frontend**: React 19 + TypeScript (Vite)
- **Backend**: Rust + Tauri 2
- **State**: Zustand (Multi-store pattern)
- **Styling**: Tailwind CSS v4 + shadcn/ui

## 2. Development & Build Commands

### Core Workflows
| Command | Description |
|---------|-------------|
| `make dev` | Start the full development environment (Tauri + React + Sidecars) |
| `make build` | Build the application for production (includes all sidecars) |
| `pnpm lint` | Run ESLint for frontend code |
| `pnpm typecheck` | Run TypeScript type checking |
| `cargo clippy` | Run Rust linter (run inside `src-tauri/`) |

### Testing
**Frontend (Vitest)**
- Run all unit tests: `pnpm test:unit`
- Run a specific test file: `pnpm test:unit <filename_pattern>`
  *Example: `pnpm test:unit QueryPanel` runs tests matching "QueryPanel"*
- Watch mode: `pnpm test:watch`

**Backend (Rust)**
- Run all tests: `make test-backend`
- Run a specific test function: `cd src-tauri && cargo test <test_function_name>`
- Run a specific integration test file: `cd src-tauri && cargo test --test <test_file_name>`

## 3. Code Style & Conventions

### Frontend (React/TypeScript)
- **Components**: Use Functional Components with named exports.
  ```tsx
  export const MyComponent = ({ prop }: Props) => { ... }
  ```
- **Hooks**: Isolate complex logic into custom hooks (`useMyLogic.ts`).
- **State**: Use Zustand for global state; React state for local UI interactions.
- **Styling**: Use Tailwind utility classes. Use `cn()` for conditional class merging.
- **Imports**: Group imports:
  1. External libraries (React, Zustand, etc.)
  2. Internal components (`@components/...`)
  3. Hooks and utilities (`@hooks/...`, `@utils/...`)
  4. Types (`@types/...`)
  5. Styles
- **Naming**:
  - Components: `PascalCase` (e.g., `QueryPanel.tsx`)
  - Hooks: `camelCase` starting with `use` (e.g., `useConnection.ts`)
  - Constants: `UPPER_SNAKE_CASE`

### Backend (Rust)
- **Error Handling**: Use `Result<T, E>` and the `?` operator. Avoid `unwrap()` or `expect()` unless in tests or specifically justified.
- **Async**: Use `tokio` for async runtime. Ensure functions usually return `Result`.
- **Modules**: Keep modules small and focused. Expose public API via `mod.rs` or `lib.rs` re-exports if necessary.
- **Commands**: Tauri commands must be annotated with `#[tauri::command]` and handle errors by returning `Result<T, String>` or a serializable error struct.

## 4. Architecture & Patterns

### Multi-Database Adapter System
Query Pilot uses a **Unified Adapter Architecture** that supports multiple database paradigms:

- **SQL Databases**: PostgreSQL, MySQL/MariaDB, SQLite, SQL Server
- **Document Databases**: MongoDB
- **Key-Value Stores**: Redis

#### Adding a New Database Adapter
To add a new database, implement:
1. `BaseCapability` trait (connect, disconnect, test_connection)
2. Paradigm-specific trait (`SqlQueryable`, `DocumentQueryable`, or `RichKeyValueOperable`)
3. Register in `UnifiedAdapter` factory (`src-tauri/src/core/manager.rs`)

No dispatcher modifications required - the `UnifiedAdapter` struct handles dynamic dispatch.

#### Backend Commands Organization (`src-tauri/src/commands/`)
- `connection.rs`: Unified connection lifecycle (connect, disconnect, test)
- `sql.rs`: SQL-specific commands (query, execute_query, switch_database)
- `document.rs`: Document database commands (MongoDB operations)
- `keyvalue.rs`: Key-value commands (Redis operations)

#### Frontend Adapter System (`src/adapters/`)
- `getAdapter()` returns `BaseAdapter` for any database type
- `getSqlAdapter()` returns `DatabaseAdapter` for SQL databases only
- Use type guards: `isSqlAdapter()`, `isDocumentAdapter()`, `isKeyValueAdapter()`

### IPC Communication
- **Small data**: Use standard Tauri commands (`invoke`).
- **Large data (Grids/Results)**: Use **Streaming** via IPC channels (MessagePack) to avoid `window.emit` serialization overhead.

### Safety
- Never commit secrets.
- Use `vault` storage for sensitive user data (connection credentials).

### Filesystem
- Always use absolute paths when interfacing with tools.

## 5. Agent Operational Protocols

- **Skills**: Before starting complex tasks, check available skills using `find_skills`.
  - Use `superpowers:brainstorming` before implementing new features.
  - Use `superpowers:test-driven-development` when writing logic.
- **Context Management**: Proactively use `discard` to remove output from tools that is no longer needed (like `cat` of a large file after reading).
- **Verification**: Always verify changes.
  - After React changes: Run `pnpm typecheck` and `pnpm lint`.
  - After Rust changes: Run `cargo check` or `cargo clippy`.
