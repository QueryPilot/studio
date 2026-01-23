# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Query Pilot is a local-first desktop database IDE built with Tauri 2 + React 19. It provides multi-window workspace management, AI-powered features via a sidecar process, and high-performance query streaming using MessagePack serialization over Tauri IPC channels.

## Development Commands

```bash
# Development
pnpm tauri:dev           # Run app in dev mode
make dev (or make d)     # Same as above
make dev-profile (or dp) # Run with QP_STREAM_PROFILE=1 for profiling
make dev-sidecar (or ds) # Run AI sidecar in dev mode (Bun on port 3001)

# Building
pnpm build               # Build frontend only
pnpm tauri:build         # Build full app (includes AI sidecar)
make build               # Build with all sidecars + SSM plugin
make build-ai            # Build AI sidecar for current platform
make build-ai-all        # Build AI sidecar for all platforms

# Testing
pnpm test:unit           # Run frontend tests once
pnpm test:watch          # Run frontend tests in watch mode
pnpm test:coverage       # Run tests with coverage
make test (or make t)    # Run all unit tests (Rust + Frontend)
make test-backend        # Run Rust tests only
make test-frontend       # Run Frontend tests only

# Running specific tests
pnpm test:unit <pattern>               # Run specific frontend test (e.g., pnpm test:unit QueryPanel)
cd src-tauri && cargo test <test_name> # Run specific Rust test (e.g., cargo test test_connection)

# Linting & Type Checking
pnpm lint                # ESLint
pnpm typecheck           # TypeScript type check
cargo clippy             # Rust linting (in src-tauri/)

# Database Setup (Docker)
make setup               # Start containers + seed all databases
make docker-up           # Start all database containers
make docker-down         # Stop containers
make docker-reset        # Reset containers and volumes
make seed-all            # Seed all databases
make seed-postgres       # Seed PostgreSQL only
make seed-mysql          # Seed MySQL only

# Releases
make release             # AI-powered release (auto version + changelog)
make release-manual VERSION=1.2.3  # Manual release
```

## Architecture

### Tauri + React Hybrid

**Frontend (React 19 + TypeScript)**
- `src/` - React frontend with vertical slice architecture
- `src/screens/` - Page-level components (MainScreen, WorkspaceScreen)
- `src/components/` - Reusable UI (shadcn/ui components, panels, grids)
- `src/stores/` - Zustand state management (multi-store pattern)
- `src/services/` - Backend communication & domain logic
- `src/hooks/` - Custom React hooks
- `src/types/` - TypeScript interfaces
- `src/utils/` - Helpers and utilities

**Backend (Rust + Tauri 2)**
- `src-tauri/src/` - Rust backend
- `src-tauri/src/commands/` - Tauri IPC commands organized by paradigm:
  - `connection.rs` - Unified connection lifecycle (connect, disconnect, test)
  - `sql.rs` - SQL-specific commands (query, execute_query, switch_database)
  - `document.rs` - Document database commands (MongoDB operations)
  - `keyvalue.rs` - Key-value commands (Redis operations)
- `src-tauri/src/core/manager.rs` - Connection pool with DashMap + UnifiedAdapter
- `src-tauri/src/core/capabilities.rs` - Capability traits for multi-paradigm support
- `src-tauri/src/adapters/` - Database adapter implementations (PostgreSQL, MySQL, SQLite, MSSQL, MongoDB, Redis)
- `src-tauri/src/ai/` - AI sidecar manager
- `src-tauri/src/ssh/` - SSH tunnel management
- `src-tauri/src/vault.rs` - Encrypted storage for connection profiles

### Multi-Window Architecture

- **Main window** (`label="main"`): Connection browser and management UI
- **Workspace windows** (`label="workspace-{connectionId}"`): Spawned per database connection
- Window lifecycle tracked via `BroadcastChannel` API (not native Tauri events)
- Each workspace manages its own connection cleanup on close
- Prevents one closed window from disconnecting others

### State Management (Zustand)

Multiple stores with specific concerns:
- `connectionStoreNew` - Active connections, favorites, recent list
- `workbenchStore` - Layout tree (grid panels), tab metadata, drag-drop
- `workspaceScreenStore` - Schema/table navigation, filtering
- `crudStore` - Transaction state, pending CRUD operations
- `aiChatStore` - AI provider/model selection (persisted)
- `dataInvalidationStore` - Event-driven cache invalidation with table-level listeners
- `panelStore` - Panel visibility and state
- `tabStateStore` - Active tab tracking
- `erdStore` - Entity relationship diagram data

