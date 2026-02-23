# Query Pilot Strategic Roadmap & Positioning Design

**Date:** 2026-02-23
**Status:** Approved

---

## 1. Competitive Landscape Summary

### Key Competitors

| Tool | SQL | Mongo | Redis | Price | Runtime | AI | Active |
|------|-----|-------|-------|-------|---------|----|----|
| DataGrip | 30+ | Yes | Yes | Free non-commercial / $10/mo | JVM | Deep (cloud-only) | Yes |
| DBeaver | Yes | Pro$ | Pro$ | Free / $110/yr Pro | JVM | NL-SQL + Ollama (Pro) | Yes |
| TablePlus | Yes | No | Yes | $79/yr | Native | BYOK plugin | Yes |
| Navicat | Yes | Yes | Yes | $800+/yr | Native | NL-SQL | Yes |
| Beekeeper Studio | Yes | No | Yes | Free GPL / $9/mo | Electron | Multi-model shell | Yes |
| Chat2DB | 24+ | Yes | Yes | Free / $20/mo | Electron | Core product | Yes |
| DbGate | Yes | Yes | Yes | Free OSS | Electron | DB Chat | Yes |
| Galaxy | SQL only | No | No | Free / $20/mo team | Rust engine | Context-aware copilot | Yes |

**Key insight:** No native (non-JVM, non-Electron) tool covers Postgres + MySQL + SQLite + MSSQL + MongoDB + Redis simultaneously. Query Pilot is uniquely positioned here with Tauri.

### Top Competitor Pain Points

- **Performance:** DBeaver 4.7GB RAM, DataGrip 2+GB RAM and 15-30 min schema introspection on large DBs, pgAdmin 100% CPU
- **UI/UX:** DBeaver "Eclipse-era" UI, DataGrip overwhelming, pgAdmin floating windows
- **Pricing:** Navicat $1,299 perpetual, DBeaver NoSQL paywalled at $250/yr

### What QP Already Has (Research Initially Missed)

The initial research marked several features as unknown gaps. Verification against the codebase shows QP already has:

- **EXPLAIN visualization** — Full tree viewer with cost metrics + plan diff/comparison
- **DML safety guardrails** — 4-level Safe Mode system (Read Only → Full Access), per-connection
- **Query formatting** — sql-formatter with multi-dialect support + format-on-paste
- **Saved queries** — Full history + saved queries with names, descriptions, tags, favorites, search
- **AI features** — Full AI panel with streaming chat, NL-to-SQL, query explanation, AI filters, MCP sidecar (7 tools), multi-agent support (Claude Code, Gemini CLI, OpenCode, Codex, Goose)
- **ERD viewer** — DBML support, ReactFlow, PNG/SVG export
- **Data export** — CSV (configurable delimiters) + JSON + database backup/restore

---

## 2. Positioning & Messaging

**Tagline:** "The fast, private, AI-enhanced database IDE"

**One-liner:** Native-speed database IDE for Postgres, MySQL, SQLite, MSSQL, MongoDB, and Redis — with AI that never leaves your machine.

### Competitive Moat (4 Pillars)

| Pillar | What it means | Why competitors can't match |
|--------|--------------|---------------------------|
| **Native performance** | Tauri + Rust backend, ~50MB RAM vs DBeaver's 2-4GB | JVM/Electron tools can't retrofit native performance |
| **Multi-paradigm** | SQL + Document + Key-Value in one app | TablePlus has no MongoDB; DBeaver paywalls NoSQL |
| **Privacy-first AI** | Local Ollama, MCP sidecar, no cloud dependency | DataGrip is cloud-only AI; Chat2DB routes through servers |
| **Fair pricing** | Free core + one-time Pro + optional team sub | Navicat $800/yr, DBeaver $250/yr for NoSQL |

### Pricing Tiers

| Tier | Features | Price |
|------|----------|-------|
| **Free** | All databases, query editor, grid, ERD, history, saved queries, Safe Mode, formatting, EXPLAIN viewer | $0 |
| **Pro** (one-time) | Charts, DuckDB embedded, AI features (Ollama, self-correcting), data import/export, schema documentation | One-time purchase |
| **Team** (subscription) | Cloud sync, shared queries, team workspaces, shared connections | Monthly/yearly subscription |

---

## 3. Feature Roadmap

### Tier 1 — Next 2-3 months (High impact, builds on strengths)

#### 3.1 Quick Charts from Query Results

**What:** After running a query, users can click a "Chart" tab (alongside grid/EXPLAIN tabs) to visualize results as bar, line, pie, area, or scatter charts.

**Why:** Biggest actual gap. Every user who runs `SELECT ... GROUP BY` wants a chart. No competitor in the native/Tauri space does this.

**Design:**
- **Chart library:** Recharts (React-native, lightweight, TypeScript support) — preferred over ECharts for lighter footprint in a native app
- **Auto-detection:** Infer chart type from query result shape — categorical + numeric → bar chart, date + numeric → line chart
- **Scope:** 5 chart types: bar, line, pie, area, scatter. No dashboards or saved charts initially.
- **Tier:** Pro

