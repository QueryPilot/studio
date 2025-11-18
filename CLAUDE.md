# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Query Pilot is a local-first desktop database IDE built with Tauri 2 + React 19. It provides multi-window workspace management, AI-powered features via a sidecar process, and high-performance query streaming using MessagePack serialization over Tauri IPC channels.

## Development Commands

```bash
# Development
pnpm tauri:dev           # Run app in dev mode
make dev                 # Same as above
make dev-sidecar         # Run AI sidecar in dev mode (Bun on port 3001)

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
make test                # Run all unit tests (Rust + Frontend)
make test-backend        # Run Rust tests only
make test-frontend       # Run Frontend tests only
cargo test --lib         # Run specific Rust unit tests (in src-tauri/)

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
- `src-tauri/src/commands.rs` - ~50+ Tauri IPC commands
- `src-tauri/src/core/manager.rs` - Connection pool with DashMap
- `src-tauri/src/adapters/` - Database adapter trait implementations
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

### Database Connection Management

**Rust ConnectionManager (`src-tauri/src/core/manager.rs`):**
- DashMap-based concurrent connection pool with 30-minute idle timeout
- Dual-layer tunnel support: SSH tunnels (with health checks) or AWS Session Manager
- Deduplicates concurrent connection attempts via inflight promises
- Reaper process removes idle connections automatically
- Per-connection adapter pattern for multi-DB support (PostgreSQL, MySQL, SQLite, SQL Server)

**Frontend Connection Lifecycle:**
- `vaultStorage` service handles encrypted vault storage (Tauri `vault_write`/`vault_read`)
- Database-specific connection cloning via `switch_database` command
- Health monitoring with configurable ping intervals
- Connection metadata cached locally with debounced flush (250ms)

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

**Sentry Integration (Opt-In):**
- Crash reporting, error tracking, and performance monitoring across all three components
- **Privacy-First**: Default disabled, requires explicit user opt-in via Preferences UI
- **Single Project**: All components report to one Sentry project with automatic tagging
- Controlled via `preferencesStore.telemetry` settings

**Frontend (React + @sentry/react):**
- Initialized in `src/main.tsx` based on user preference
- ErrorBoundary enhanced with Sentry capture in `src/components/ErrorBoundary.tsx`
- Source maps uploaded to Sentry via Vite plugin (production builds only)
- Utility functions in `src/utils/sentry.ts`:
  - `initializeSentry()` - Initialize with user preferences
  - `disableSentry()` - Runtime disable (immediate effect)
  - `captureException()` - Error capture with context
  - `addBreadcrumb()` - Debugging breadcrumbs
- Configuration: `VITE_SENTRY_DSN` environment variable

**Rust Backend (sentry crate):**
- Optional feature flag: `cargo build --features telemetry`
- Initialized in `src-tauri/src/main.rs` on app startup
- Panic handler automatically captures Rust panics
- Integration module: `src-tauri/src/sentry_integration.rs`
- Performance tracing with `sentry-tracing` integration
- Configuration: `SENTRY_DSN` environment variable
- Note: Enabling requires app restart (Sentry initializes on startup)

**AI Sidecar (Bun + @sentry/node):**
- Initialized via `/config` endpoint when sidecar receives configuration
- Captures uncaught exceptions and unhandled rejections
- Integration module: `src-tauri/sidecar-ai/utils/sentry.ts`
- Configuration passed from Rust backend via POST to `/config`
- Environment: `SENTRY_DSN`

**Performance Monitoring:**
- **Frontend**: Page loads, navigation, component renders, API calls (10% sample rate)
- **Backend**: Database queries, connection pool operations, SSH tunnels
- **Sidecar**: LLM requests, HTTP endpoints, provider API calls
- User control: Toggle in Preferences → Performance monitoring

**Session Replay (Opt-In):**
- Visual debugging context for errors
- All text masked, all media blocked (privacy)
- 50% of errors captured when enabled
- User control: Toggle in Preferences → Session replay

**Privacy Safeguards:**
- **Never sent**: SQL queries, user messages, AI responses, API keys, credentials, connection strings
- **Data sanitization**: `beforeSend` hooks strip sensitive data before transmission
- **Anonymization**: Only error types, stack traces, OS info, and app version sent
- **User control**: All telemetry disabled by default, opt-in only
- **Runtime disable**: User can disable instantly (no restart required)

**Build Configuration:**
```bash
# Single Sentry project for all components
export SENTRY_DSN="https://[KEY]@sentry.io/[PROJECT]"
export VITE_SENTRY_DSN="$SENTRY_DSN"  # For frontend
export SENTRY_AUTH_TOKEN="[TOKEN]"
cargo build --release --features telemetry
pnpm build  # Vite automatically uploads source maps
```

**GitHub Actions Setup:**
- Release workflow: `.github/workflows/release.yml` supports optional Sentry integration
- Configure GitHub secrets: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- Quick setup guide: `.github/SENTRY_QUICKSTART.md`
- Detailed setup guide: `.github/SENTRY_SETUP.md`
- If secrets not set, app builds successfully without telemetry (graceful degradation)

**User Preferences UI:**
- Location: Preferences → Telemetry & Error Reporting
- Three toggles:
  - **Enable error tracking** (master switch) - Disable = immediate, Enable = requires restart
  - **Performance monitoring** (10% sample rate) - Requires error tracking enabled
  - **Session replay on errors** (50% sample rate) - Requires error tracking enabled
- Status indicators: Green (active) / Yellow (disabled)
- Clear privacy disclosure with data collection transparency
- "What we collect" vs "What we never collect" comparison

**Component Tagging in Sentry:**
All errors automatically tagged for filtering:
- `component:frontend` + `platform:javascript`
- `component:backend` + `platform:rust`
- `component:sidecar` + `platform:node`

### Build Process

**AI Sidecar Build:**
- `scripts/build-ai-sidecar.sh` detects OS/arch and builds Bun binary for current platform
- `BUILD_ALL=true` mode builds all platform variants for distribution
- Output: `src-tauri/sidecars/ai-server-{triple}` binaries
- Referenced in `tauri.conf.json` as `externalBin`

**AWS Session Manager Plugin:**
- Downloaded via `scripts/download-ssm-plugin.sh` (Unix) or `.ps1` (Windows)
- Bundled as `sidecars/session-manager-plugin-{triple}`
- Used for AWS RDS tunneling via Session Manager

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
├── commands.rs             # ~50+ Tauri IPC command handlers
├── core/                   # Connection manager, pool, adapters
├── adapters/               # Database adapter implementations
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

## Key Patterns

1. **MessagePack Serialization**: Used for large data transfers (row batches) to eliminate JSON overhead
2. **IPC Channel Streaming**: Direct IPC channels for query results (bypasses `window.emit` for sub-100ms latency)
3. **Service Locator**: `ConnectionManager` and `AIManager` managed globally via Tauri state
4. **Adapter Pattern**: `DbAdapter` trait for multi-database support
5. **Event-Driven Invalidation**: Table-level listeners in `dataInvalidationStore` for reactive updates
6. **Debounced Writes**: Vault storage with 250ms debounce to batch edits
7. **BroadcastChannel for Multi-Window**: Cross-window coordination without Tauri events

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
- keyring (OS keychain integration)
- dashmap (concurrent connection pool)
- rmp-serde (MessagePack serialization)
- sentry, sentry-tracing (optional, feature-gated for error tracking)

## Common Workflows

### Adding a New Database Command

1. Define Rust command in `src-tauri/src/commands.rs` or relevant module
2. Add `#[tauri::command]` attribute
3. Register command in `src-tauri/src/lib.rs` `.invoke_handler()`
4. Call from frontend via `invoke('command_name', { args })`

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

1. Update trait in `src-tauri/src/adapters/mod.rs` if needed
2. Implement changes in specific adapter (e.g., `postgres.rs`)
3. Add tests in `src-tauri/tests/` or inline `#[cfg(test)]` modules

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