### AI Sidecar Process

**Architecture:**
- Separate TypeScript/Bun executable (`ai-server-{platform}`)
- Compiled via `bun build --compile` (see `scripts/build-ai-sidecar.sh`)
- Runs on hardcoded port 47856
- Started by Tauri's sidecar API with stdout/stderr monitoring

**Flow:**
1. Rust `AIManager` spawns sidecar on app startup
2. Loads API keys from OS keychain (keyring crate) for OpenAI/Anthropic/Google
3. HTTP POST to sidecar `/config` endpoint to inject keys
4. Frontend communicates directly with sidecar via HTTP (not through Rust)

**Sidecar Routes:**
- `GET /health` - Health check
- `GET /status` - Configured providers list
- `GET /providers` - Available models per provider
- `POST /config` - Set API keys
- `POST /chat` - LLM inference (Vercel AI SDK)

**Frontend Integration:**
- `src/services/aiService.ts` handles HTTP calls to sidecar
- `useAIChatStore` manages provider/model selection with persistence
- AI responses streamed via `useChat` hook from `@ai-sdk/react`

### Query Streaming & Performance

**High-Performance Path:**
- `stream_query` command streams rows in MessagePack-encoded batches
- `QueryStreamClient` uses Tauri IPC channels (via `transformCallback`) instead of `window.emit`
- **Critical optimization**: Skips 300-350ms `window.emit` overhead for large result sets
- Batch fetching with configurable batch size, cursor setup

**Data Invalidation:**
- `dataInvalidationStore` tracks last-modified timestamp per table (`connection:db:schema:table`)
- CRUD operations trigger `invalidateTable()` which notifies all registered listeners
- Subscribers (query hooks) refetch when their table's timestamp changes
- Proper cleanup prevents listener leaks

### Unified Adapter Architecture

Query Pilot uses a **capability-based trait system** for multi-paradigm database support:

**Capability Traits (`src-tauri/src/core/capabilities.rs`):**
- `BaseCapability` - All adapters implement: `connect()`, `disconnect()`, `test_connection()`, `is_connected()`
- `SqlQueryable` - SQL databases: `execute_query()`, `execute_statement()`
- `DocumentQueryable` - Document DBs (MongoDB): `find_documents()`, `insert_document()`, `aggregate()`, etc.
- `KeyValueOperable` - Basic KV: `get_key()`, `set_key()`, `scan_keys()`, `delete_keys()`
- `RichKeyValueOperable` - Redis-specific: Hash, List, Set, ZSet, Stream operations

**UnifiedAdapter Pattern:**
- Wraps concrete adapters with capability pointers
- Runtime capability checking via `as_sql()`, `as_document()`, `as_keyvalue()`
- Type-safe paradigm dispatch in command handlers

**Supported Paradigms:**
| Paradigm | Databases | Frontend DataGrid | Frontend Adapter |
|----------|-----------|-------------------|------------------|
| SQL | PostgreSQL, MySQL, SQLite, SQL Server | `SqlDataGrid` | `src/adapters/dialects/` |
| Document | MongoDB | `DocumentDataGrid` | `src/adapters/mongodb/` |
| Key-Value | Redis | `KeyValueDataGrid` | `src/adapters/redis/` |

### Database Connection Management

**Rust ConnectionManager (`src-tauri/src/core/manager.rs`):**
- DashMap-based concurrent connection pool with 30-minute idle timeout
- Dual-layer tunnel support: SSH tunnels (with health checks) or AWS Session Manager
- Deduplicates concurrent connection attempts via inflight promises
- Reaper process removes idle connections automatically
- UnifiedAdapter for multi-paradigm support (SQL, Document, Key-Value)

**Frontend Connection Lifecycle:**
- `vaultStorage` service handles encrypted vault storage (Tauri `vault_write`/`vault_read`)
- Database-specific connection cloning via `switch_database` command
- Health monitoring with configurable ping intervals
- Connection metadata cached locally with debounced flush (250ms)

### Query Execution Architecture

Query Pilot uses **two distinct execution paths** optimized for different use cases:

