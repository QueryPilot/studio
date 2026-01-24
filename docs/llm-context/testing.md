# Testing

## Quick Reference

| What | Command |
|------|---------|
| All tests (Rust + Frontend) | `make test` |
| Frontend only | `pnpm test:unit` |
| Frontend watch mode | `pnpm test:watch` |
| Frontend with coverage | `pnpm test:coverage` |
| Rust only | `make test-backend` |
| Specific frontend test | `pnpm test:unit <pattern>` |
| Specific Rust test | `cd src-tauri && cargo test <name>` |

## Frontend Tests

**Stack**: Vitest + React Testing Library

**Location**: `src/**/*.{test,spec}.{ts,tsx}`

**Setup**: `src/test-utils/setup.ts`

**Example**:
```bash
# Run tests matching "QueryPanel"
pnpm test:unit QueryPanel

# Watch mode for a specific file
pnpm test:watch src/components/QueryPanel
```

## Rust Tests

**Unit tests**: `src-tauri/src/**/*.rs` (inline `#[cfg(test)]` modules)

**Integration tests**: `src-tauri/tests/`

**Example**:
```bash
cd src-tauri

# Run a specific test function
cargo test test_connection

# Run a specific integration test file
cargo test --test integration_test_name
```

## Database Testing

Docker Compose provides test databases:

```bash
# Start containers and seed all databases
make setup

# Or step by step:
make docker-up       # Start containers
make seed-all        # Seed all databases
make seed-postgres   # Seed PostgreSQL only
make seed-mysql      # Seed MySQL only
```

**Test Databases** (via `make setup`):
- PostgreSQL: `localhost:15432`
- MySQL: `localhost:13306`
- SQLite: `seeds/sqlite/todoapp.db`
- SQL Server: `localhost:11434`
- Oracle: `localhost:11521`

See [Dev Database Setup](./dev-database-setup.md) for credentials.

## SSH Tunnel Tests

Requires Docker:
```bash
make test-ssh-full
```

## Verification After Changes

**After React/TypeScript changes**:
```bash
pnpm typecheck && pnpm lint
```

**After Rust changes**:
```bash
cd src-tauri && cargo clippy
```

**Before committing**:
```bash
pnpm lint && pnpm typecheck && make test
```
