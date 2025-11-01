# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Query Pilot** (internally: DevDB Studio) is a modern database IDE built with Tauri 2 and React 19. It provides a native desktop application for managing PostgreSQL databases with an intelligent AI assistant powered by multiple LLM providers.

## Tech Stack

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **UI Components**: shadcn/ui (Radix UI primitives) + Tailwind CSS
- **State Management**: Zustand for global state
- **Data Grid**: Glide Data Grid for high-performance read-only views (editing disabled pending redesign)
- **Code Editor**: CodeMirror 6 for SQL and DBML editing
- **Visualization**: ReactFlow + ELK.js for ERD diagrams
- **AI SDK**: Vercel AI SDK (@ai-sdk/react) for multi-provider LLM integration

### Backend (Rust)
- **Framework**: Tauri 2
- **Async Runtime**: Tokio
- **Database**: PostgreSQL via tokio-postgres with connection pooling (deadpool-postgres)
- **Serialization**: MessagePack (rmp-serde) for binary data transfer
- **Security**: OS-level keychain integration via `keyring` crate

### AI Sidecar
- **Runtime**: Bun HTTP server compiled as platform-specific executable
- **Architecture**: Standalone process managed by Tauri backend
- **Providers**: OpenAI, Anthropic, Google Gemini, Ollama

## Development Commands

### Initial Setup
```bash
# Install all dependencies
make install
# or
pnpm install && cd src-tauri/sidecar-ai && bun install

# Start database containers and seed data
make setup
```

### Daily Development
```bash
# Run in development mode (launches Tauri + React dev server)
make dev
# or
make d
# or
pnpm tauri:dev

# Run AI sidecar standalone (for debugging)
make dev-sidecar
# or
make ds
```

### Building
```bash
# Build AI sidecar for current platform
make build-ai
# or
pnpm build:ai-sidecar

# Build AI sidecar for all platforms (macOS, Linux, Windows)
make build-ai-all

# Full production build (includes AI sidecar + Tauri bundle)
make build
# or
pnpm tauri:build
```

### Testing
```bash
# Run all Rust unit tests
make test
# or
make t

# Run tests in release mode (faster)
make test-release

# Run comprehensive integration tests
make test-all

# Quick database connection check
make test-quick
```

### Database Management
```bash
# Start all database containers (PostgreSQL, MySQL, SQLite, SQL Server, Oracle)
make docker-up

# Stop containers
make docker-down

# Reset containers (removes volumes)
make docker-reset

# Seed specific databases
make seed-postgres
make seed-mysql
make seed-sqlite
make seed-sqlserver
make seed-oracle

# Seed all databases
make seed-all

# Reseed (drops existing data)
make reseed-all
```

### Code Quality
```bash
# Lint frontend code
pnpm lint

# Type check
pnpm typecheck

# Clean build artifacts
make clean
```

## Architecture

### Tauri Backend (`src-tauri/src/`)

**Core Module Structure:**
- `main.rs` - Application entry point, command registration, AI sidecar initialization
- `commands.rs` - Tauri command handlers for database operations
- `core/` - Core abstractions and connection management
  - `adapter.rs` - DbAdapter trait defining database operations interface
  - `manager.rs` - ConnectionManager for pooling and lifecycle management
  - `cell_value.rs` - Universal type system for database values (CellValue enum)
- `adapters/` - Database-specific implementations
  - `postgres/` - PostgreSQL adapter with fast binary protocol support
    - `adapter.rs` - Main adapter implementation
    - `pool.rs` - Connection pooling
    - `fast_converter.rs` - High-performance row-to-CellValue conversion with rayon parallelization
    - `query_fast.rs` - Binary protocol query execution
    - `introspection.rs` - Schema metadata retrieval
    - `types.rs` - PostgreSQL type mapping
- `ai/` - AI assistant subsystem
  - `manager.rs` - Orchestrates sidecar lifecycle and API key management
  - `sidecar.rs` - Process management for Bun HTTP server
  - `secure_storage.rs` - OS keychain integration for API keys
  - `commands.rs` - Tauri commands for AI operations
- `http_server.rs` - Local HTTP server exposing database tools to AI sidecar
- `keychain.rs` - Vault password storage in OS keychain
- `vault.rs` - Encrypted storage for connection credentials
- `storage/` - Local data persistence

**Key Patterns:**
- **Adapter Pattern**: All database operations go through the `DbAdapter` trait, allowing future database support (MySQL, SQLite, etc.)
- **Connection Pooling**: Each connection profile gets a dedicated connection pool managed by `ConnectionManager`
- **Binary Protocol**: PostgreSQL queries use binary wire protocol for performance (see `query_fast.rs`)
- **MessagePack Serialization**: Frontend ↔ Backend communication uses MessagePack for smaller payloads than JSON
- **Parallel Row Conversion**: Large result sets are converted in parallel using rayon (see `fast_converter.rs`)

### Frontend (`src/`)