**Path 1: Direct Query (`query` command + SimpleConverter)**
- **Use for**: Introspection, metadata queries, AI HTTP server (< 1000 rows)
- **How**: `BackendAPI.query()` → `query` Tauri command → `SimpleConverter` (JSON)
- **Why**: Simple API, low overhead, synchronous-like pattern
- **Examples**: Schema metadata, table lists, column info, constraint queries

**Path 2: Streaming Query (`execute_query` command + DirectMsgPackEncoder)**
- **Use for**: Data grids, query panels, table browsing (any size, optimized for 1K+ rows)
- **How**: `queryStreamClient.stream()` → `execute_query` → IPC channels → MessagePack batches
- **Why**: 3-5x faster for large datasets, progressive rendering, cancellable
- **Examples**: User queries, table data browsing, CRUD result sets

**Decision Tree:**
- Metadata/introspection? → Use `BackendAPI.query()`
- User-facing data display? → Use `queryStreamClient.stream()`
- HTTP API endpoint? → Use `BackendAPI.query()`
- Unknown result size but could be large? → Use `queryStreamClient.stream()`

See [docs/architecture/query-execution.md](docs/architecture/query-execution.md) for detailed architecture documentation.

### Security & Storage

**Vault Storage:**
- Connections stored in encrypted vault (Tauri vault API)
- In-memory cache with dirty-flag tracking
- Debounced writes (250ms) to prevent thrashing

**Keychain Integration:**
- API keys stored in native OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Never transmitted over IPC in plaintext
- Sidecar loads keys on startup, frontend never has direct access

### Telemetry & Error Reporting

**📖 See [SENTRY.md](./SENTRY.md) for comprehensive documentation**

- Optional Sentry integration (disabled by default, opt-in via Preferences UI)
- Three components: Frontend (`@sentry/react`), Rust backend (feature-gated `telemetry`), AI sidecar
- Build with telemetry: `cargo build --release --features telemetry`
- Environment variables: `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`

### Build Process

**AI Sidecar Build:**
- `scripts/build-ai-sidecar.sh` detects OS/arch and builds Bun binary for current platform
- `BUILD_ALL=true` mode builds all platform variants for distribution
- Output: `src-tauri/sidecars/ai-server-{triple}` binaries
- Referenced in `tauri.conf.json` as `externalBin`

**macOS Code Signing:**
- Configured in `tauri.conf.json` with Developer ID
- Hardened runtime + entitlements in `entitlements.plist`
- See `MACOS_SIGNING_GUIDE.md` for details

## Project Structure Notes

### Frontend

```
src/
├── screens/          # MainScreen, WorkspaceScreen
├── components/       # Reusable UI (shadcn/ui + custom)
├── stores/           # Zustand state management
├── services/         # Backend communication & domain logic
│   ├── databaseService.ts      # Connection pooling, health monitoring
│   ├── vaultStorage.ts         # Encrypted connection profiles
│   ├── queryStreamClient.ts   # Optimized batch fetching
│   └── aiService.ts            # AI sidecar HTTP client
├── hooks/            # Custom React hooks
├── types/            # TypeScript interfaces
└── utils/            # Helpers (tauri detection, formatting)
```

### Backend

```
src-tauri/src/
├── commands/               # Tauri IPC commands by paradigm
│   ├── connection.rs       # Connect/disconnect/test (all DBs)
│   ├── sql.rs              # SQL query execution
│   ├── document.rs         # MongoDB document operations
│   └── keyvalue.rs         # Redis key-value operations
├── core/                   # Connection management
│   ├── manager.rs          # ConnectionManager + UnifiedAdapter
│   └── capabilities.rs     # Capability traits (BaseCapability, SqlQueryable, etc.)
├── adapters/               # Database adapter implementations
│   ├── postgres/           # PostgreSQL
│   ├── mysql/              # MySQL/MariaDB
│   ├── sqlite/             # SQLite
│   ├── mssql/              # SQL Server
│   ├── mongodb/            # MongoDB (DocumentQueryable)
│   └── redis/              # Redis (RichKeyValueOperable)
├── ai/                     # AI sidecar manager
├── ssh/                    # SSH tunnel management
├── aws/                    # AWS Session Manager integration
├── crud/                   # CRUD transaction handling
├── vault.rs                # Encrypted storage
├── keychain.rs             # OS keychain integration
├── http_server.rs          # HTTP server for sidecar proxy
├── sentry_integration.rs   # Sentry error tracking (feature-gated)
└── types.rs                # Shared Rust types
```

### SQL Code Editor & Language Server

