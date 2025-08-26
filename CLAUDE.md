# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
```bash
# Start development server
pnpm tauri:dev  # or: make dev, make d

# Frontend only development
pnpm dev

# Build for production
pnpm tauri:build  # or: make build

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Testing & Database Setup
```bash
# Start all database containers
make docker-up

# Complete setup (start containers + seed all databases)
make setup

# Seed individual databases
make seed-postgres
make seed-mysql
make seed-sqlite
make seed-sqlserver

# Run Rust tests
make test         # MSSQL adapter tests
make test-all     # All Rust tests
make test-quick   # Quick connection check
```

### Database Connection Details
- PostgreSQL: `localhost:15432` (user: devuser, pass: devpass123, db: todoapp)
- MySQL: `localhost:13306` (user: devuser, pass: devpass123, db: todoapp)
- SQL Server: `localhost:11434` (user: sa, pass: DevPass123, db: todoapp)
- SQLite: `seeds/sqlite/todoapp.db`

## Architecture Overview

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Tauri 2.0, Rust
- **State Management**: Zustand stores
- **Routing**: React Router v7
- **Data**: Dexie (IndexedDB), TanStack Query

### Project Structure

```
src/
├── components/       # Reusable React components
│   └── ui/          # shadcn/ui components
├── screens/         # Application screens/pages
│   ├── main/        # Landing/connection screen
│   └── workspace/   # Main database workspace
├── services/        # Business logic and API calls
│   ├── databaseService.ts      # Database operations
│   ├── secureStorage.ts        # Secure credential storage
│   └── tableDataService.ts     # Table data operations
├── stores/          # Zustand state management
│   ├── connectionStore.ts      # Connection management
│   ├── schemaStore.ts         # Database schema state
│   └── workspaceScreenStore.ts # Workspace UI state
├── types/           # TypeScript type definitions
└── utils/           # Helper functions

src-tauri/           # Rust backend
├── src/
│   └── adapters/    # Database adapters (postgres, mysql, mssql)
└── tauri.conf.json  # Tauri configuration
```

### Key Architectural Patterns

1. **Database Adapter Pattern**: Each database type (PostgreSQL, MySQL, SQL Server, SQLite) has a dedicated Rust adapter in `src-tauri/src/adapters/`

2. **Secure Storage**: Connection credentials are encrypted and stored using Tauri's secure storage APIs via `secureStorage.ts`

3. **State Management**: Uses Zustand stores for global state:
   - `connectionStore`: Manages database connections
   - `schemaStore`: Caches database schemas
   - `workspaceScreenStore`: Manages workspace UI state (tabs, panels)

4. **Tauri Commands**: Frontend communicates with backend via Tauri commands:
   - `execute_query`: Run SQL queries
   - `get_database_info`: Fetch schema information
   - `test_connection`: Validate database connections

5. **Virtual Scrolling**: Large result sets use TanStack Virtual for performance

6. **Component Structure**: 
   - UI components from shadcn/ui in `components/ui/`
   - Screen-specific components colocated with their screens
   - Shared business components in root `components/`

### Development Workflow

1. **Adding Database Support**: Create adapter in `src-tauri/src/adapters/`, implement trait methods
2. **UI Components**: Use existing shadcn/ui components, follow existing patterns
3. **State Changes**: Update relevant Zustand stores, avoid prop drilling
4. **Type Safety**: Define types in `src/types/`, use TypeScript strict mode
5. **Error Handling**: Use proper error types, display user-friendly messages via toast

### Testing Approach

- Rust tests: Located in `src-tauri/examples/` and run via `cargo test`
- Use docker-compose for database testing environments
- Seed data scripts in `seeds/` directory for each database type