# Developer Setup Guide

This guide describes how to set up the **Query Pilot studio** repository for local development.

## Prerequisites

Ensure you have the following installed:

1.  **Node.js**: v20 or later
2.  **pnpm**: `npm install -g pnpm`
3.  **Rust**: Stable toolchain (`rustup update stable`)
4.  **Tauri CLI**: `cargo install tauri-cli` (optional, as we use `cargo tauri`)

## Quick Start

The project uses a `Makefile` to simplify common commands.

### 1. Install Dependencies

```bash
# Install frontend dependencies
pnpm install

# Install backend dependencies (automatically handled by cargo)
```

### 2. Run Development Server

This command starts both the React frontend and the Rust/Tauri backend in development mode with hot-reloading.

```bash
make dev
```

The application window should appear once the Rust binary finishes compiling.

---

## Testing & Quality

### Frontend (TypeScript)

```bash
# Run ESLint
pnpm lint

# Run Type Checking
pnpm typecheck

# Run Unit Tests (Vitest)
pnpm test:unit
```

### Backend (Rust)

```bash
# Run Clippy (Linter)
cd src-tauri
cargo clippy

# Run Tests
make test-backend
```

---

## Project Structure

*   `src/`: React Frontend (Vite)
*   `src-tauri/`: Rust Backend (Tauri)
*   `src/adapters/`: Frontend SQL Adapters (The "Brain")
*   `src-tauri/src/adapters/`: Backend Database Adapters (The "Muscle")

## Adding a New Dependency

*   **Frontend**: `pnpm add <package>`
*   **Backend**: `cd src-tauri && cargo add <crate>`

## Common Issues

**"Command not found: make"**
If you are on Windows, you may need to install `make` via Chocolatey (`choco install make`) or use the raw commands found in the `Makefile`.