**Multi-Dialect Linting Strategy:**
- CodeMirror 6-based editor with dialect-specific validation
- **PostgreSQL**: Uses `pg-parser` WASM (libpg_query) for 100% PostgreSQL compatibility including PL/pgSQL
- **MySQL/SQLite/MSSQL**: Web Worker-based validation for non-blocking syntax checking
- Dialect linters in `src/components/CodeEditor/languages/sql/dialect-validators/`

**Smart SQL Features:**
- Context-aware autocomplete with table/column suggestions
- Real-time semantic linting with metadata from active connection
- Hover tooltips for table/column information
- Symbol table tracking for CTE and subquery references
- Web Worker isolation prevents UI blocking during validation

**Architecture:**
- `src/components/CodeEditor/core/` - Core editor logic and query utilities
- `src/components/CodeEditor/languages/sql/` - SQL language support
  - `context.ts` - SQL context analyzer (the "Brain")
  - `completion.ts` - Intelligent autocomplete
  - `linter-strategy.ts` - Unified dialect linter interface
  - `pg-parser-linter.ts` - PostgreSQL WASM parser
  - `linter-worker-manager.ts` - Worker pool for non-blocking validation
  - `metadataProvider.ts` - Schema metadata integration
- Separate DBML language support in `languages/dbml/` for ERD editing

### DataGrid Architecture

Query Pilot uses a **unified DataGrid architecture** with paradigm-specific adapters:

**Two Categories:**
- **QueryResultGrid**: Read-only display of ad-hoc query results (static data)
- **Paradigm-specific grids**: Live data browsers with CRUD (`SqlDataGrid`, `DocumentDataGrid`, `KeyValueDataGrid`)

**Layer Structure:**
```
Frontend Adapters (src/components/DataGrid/adapters/)
    ↓
BaseDataGrid (shared features: sorting, filtering, column management)
    ↓
Data Hooks (useTableDataQuery, useDocumentData, useKeyValueData)
    ↓
Backend Adapters (src/adapters/{dialects,mongodb,redis}/)
    ↓
Rust Commands (sql.rs, document.rs, keyvalue.rs)
```

**Key Files:**
- `src/components/DataGrid/base/BaseDataGrid.tsx` - Unified grid foundation (~1800 lines)
- `src/components/DataGrid/adapters/` - Paradigm-specific wrappers
- `src/components/DataGrid/hooks/` - Data fetching and CRUD hooks
- `src/adapters/` - Frontend database operation adapters

See [docs/guides/datagrid-adapter-architecture.md](docs/guides/datagrid-adapter-architecture.md) for complete documentation.

## Key Patterns

1. **MessagePack Serialization**: Used for large data transfers (row batches) to eliminate JSON overhead
2. **IPC Channel Streaming**: Direct IPC channels for query results (bypasses `window.emit` for sub-100ms latency)
3. **Service Locator**: `ConnectionManager` and `AIManager` managed globally via Tauri state
4. **Capability-Based Adapters**: `UnifiedAdapter` wraps paradigm-specific traits (`SqlQueryable`, `DocumentQueryable`, `RichKeyValueOperable`)
5. **Frontend Type Guards**: `isSqlAdapter()`, `isDocumentAdapter()`, `isKeyValueAdapter()` for type-safe paradigm dispatch
6. **Event-Driven Invalidation**: Table-level listeners in `dataInvalidationStore` for reactive updates
7. **Debounced Writes**: Vault storage with 250ms debounce to batch edits
8. **BroadcastChannel for Multi-Window**: Cross-window coordination without Tauri events
9. **Web Worker Isolation**: CPU-intensive validation runs in workers to prevent UI freezing
10. **Column Index Mapping**: When adapters provide custom `getCellContent`, `BaseDataGrid` maps visual column indices back to original indices for correct data display after column reordering

## Testing Strategy

**Frontend Tests:**
- Vitest + React Testing Library
- Test files: `src/**/*.{test,spec}.{ts,tsx}`
- Setup: `src/test-utils/setup.ts`
- Run: `pnpm test:unit` or `pnpm test:watch`

**Rust Tests:**
- Unit tests: `cargo test --lib --bins` (in `src-tauri/`)
- Integration tests: `src-tauri/tests/`
- SSH tunnel tests: `make test-ssh-full` (requires Docker)

**Database Testing:**
- Docker Compose provides PostgreSQL, MySQL, SQLite, SQL Server, Oracle
- Seed scripts in `seeds/` directory
- `make setup` starts containers and seeds all databases

