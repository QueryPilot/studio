# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevDB Studio is a secure desktop database IDE built with Tauri (Rust backend) and React/TypeScript (frontend). It features a modern UI with shadcn/ui components, encrypted credential storage, and supports PostgreSQL, MySQL, SQLite, SQL Server, and Oracle databases with light/dark themes.

## Development Commands

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri:dev
# or
make dev
# or shorthand
make d

# Build for production
pnpm tauri:build
# or
make build

# Frontend only development
pnpm dev

# Linting and type checking
pnpm lint
pnpm typecheck

# Clean build artifacts
make clean

# Docker database management
make docker-up      # Start all database containers
make docker-down    # Stop all database containers
make docker-reset   # Stop, remove volumes, and restart containers
make setup         # Complete setup: start containers and seed all databases

# Database seeding
make seed-all      # Seed all databases
make seed-postgres # Seed PostgreSQL only
make seed-mysql    # Seed MySQL only
make seed-sqlite   # Seed SQLite only
make seed-sqlserver # Seed SQL Server only
make seed-oracle   # Seed Oracle only
```

## Architecture

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Tauri 2, Rust
- **State Management**: Zustand 5
- **Routing**: React Router v7
- **Package Manager**: pnpm
- **Query Library**: TanStack Query v5
- **Virtual Scrolling**: TanStack Virtual v3
- **Forms**: TanStack Form with Zod validation
- **Code Editor**: Monaco Editor
- **Database**: Tauri SQL Plugin
- **Drag & Drop**: DnD Kit (sortable, core, modifiers)
- **Resizable Panels**: react-resizable-panels
- **Date Picker**: react-day-picker
- **Command Palette**: cmdk
- **Notifications**: Sonner

### Project Structure
- `/src/` - React frontend application
  - `/components/ui/` - shadcn/ui components library (Alert, Button, Dialog, etc.)
  - `/components/` - Application components
    - `/DataViewer/` - Data table viewer with virtual scrolling
      - `/components/` - Sub-components (Toolbar, VirtualRow, DetailsPanel, RowContextMenu, ColumnContextMenu, etc.)
      - `DataViewer.tsx` - Main data viewer component
    - `ConnectionDialog.tsx` - Database connection dialog
    - `QueryEditor.tsx` - SQL query editor with Monaco
    - `QueryResults.tsx` - Query results display
    - `QueryWorkspace.tsx` - Query workspace container
  - `/lib/` - Utilities (cn helper, databaseUri parser, utils)
  - `/types/` - TypeScript type definitions
    - `database.ts` - Database-related types (TableInfo, ViewInfo, FunctionInfo, etc.)
  - `/hooks/` - Custom React hooks
    - `useSecureStorageMigration.ts` - Storage migration hook
  - `/screens/workspace/` - Workspace-related screens
    - `/components/` - DatabaseSidebar, EditorPanel, StatusBar, WorkspaceTitleBar, DataPreview
  - `/services/` - Business logic services
    - `secureDatabaseService.ts` - Encrypted database connection management
    - `secureStorage.ts` - Secure credential storage with encryption
    - `queryService.ts` - Query execution and management
    - `windowManager.ts` - Window state management
    - `navigationTransition.ts` - Page transition animations
    - `cacheService.ts` - Table data and schema caching
  - `/stores/` - Zustand state stores
    - `secureConnectionStore.ts` - Secure connection state management
    - `secureQueryStore.ts` - Query history and results
    - `workspaceStore.ts` - Workspace state
    - `workspaceStateStore.ts` - Workspace UI state persistence
    - `editorStore.ts` - Editor preferences
    - `tabsStore.ts` - Tab management
    - `appStore.ts` - Application-level state
    - `uiStore.ts` - UI state (schema selection, row counts, loading states)
    - `queryStore.ts` - Query execution state
  - `/utils/` - Utility functions (clearStorage)
  - `/styles/` - CSS files including workspace.css
- `/src-tauri/` - Rust backend using Tauri
  - `tauri.conf.json` - Tauri configuration (window settings, build config)
  - `CLAUDE.md` - Backend-specific guidelines
- `/src/CLAUDE.md` - Frontend-specific guidelines  
- `/public/` - Static assets
- `/docs/` - Documentation and ADRs
  - `secure-storage-architecture.md` - Encrypted storage design
  - `development-plan.md` - Development roadmap
  - `storage-cleanup-guide.md` - Storage management guide
  - `theme-usage.md` - Theme implementation guide
- `/seeds/` - Database seed files for testing
  - `/postgres/` - PostgreSQL schemas and data
  - `/mysql/` - MySQL schemas and data
  - `/sqlite/` - SQLite database and seeding script
  - `/sqlserver/` - SQL Server schemas and data
  - `/oracle/` - Oracle schemas and data

### Key Features
- **Secure Storage**: AES-GCM encryption for database credentials
- **Multi-database Support**: Connect to PostgreSQL, MySQL, SQLite, SQL Server, and Oracle
- **Query Workspace**: Monaco editor with SQL syntax highlighting and autocomplete
- **Connection Management**: Encrypted credential storage with master password
- **Theme Support**: Light/dark mode with next-themes
- **Resizable Panels**: Using react-resizable-panels for flexible layouts
- **Virtual Scrolling**: Efficient handling of large datasets
- **Data Export**: CSV export functionality

### Security Architecture
- Master password-based encryption using AES-GCM
- PBKDF2 key derivation (100,000 iterations)
- Secure credential storage in Tauri's app data directory
- Memory-safe handling of sensitive data
- No plaintext storage of database credentials

### Key Configuration
- Window uses transparent background with overlay titlebar style
- Custom WorkspaceTitleBar handles window controls and navigation
- Theme switching implemented with next-themes
- ESLint configured with strict TypeScript checks
- Component library using Radix UI primitives with Tailwind styling
- Toast notifications via Sonner
- Virtual scrolling for tables with TanStack Virtual
- Monaco editor with custom theme support

## Common Issues & Solutions

### UI/Layout Issues
- **Table flashing on panel resize**: Always mount ResizablePanelGroup, control size dynamically
- **Column highlights clipping**: Set explicit width on parent containers using total column width
- **Scroll position lost**: Preserve tableContainerRef, avoid unmounting table container
- **Header transparency**: Use `bg-background/95 backdrop-blur` for sticky headers
- **Context menus**: Separate RowContextMenu and ColumnContextMenu components for better organization

### Performance Issues
- **Large dataset lag**: Implement virtual scrolling with TanStack Virtual
- **Selection performance**: Use `useDeferredValue` for expensive state calculations
- **Memory usage**: Window data to max 1000 rows, implement proper cleanup
- **Virtual scrolling**: Use column virtualization for tables with many columns

### State Management
- **Schema not updating**: Check `loadedForConnectionRef` to prevent duplicate loads
- **Selection count wrong**: Use stable row.id instead of virtualRow.index
- **Cache invalidation**: Use `cacheService.invalidateConnection()` when refreshing
- **Query execution**: Track execution time with `uiQueryTime` in UI store

### Testing Database Connections
```
PostgreSQL: localhost:15432 (user: devuser, pass: devpass123, db: todoapp)
MySQL:      localhost:13306 (user: devuser, pass: devpass123, db: todoapp)
SQLite:     seeds/sqlite/todoapp.db
SQL Server: localhost:11433 (user: sa, pass: DevPass123!, db: todoapp)
Oracle:     localhost:11521 (user: todoapp, pass: DevPass123, service: XE)
```

## Code Quality Standards

### ESLint Rules
- **No any types**: Always specify proper TypeScript types
- **Template literal types**: Ensure valid types in template literals
- **React hooks dependencies**: Include all dependencies in dependency arrays
- **Conditional checks**: Remove unnecessary conditionals
- **Safe type usage**: Avoid unsafe member access on any values
- **Optional chaining**: Don't use on non-nullish values