**Directory Structure:**
- `components/` - React components organized by feature
  - `DataGridV2/` - High-performance read-only data grid (CUD removed Oct 2025)
  - `Workbench/` - VS Code-style panel layout system
  - `AIAssistant/` - Chat interface with streaming responses
  - `TableStructure/`, `TableIndexes/`, `TableTriggers/` - Schema/index/trigger panels (currently read-only)
  - `Erd/` - ERD visualization with DBML support
  - `QueryPanel/` - SQL query editor and results
  - `ui/` - shadcn/ui base components
- `stores/` - Zustand state management
  - `connectionStore.ts` - Connection profiles and active connections
  - `tableEditStore.ts` - (removed Oct 2025; pending redesign of table editing)
  - `workbenchStore.ts` - Panel layout persistence
  - `aiStore.ts` - AI provider configuration and chat state
  - `preferencesStore.ts` - User preferences
- `screens/` - Top-level views
  - `main/` - Connection list screen
  - `workspace/` - Main workspace with sidebar + workbench
- `services/` - Business logic and API communication
  - `databaseService.ts` - Wraps Tauri commands for database operations
  - `vaultStorage.ts` - Encrypted local storage using Dexie (IndexedDB)
- `utils/` - Shared utilities
  - `tauri.ts` - Tauri API helpers
  - `workbench/` - Panel layout utilities

**Key Frontend Patterns:**
- **Zustand Stores**: All global state uses Zustand with immer for immutability
- **MessagePack Decoding**: All database results are MessagePack-encoded; decode using `@msgpack/msgpack`
- **Read-Only Grid**: Table editing flows are disabled pending redesign; grid now emits display-only events
- **Streaming Queries**: Large query results stream via Tauri events
- **Vault Storage**: Sensitive data (connections, queries) stored encrypted in IndexedDB via Dexie

### AI Sidecar (`src-tauri/sidecar-ai/`)

**Architecture:**
- Bun HTTP server compiled to standalone executable
- Started by Tauri backend on random available port
- API keys loaded from OS keychain and stored in-memory
- Streams responses via Server-Sent Events (SSE)
- Communicates with Tauri backend via HTTP for database tool execution

**Endpoints:**
- `GET /health` - Health check
- `POST /config` - Configure API keys (called on startup)
- `POST /chat` - Stream AI responses
- `GET /providers` - List available providers
- `GET /status` - Sidecar status

**Build Process:**
The sidecar is compiled using Bun's built-in compiler:
```bash
bun build index.ts --compile --target=bun-darwin-arm64 --outfile=ai-server-aarch64-apple-darwin
```
Tauri automatically bundles the correct platform executable.

## Critical Implementation Details

### Database Query Flow
1. Frontend calls `databaseService.streamQuery()`
2. Rust command `stream_query()` invoked via Tauri
3. PostgreSQL adapter executes query using binary protocol
4. Rows converted to `CellValue` in parallel
5. MessagePack-encoded batches emitted via Tauri events
6. Frontend decodes MessagePack and updates UI

### Table Editing Flow (Deprecated Oct 2025)
Table editing is temporarily disabled. The previous `tableEditStore`-driven workflow, pending edits drawer, and apply/preview services were removed and will be replaced by a future redesign.

### AI Assistant Flow
1. User enters message in AIAssistantSidebar
2. Frontend calls sidecar `/chat` endpoint with streaming
3. Sidecar uses Vercel AI SDK to call provider (OpenAI/Anthropic/Google/Ollama)
4. AI response streams back via SSE
5. Tool calls (if any) proxied to Tauri backend via HTTP
6. Results returned to AI for formatting
7. Final response displayed in chat UI

### API Key Security
1. User enters API key in Preferences → AI Runtime
2. Frontend invokes `set_ai_api_key(provider, key)`
3. Rust saves to OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
4. On app startup: keys loaded from keychain
5. Keys sent to sidecar via POST `/config`
6. Sidecar stores in-memory (never persisted to disk)

## Database Adapter Implementation

When adding support for a new database:

1. Create `src-tauri/src/adapters/{database}/` directory
2. Implement `DbAdapter` trait from `core/adapter.rs`
3. Key methods to implement:
   - `connect()` - Establish connection/pool
   - `query()` / `execute()` - Execute SQL
   - `get_databases()`, `get_schemas()`, `get_tables()` - Introspection
   - `get_table_columns()`, `get_constraints()`, `get_indexes()` - Table metadata
   - `create_index()`, `alter_table_*()` - DDL operations
4. Map database types to `CellValue` enum
5. Add adapter to `ConnectionManager` in `core/manager.rs`
6. Update `ConnectionProfile` type in `src-tauri/src/types.rs`

See `adapters/postgres/` for reference implementation.

## State Management Patterns