## Dependencies

**Frontend:**
- React 19 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui (UI components)
- Zustand (state management)
- Tauri API (`@tauri-apps/api`)
- Vercel AI SDK (`@ai-sdk/react`, `ai`)
- CodeMirror (query editor)
- XYFlow (ERD diagrams)
- Glide Data Grid (table display)
- Sentry (`@sentry/react`, `@sentry/vite-plugin`) - optional, for error tracking

**Backend:**
- Tauri 2
- tokio-postgres (PostgreSQL adapter)
- mysql_async (MySQL adapter)
- mongodb (MongoDB adapter - Document paradigm)
- redis (Redis adapter - Key-Value paradigm)
- keyring (OS keychain integration)
- dashmap (concurrent connection pool)
- rmp-serde (MessagePack serialization)
- sentry, sentry-tracing (optional, feature-gated for error tracking)

## Common Workflows

### Adding a New Database Command

1. Define Rust command in `src-tauri/src/commands/<paradigm>.rs`:
   - `connection.rs` for connection lifecycle commands
   - `sql.rs` for SQL-specific commands
   - `document.rs` for MongoDB commands
   - `keyvalue.rs` for Redis commands
2. Add `#[tauri::command]` attribute
3. Register command in `src-tauri/src/lib.rs` `.invoke_handler()`
4. Call from frontend via `invoke('command_name', { args })`

### Adding a New Database Adapter

See [docs/guides/CONTRIBUTING_DB.md](docs/guides/CONTRIBUTING_DB.md) for detailed instructions. Key steps:

1. Determine paradigm (SQL, Document, or Key-Value)
2. Create adapter in `src-tauri/src/adapters/<dbname>/`
3. Implement `BaseCapability` + paradigm-specific trait
4. Add `UnifiedAdapter` constructor in `manager.rs`
5. Register in factory and add `DbType` variant
6. Create frontend adapter in `src/adapters/`

### Adding a New Zustand Store

1. Create store in `src/stores/` with `create()` from `zustand`
2. Define state interface and actions
3. Use `persist()` middleware if persistence needed
4. Import and use in components via `useStoreName()`

### Adding AI Sidecar Routes

1. Add route in `src-tauri/sidecar-ai/index.ts`
2. Update `src/services/aiService.ts` with HTTP client method
3. Rebuild sidecar: `make build-ai`

### Modifying Database Adapters

1. Update capability trait in `src-tauri/src/core/capabilities.rs` if adding new operations
2. Implement changes in specific adapter (e.g., `adapters/postgres/adapter.rs`)
3. If adding new paradigm capabilities, update `UnifiedAdapter` in `manager.rs`
4. Add tests in `src-tauri/tests/` or inline `#[cfg(test)]` modules

## Path Aliases

Frontend uses path aliases configured in `vite.config.ts`:
- `@/` → `src/`
- `@components/` → `src/components/`
- `@lib/` → `src/lib/`
- `@hooks/` → `src/hooks/`
- `@types/` → `src/types/`
- `@utils/` → `src/utils/`

## Platform-Specific Notes

**macOS:**
- Code signing required for distribution (see `MACOS_SIGNING_GUIDE.md`)
- Hardened runtime + entitlements
- Notarization for Gatekeeper

**Windows:**
- PowerShell script for SSM plugin download
- Code signing recommended for SmartScreen

**Linux:**
- AppImage distribution
- libssl dependency for keychain

## Important Files

- `tauri.conf.json` - Tauri configuration (window settings, bundle config)
- `Makefile` - Development and build tasks
- `package.json` - Frontend dependencies and scripts
- `Cargo.toml` - Rust dependencies (in `src-tauri/`)
- `vitest.config.ts` - Frontend test configuration
- `.env` - Environment variables (not committed)
- `.env.development` - Development environment variables

## Connection Configuration

Development database credentials (via `make setup`):
- **PostgreSQL**: `localhost:15432` (user: devuser, pass: devpass123, db: todoapp)
- **MySQL**: `localhost:13306` (user: devuser, pass: devpass123, db: todoapp)
- **SQLite**: `seeds/sqlite/todoapp.db`
- **SQL Server**: `localhost:11434` (user: sa, pass: DevPass123, db: todoapp)
- **Oracle**: `localhost:11521` (user: todoapp, pass: DevPass123, service: XE)
