# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevDB Studio is a secure desktop database IDE built with Tauri (Rust backend) and React/TypeScript (frontend). It features a modern UI with shadcn/ui components, encrypted credential storage, and supports light/dark themes.

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
```

## Architecture

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Tauri 2, Rust
- **State Management**: Zustand 5
- **Routing**: React Router v7
- **Package Manager**: pnpm
- **Query Library**: TanStack Query v5
- **Forms**: TanStack Form with Zod validation
- **Code Editor**: Monaco Editor
- **Database**: Tauri SQL Plugin

### Project Structure
- `/src/` - React frontend application
  - `/components/ui/` - shadcn/ui components library (Alert, Button, Dialog, etc.)
  - `/components/` - Application components (ConnectionDialog, QueryEditor, QueryResults, QueryWorkspace)
  - `/lib/` - Utilities (cn helper, databaseUri parser, utils)
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
  - `/stores/` - Zustand state stores
    - `secureConnectionStore.ts` - Secure connection state management
    - `secureQueryStore.ts` - Query history and results
    - `workspaceStore.ts` - Workspace state
    - `editorStore.ts` - Editor preferences
    - `tabsStore.ts` - Tab management
    - `appStore.ts` - Application-level state
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

### Key Features
- **Secure Storage**: AES-GCM encryption for database credentials
- **Multi-database Support**: Connect to multiple databases simultaneously
- **Query Workspace**: Monaco editor with SQL syntax highlighting
- **Connection Management**: Encrypted credential storage with master password
- **Theme Support**: Light/dark mode with next-themes
- **Resizable Panels**: Using react-resizable-panels for flexible layouts

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