### Zustand Store Structure
All stores follow this pattern:
```typescript
interface State {
  // Data
  items: Item[];

  // Derived state (avoid duplicating data)
  getItemById: (id: string) => Item | undefined;

  // Actions
  addItem: (item: Item) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
}

export const useStore = create<State>()(
  immer((set, get) => ({
    items: [],
    getItemById: (id) => get().items.find(i => i.id === id),
    addItem: (item) => set((state) => { state.items.push(item); }),
    updateItem: (id, updates) => set((state) => {
      const item = state.items.find(i => i.id === id);
      if (item) Object.assign(item, updates);
    }),
  }))
);
```

### Async Actions
For async operations, use this pattern:
```typescript
fetchItems: async () => {
  const items = await invoke("get_items");
  set({ items });
}
```

## Working with MessagePack

All Tauri commands that return large data use MessagePack:

```typescript
import { decode } from "@msgpack/msgpack";

// In Tauri command response
const response = await invoke("stream_query", { sql: "SELECT * FROM users" });
const decoded = decode(new Uint8Array(response.data));
```

Rust side (in commands):
```rust
use rmp_serde::encode::to_vec;
use tauri::ipc::Response;

#[tauri::command]
async fn stream_query(sql: &str) -> Result<Response, String> {
    let result = execute_query(sql).await?;
    let msgpack = to_vec(&result).map_err(|e| e.to_string())?;
    Ok(Response::new(msgpack))
}
```

## Common Gotchas

### Frontend Build Issues
- **Symptom**: TypeScript errors about missing types
- **Fix**: Run `pnpm typecheck` to see real errors; ESLint can be noisy

### Tauri Commands Not Found
- **Symptom**: `command {name} not found`
- **Fix**: Ensure command is registered in `main.rs` via `tauri::generate_handler![]`

### MessagePack Decode Errors
- **Symptom**: Cannot decode response from backend
- **Fix**: Ensure backend uses `Response::new(msgpack_bytes)` not `Response::json()`

### AI Sidecar Connection Refused
- **Symptom**: Frontend can't reach sidecar
- **Fix**: Check sidecar is running via `debug_sidecar_status()` command; verify CORS headers

### Connection Pool Exhaustion
- **Symptom**: Queries hang after many operations
- **Fix**: Ensure `disconnect()` is called when closing connections; check pool size in `pool.rs`

### Vault Unlock Prompt Loop
- **Symptom**: Password prompt keeps appearing
- **Fix**: Check vault password in keychain; delete via Preferences if corrupted

## Performance Considerations

- **Large Result Sets**: Queries stream in batches (see `stream_query` command)
- **Parallel Row Conversion**: Result rows are converted to CellValue in parallel using rayon
- **Connection Pooling**: Each connection profile maintains a pool (default: 10 connections)
- **Schema Caching**: Table metadata cached in frontend stores; invalidate on DDL changes
- **Binary Protocol**: PostgreSQL adapter uses binary wire format for ~30% faster queries
- **Prepared Statement Cache**: LRU cache (moka) stores prepared statements per connection

## Testing Strategy

### Rust Tests
- Unit tests in `src-tauri/src/` files: `cargo test`
- Integration tests: `cargo run --example run_tests`
- Database tests require Docker containers running

### Frontend Tests
- Component tests: `pnpm test` (Vitest configured but minimal coverage)
- Manual testing via dev mode: `make dev`

### AI Sidecar Tests
- Manual: Run `make dev-sidecar` and test endpoints with curl
- Health check: `curl http://localhost:3001/health`

## Documentation

All major features are documented in `docs/`:
- `api.spec.md` - Complete Tauri command reference
- `ai-assistant.spec.md` - AI architecture and provider setup
- `data-grid-v2.spec.md` - Data grid implementation details
- `central-table-editing-store.spec.md` - Table editing architecture
- `erd-panel.spec.md` - ERD visualization
- `workbench.spec.md` - Panel layout system

See `docs/README.md` for full documentation index.

## Environment-Specific Notes

### macOS
- Uses native keychain for secure storage
- Build target: `aarch64-apple-darwin` (Apple Silicon) or `x86_64-apple-darwin` (Intel)
- Global shortcut: `Cmd+Shift+Space`

### Windows
- Uses Credential Manager for secure storage
- Build target: `x86_64-pc-windows-msvc`
- AI sidecar executable has `.exe` extension

### Linux
- Uses Secret Service API (requires libsecret)
- Build target: `x86_64-unknown-linux-gnu`

## Code Style

### TypeScript
- Use functional components with hooks
- Prefer `const` over `let`
- Use Tailwind CSS classes (avoid inline styles)
- Import shadcn/ui components from `@/components/ui`

### Rust
- Follow Rust 2021 edition conventions
- Use `async/await` for all I/O operations
- Prefer `Result<T>` over panicking
- Use `tracing::info!` for logging

### File Naming
- React components: PascalCase (e.g., `TableStructure.tsx`)
- Utilities: camelCase (e.g., `formatDate.ts`)
- Rust modules: snake_case (e.g., `connection_manager.rs`)
