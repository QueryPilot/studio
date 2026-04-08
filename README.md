# Query Pilot

<p align="center">
  <img src="https://github.com/QueryPilot/studio/raw/master/assets/logo.png" width="120" alt="Query Pilot Logo">
</p>

<p align="center"><em>Minimal. Fast. Cost saving. A database client that fits your workflow.</em></p>
<p align="center">Local-first. Multi-database. No limits. No Extra Cost.</p>

<p align="center">
  <a href="https://github.com/QueryPilot/studio/releases/latest">
    <img src="https://img.shields.io/github/v/release/QueryPilot/studio?include_prereleases&style=for-the-badge" alt="Latest Release">
  </a>
  <a href="https://github.com/QueryPilot/studio/releases">
    <img src="https://img.shields.io/github/downloads/QueryPilot/studio/total?style=for-the-badge" alt="Downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge" alt="License">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=for-the-badge" alt="Platform">
</p>

<p align="center">
  <img src="https://github.com/QueryPilot/studio/raw/master/assets/preview.png" alt="Query Pilot Preview" width="100%">
</p>

> **Beta** — Under active development. Frequent updates, occasional rough edges. [Report issues here.](https://github.com/QueryPilot/studio/issues/new?template=bug_report.md)

---

I built Query Pilot because I couldn't find a database client that worked the way I wanted. Most tools out there are either expensive, way too limited on free tiers, or just missing the things I actually need when debugging production databases day to day.

No existing database client deeply integrates Claude Code or Codex CLI either — so Query Pilot uses them as built-in AI agent runtimes, alongside bring-your-own-key support for other providers.

---

## Why Query Pilot?

- **No extra AI costs** — Uses Claude Code and Codex CLI as AI runtimes directly inside the app. No separate API bills — if you already have Claude Code or Codex, your AI-powered database workflows are covered.
- **Multi-connection workspaces** — Open multiple database connections side by side in a single workspace. Compare data across PostgreSQL, MySQL, MongoDB, and more without switching windows.
- **100% local** — Your data never leaves your machine. Credentials stored in the OS keychain. No cloud. Telemetry off by default.
- **Native speed** — Rust backend with sub-second startup. Handles 100k+ row tables without breaking a sweat.

---

## Supported Databases

|                                                                                                                           | Query Editor | Data Grid | Table Designer | ERD | Visual EXPLAIN | Backup | SSH Tunnel | AI Assistant |
| ------------------------------------------------------------------------------------------------------------------------- | :----------: | :-------: | :------------: | :-: | :------------: | :----: | :--------: | :----------: |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/postgresql-icon.svg" height="16"> **PostgreSQL**   |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/mysql-icon.svg" height="16"> **MySQL**             |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/mariadb-icon.svg" height="16"> **MariaDB**         |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/sqlite-icon.svg" height="16"> **SQLite**           |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ❌     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/mssql-server-logo.svg" height="16"> **SQL Server** |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/oracle-icon.svg" height="16"> **Oracle**           |      ✅      |    ✅     |       ✅       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/trino-icon.svg" height="16"> **Trino**             |      ✅      |    ✅     |       ❌       | ✅  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/duckdb-logo.svg" height="16"> **DuckDB**           |      ✅      |    👁️     |       ⚠️       | ✅  |       ✅       |   🕐   |     ❌     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/mongodb-icon.svg" height="16"> **MongoDB**         |      ✅      |    ✅     |       ✅       | ❌  |       ✅       |   🕐   |     ✅     |      ✅      |
| <img src="https://github.com/QueryPilot/studio/raw/master/public/logos/redis-icon.svg" height="16"> **Redis**             |      ✅      |    ✅     |       ❌       | ❌  |       ❌       |   🕐   |     ✅     |      ⚠️      |

✅ Full support &nbsp; 👁️ Read-only &nbsp; ⚠️ Partial &nbsp; 🕐 Coming soon &nbsp; ❌ Not supported

---

## Features

### Multi-Connection Workspaces

Create named workspaces with multiple database connections open simultaneously. Each workspace persists its layout, tabs, and state across sessions. Open separate windows per workspace, each with independent panels and editors.

### AI Assistant — Zero Extra Cost

Use **Claude Code** and **Codex CLI** directly from the app as AI agent runtimes — no separate API keys or usage fees required. Generate SQL from natural language, get query explanations, explore schemas conversationally, and execute AI-suggested queries with permission gating.

Also supports bring-your-own-key with **OpenAI**, **Anthropic**, **Google**, **Mistral**, and **local models via Ollama**. Configure temperature, system prompts, and model selection per provider. Attach table context and images to conversations.

### Excel-Like Data Grid

Inline cell editing with full undo/redo. Multi-cell selection with aggregate statistics (sum, avg, min, max, unique count). Fill down/right for bulk edits. Column-level regex filtering. Edit tables even without primary keys. Type-aware cell renderers for JSON, dates, UUIDs, geometry, enums, booleans, and more.

Pin multiple result grids side by side — compare query outputs, validate JOINs, or monitor tables without switching tabs.

### ER Diagrams

Auto-generated entity-relationship diagrams with foreign key connections. Export to DBML or Mermaid format. Pan, zoom, and interactively explore relationships across your schema.

### Embedded Foreign Keys

Define virtual FK relationships on tables that lack formal constraints. Referenced values from related tables are embedded directly into the grid as extra columns via automatic LEFT JOIN queries — see the actual data behind foreign key IDs, not just the IDs themselves. Invaluable for debugging production data.

### Query Editor

CodeMirror 6 with schema-aware autocomplete, real-time SQL linting, syntax highlighting, and query formatting. Multi-dialect support (PostgreSQL, MySQL, T-SQL, MongoDB). Unlimited tabs — each with its own editor and result grid. Extract CTE dialog, find & replace, and customizable keybindings.

### Visual EXPLAIN

Interactive query plan trees with cost breakdowns, row estimates vs actuals, and buffer statistics. Multi-dialect EXPLAIN parsing. Spot performance bottlenecks at a glance.

### Cell Inspector

Three-tab inspector panel for any selected cell or row. Tree view with expandable nodes, inline editing, and search. Raw view with pretty-printed JSON. Diff view for character-level comparison across multiple selected rows.

### Table Explorer

Browse structure, indexes, triggers, partitions, and column definitions from a single tabbed interface. View row counts, table sizes, and column metadata. Edit constraints, defaults, and comments inline.

### Table Designer

Visual CREATE TABLE builder — configure columns, types, nullable flags, defaults, constraints, primary keys, and foreign keys without writing SQL. MongoDB collection designer with schema validation, time-series, and capped collection options.

### SSH Tunneling

Connect through bastion hosts with key-based auth, SSH agent forwarding, and automatic `~/.ssh/config` resolution. Rate-limited port allocation for production network setups.

### Safety Modes

Four protection levels per connection — from strict read-only to full access — enforced at the backend. Prevent accidental `DROP` or `DELETE` on production.

### Data Export

Export query results or entire tables to CSV, JSON, SQL INSERT, and Markdown. Configurable delimiters, batch INSERT generation, and timestamped filenames. Export schema definitions as DDL scripts.

### Query History & Saved Queries

Persistent, searchable query history across all connections. Save frequently-used queries to a library for instant re-execution. Access everything from the command palette (<kbd>Cmd</kbd>+<kbd>K</kbd>).

### Query Timing & Statistics

Planning time, execution time, total time, and plan buffer hits displayed for every query. Built-in performance awareness for every statement you run.

### MongoDB Shell & Redis CLI

Dedicated query panels for MongoDB (aggregation pipelines, BSON types) and Redis (all data structures, key browsing). Native experiences — not SQL wrappers.

### Themes & Appearance

Light, dark, and system-following themes. Adjustable UI zoom (80–150%). Modern UI built with shadcn/ui and Tailwind CSS.

### Security

Credentials stored in the OS keychain. Encrypted vault for API keys. SSH key management. No data sent to external servers. Optional error reporting (Sentry) with no SQL, credentials, or user data included.

---

## Download

Download the latest release from [Releases](https://github.com/QueryPilot/studio/releases/latest).

### macOS

Supports both **Intel** and **Apple Silicon**.

1. Download the `.dmg` for your architecture
2. Open the `.dmg` and drag Query Pilot to **Applications**
3. On first launch, right-click the app and select **Open** if macOS shows a security warning

### Windows

Download the `-setup.exe` installer and run it.

### Linux

Download the `.AppImage`, `.deb`, or `.rpm` package for your distribution.

---

## Links

- [Report a Bug](https://github.com/QueryPilot/studio/issues/new?template=bug_report.md)
- [Request a Feature](https://github.com/QueryPilot/studio/issues/new?template=feature_request.md)
- [Discussions](https://github.com/QueryPilot/studio/discussions)

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Tauri 2, Rust
- **State**: Zustand
- **Editor**: CodeMirror 6
- **Build Tool**: Vite
- **Package Manager**: pnpm

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v8 or higher)
- [Rust](https://www.rust-lang.org/) (latest stable)
- [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
make dev

# Run tests
make test

# Lint frontend
pnpm lint

# Type check
pnpm typecheck

# Lint backend
cd src-tauri && cargo clippy
```

Refer to the [Makefile](Makefile) for the full list of targets.

## Project Structure

```
studio/
├── src/                    # React frontend
│   ├── adapters/           # Database-specific UI adapters
│   ├── components/         # Shared UI components
│   ├── screens/            # App screens (home, workspace, …)
│   ├── services/           # Tauri IPC and backend services
│   └── stores/             # Zustand state stores
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── adapters/       # Database adapter implementations
│   │   ├── acp/            # AI agent runtime (ACP protocol)
│   │   ├── commands/       # Tauri IPC command handlers
│   │   └── core/           # Connection pool, vault, SSH
│   └── tauri.conf.json
├── src-mcp-sidecar/        # MCP sidecar for AI agent access
├── docs/                   # Architecture and contributor docs
└── scripts/                # Release and utility scripts
```

## Contributing

Contributions are welcome! Please open an issue first for significant changes.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) or [Cursor](https://cursor.sh/)
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Telemetry & Privacy

Optional error tracking via Sentry — **disabled by default**, opt-in only. No SQL queries, credentials, or user data are ever sent. Toggle in Preferences → Telemetry & Error Reporting.
