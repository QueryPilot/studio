# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevDB Studio is a desktop database IDE built with Tauri (Rust backend) and React/TypeScript (frontend). It features a modern UI with shadcn/ui components and supports light/dark themes.

## Development Commands

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri:dev
# or
make dev

# Build for production
pnpm tauri:build
# or
make build

# Frontend only development
pnpm dev

# Linting and type checking
pnpm lint
pnpm typecheck
```

## Architecture

### Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui components
- **Backend**: Tauri 2, Rust
- **State Management**: Zustand
- **Routing**: React Router v7
- **Package Manager**: pnpm

### Project Structure
- `/src/` - React frontend application
  - `/components/ui/` - shadcn/ui components library
  - `/components/` - Application components (TitleBar, theme-provider)
  - `/lib/` - Utilities (cn helper for classnames)
- `/src-tauri/` - Rust backend using Tauri
  - `tauri.conf.json` - Tauri configuration (window settings, build config)
- `/public/` - Static assets
- `/docs/` - Documentation and ADRs

### Key Configuration
- Window uses transparent background with overlay titlebar style
- Custom TitleBar component at `/src/components/TitleBar.tsx` handles window dragging
- Theme switching implemented with next-themes
- ESLint configured with strict TypeScript checks
- Component library using Radix UI primitives with Tailwind styling