#### 3.2 Self-Correcting AI Query Generation

**What:** When AI-generated SQL fails, automatically feed the error back to the LLM for correction, up to 3 retry attempts.

**Why:** No mainstream GUI does this. The accuracy gap between first attempt (~70-80%) and after error feedback (~90%+) is substantial.

**Design:**
- **Loop:** Generate → Execute → Error? → Feed error + schema context → Regenerate → Retry (max 3)
- **UI:** Show each attempt in the AI panel with error context. User can stop at any point.
- **Schema context pruning:** Only send relevant tables to the LLM based on entity name matching, not the entire schema
- **Builds on:** Existing ACP/MCP sidecar infrastructure
- **Tier:** Pro

#### 3.3 Local AI with Ollama

**What:** Connect to a local Ollama instance for NL-to-SQL, query explanation, and error diagnosis without cloud API keys.

**Why:** Privacy-first positioning. DBeaver only offers this in Pro ($250/yr). Making it affordable is a major differentiator.

**Design:**
- **Recommended models:** `qwen2.5-coder:7b` (8GB RAM), `codellama:13b`, `deepseek-coder-v2`
- **Configuration:** Settings page with Ollama endpoint URL (default `localhost:11434`), model selection, test connection
- **Graceful fallback:** Clear messaging + install instructions if Ollama not running
- **Tier:** Pro

### Tier 2 — 3-6 months (Blue ocean / differentiation)

#### 3.4 Embedded DuckDB Engine

**What:** Built-in DuckDB instance to query local CSV, Parquet, and JSON files using SQL alongside connected remote databases.

**Why:** Blue ocean — data engineers constantly switch between local files and remote DBs. No GUI tool combines both (Harlequin is terminal-only).

**Design:**
- **UX:** "Local Files" pseudo-connection type. Drag-and-drop or browse files. Files appear as tables in schema browser.
- **Cross-DB:** Initially isolated queries. Cross-DB joins (local file + remote DB) as future premium feature.
- **Implementation:** `duckdb-rs` crate, new adapter alongside existing Postgres/MySQL/etc.
- **Tier:** Pro

#### 3.5 AI Schema Documentation

**What:** Right-click table/column → "Generate Description" → AI analyzes names, types, sample data, FKs → generates human-readable descriptions.

**Why:** Self-improving loop — better docs → better AI context → more accurate NL-to-SQL → more trust. No desktop tool does this.

**Design:**
- **Storage:** Local SQLite metadata store (non-invasive, not in target database)
- **Batch mode:** "Document entire schema" for all tables/columns at once
- **Feedback loop:** Generated descriptions used as AI context for future NL-to-SQL
- **Tier:** Pro

#### 3.6 Data Import (CSV, JSON, Parquet)

**What:** Import files into any connected database with a wizard flow.

**Why:** QP has export but not import. DBeaver's import wizard is one of its most-used features.

**Design:**
- **Wizard:** File selection → Preview (100 rows) → Column mapping (auto-detect + override) → Target table (new or existing) → Confirm → Import with progress
- **Batch size:** Configurable (default 1000 rows), transaction support, progress bar, cancellable
- **Parquet:** Via DuckDB if Feature 3.4 implemented, otherwise `arrow` Rust crate
- **Tier:** Pro

### Tier 3 — 6+ months (Evaluate based on user feedback)

| Feature | Signal to build |
|---------|----------------|
| SQL Notebook mode (markdown + SQL cells + output) | Users request markdown+SQL workflows |
| MongoDB aggregation pipeline builder | MongoDB user base grows significantly |
| Database branching UI (Neon/PlanetScale) | Neon/PlanetScale adoption grows |
| Live query mode (auto-refresh, PG NOTIFY, change streams) | Users need real-time monitoring |
| Git integration for queries | Team tier adoption drives demand |

---

## 4. Competitive Response Plan

**If DataGrip makes free-for-all permanent (not just non-commercial):**
- QP wins on native performance, privacy-first AI, multi-paradigm coverage. JVM can't be fixed.

**If Chat2DB improves its core DB experience:**
- Tauri advantage and local-first AI remain differentiators. China-based infrastructure is a trust concern for some users.

**If TablePlus adds MongoDB:**
- QP differentiates on AI features, charts, DuckDB. TablePlus has no AI story.

---

## 5. Success Metrics

| Feature | Key metric |
|---------|-----------|
| Charts | % of query results viewed as chart (target: 15% of queries) |
| Self-correcting AI | Success rate improvement (target: 80%+ first attempt → 95%+ after correction) |
| Ollama | % of AI users using local model (target: 30%+) |
| DuckDB | Monthly active users querying local files |
| Schema docs | % of schemas with AI-generated documentation |
| Data import | Import operations per month |
