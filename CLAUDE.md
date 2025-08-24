# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup
```bash
# Install dependencies
pnpm install

# Start development server
pnpm tauri:dev
# or use Makefile
make dev
make d  # shorthand
```

### Build & Testing
```bash
# Build for production
pnpm tauri:build
# or 
make build

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Clean build artifacts
make clean
```

### Database Development Setup
```bash
# Complete setup - starts Docker containers and seeds all databases  
make setup

# Database container management
make docker-up      # Start all database containers
make docker-down    # Stop containers
make docker-reset   # Stop, remove volumes, restart

# Individual database seeding
make seed-postgres
make seed-mysql
make seed-sqlite
make seed-sqlserver
make seed-oracle
make seed-all       # Seed all databases
make reseed-all     # Drop and reseed (DELETES data)
```

## Architecture Overview

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Tauri 2 + Rust
- **Database Support**: PostgreSQL, MySQL, SQLite, SQL Server, MariaDB, Oracle (MSSQL adapter disabled due to tiberius compatibility issues)
- **UI Framework**: shadcn/ui + Radix UI primitives
- **State Management**: Zustand with persistence

### Project Structure
```
src/                     # React frontend
├── components/          # React components
│   ├── ui/             # shadcn/ui components  
│   └── theme-provider.tsx
├── screens/            # Screen-level components
├── stores/             # Zustand stores
├── services/           # Frontend services
├── types/              # TypeScript type definitions
├── lib/                # Utilities and helpers
└── utils/              # Utility functions

src-tauri/              # Rust backend
├── src/
│   ├── commands/       # Tauri command handlers
│   ├── database/       # Database adapters and management
│   │   └── adapter/    # Database-specific implementations
│   ├── crypto/         # Encryption and secure storage
│   ├── storage/        # Secure storage implementations
│   └── cache/          # Connection pooling and caching
└── tauri.conf.json     # Tauri configuration
```

### Rust Backend Architecture

#### Core Modules
- **Database Layer**: `src-tauri/src/database/`
  - `registry.rs` - Connection registry and lifecycle management
  - `adapter/` - Database-specific adapters (postgres, mysql, sqlite, mssql)
  - `executor.rs` - Query execution with streaming support
  - `cursor.rs` - Cursor-based query result streaming
  - `metadata.rs` - Database schema introspection

- **Security Layer**: `src-tauri/src/crypto/` + `src-tauri/src/storage/`
  - `encryption.rs` - AES-GCM/ChaCha20-Poly1305 encryption
  - `key_manager.rs` - Key derivation and rotation
  - `secure_store.rs` - Encrypted data storage
  - `keychain.rs` - OS keychain integration

- **Commands**: `src-tauri/src/commands/`
  - `database.rs` - Database operations (connect, query, schema)
  - `secure_storage.rs` - Secure connection storage
  - `health.rs` - Connection health monitoring

#### Database Architecture Features
- **Connection Pooling**: bb8 connection pools per database
- **Streaming Queries**: Cursor-based result fetching for large datasets
- **Type Safety**: Comprehensive value converters for database-specific types
- **Health Monitoring**: Connection state tracking and automatic reconnection
- **Secure Credentials**: Encrypted storage with OS keychain backup

### Frontend Architecture

#### State Management Pattern
- **Zustand Stores**: Located in `src/stores/`
  - `appStore.ts` - Global app state (theme, preferences)
  - Persistent stores use zustand middleware
  - Type-safe with TypeScript interfaces

#### Path Aliases
Configure in both `vite.config.ts` and `tsconfig.json`:
```typescript
"@/*": ["src/*"]
"@components/*": ["src/components/*"] 
"@lib/*": ["src/lib/*"]
"@hooks/*": ["src/hooks/*"]
"@types/*": ["src/types/*"]
"@utils/*": ["src/utils/*"]
```

### Key Development Patterns

#### Database Connection Flow
1. Credentials stored securely via `secure_storage` commands
2. Connection established through `db_connect` with pooling
3. Queries executed with streaming via `db_query_begin`/`db_query_fetch`
4. Health monitoring tracks connection state

#### Query Execution Pattern
- Use `db_query_begin` to start streaming queries
- Fetch results in batches with `db_query_fetch`
- Always call `db_query_close` to cleanup cursors
- Handle cancellation with `db_query_cancel`

#### Security Best Practices
- All sensitive data encrypted at rest using AES-GCM
- OS keychain integration for master key storage
- Automatic key rotation support
- Secure memory handling with zeroization

#### UI Component Guidelines
- Functional components with TypeScript
- Use shadcn/ui components for consistency
- Tailwind classes with `cn()` utility for conditional styling
- Theme support through CSS variables

#### Performance Considerations
- Virtual scrolling for large datasets using TanStack Virtual
- Connection pooling in Rust backend
- Cursor-based streaming for memory efficiency
- Proper cleanup of resources (cursors, connections)

## Development Notes

- Package manager: **pnpm** (not npm/yarn)
- Node.js version: 18+ required
- Rust stable toolchain required
- ESLint configured with strict TypeScript rules
- All database types have comprehensive test seeds in `seeds/` directory
- Docker Compose provides consistent development database environment

## Database Development
Test databases are available via Docker Compose:
- PostgreSQL: `localhost:15432` (user: devuser, pass: devpass123, db: todoapp)
- MySQL: `localhost:13306` (user: devuser, pass: devpass123, db: todoapp)
- SQLite: `seeds/sqlite/todoapp.db`
- SQL Server: `localhost:11433` (user: sa, pass: DevPass123!, db: todoapp)
- Oracle: `localhost:11521` (user: todoapp, pass: DevPass123, service: XE)