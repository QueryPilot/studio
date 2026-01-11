# Documentation Reorganization & Standardization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up the `docs/` directory by archiving old files, creating a clear structure (`architecture`, `guides`, `specs`), and writing a "Gold Standard" contribution guide for database adapters.

**Architecture:** Restructure documentation into clear categories. Create a centralized `CONTRIBUTING_DB.md` that bridges frontend and backend adapter requirements.

**Tech Stack:** Markdown.

---

### Task 1: Create New Directory Structure

**Files:**
- Create directories:
    - `docs/architecture/`
    - `docs/guides/`
    - `docs/specs/`
    - `docs/archive/plans/`
    - `docs/archive/fixes/`

**Step 1: Create directories**
```bash
mkdir -p docs/architecture
mkdir -p docs/guides
mkdir -p docs/specs
mkdir -p docs/archive/plans
mkdir -p docs/archive/fixes
```

**Step 2: Commit**
```bash
git add docs/
git commit -m "docs: create new documentation structure"
```

---

### Task 2: Migrate and Rename Existing Files

**Files:**
- Move: `docs/api.spec.md` -> `docs/architecture/backend-api.md` (will rewrite later)
- Move: `docs/query-execution-architecture.md` -> `docs/architecture/query-execution.md`
- Move: `docs/workbench.spec.md` -> `docs/architecture/workbench-layout.md`
- Move: `docs/RELEASE_GUIDE.md` -> `docs/guides/release-guide.md`
- Move: `docs/STUDIO_APP_SETUP.md` -> `docs/guides/setup.md`
- Move: `docs/ssh-and-ssm-user-guide.md` -> `docs/guides/ssh-tunnels.md`
- Move: `docs/ai-assistant.spec.md` -> `docs/specs/ai-features.md`
- Move: `docs/dbml-syntax-support.md` -> `docs/specs/dbml-support.md`
- Move: `docs/erd-panel.spec.md` -> `docs/specs/erd-panel.md`
- Archive: `docs/plans/*` -> `docs/archive/plans/`
- Archive: `docs/fixes/*` -> `docs/archive/fixes/`
- Archive: `docs/workspace-screen.spec.md` -> `docs/archive/workspace-screen-old.md` (seems like older spec)
- Archive: `docs/SQL_REFACTORING_TESTING_GUIDE.md` -> `docs/archive/sql-refactoring-testing.md`
- Archive: `docs/CONNECTION_OPTIONS.md` -> `docs/archive/connection-options.md`

**Step 1: Move Architecture files**
```bash
mv docs/api.spec.md docs/architecture/backend-api.md
mv docs/query-execution-architecture.md docs/architecture/query-execution.md
mv docs/workbench.spec.md docs/architecture/workbench-layout.md
```

**Step 2: Move Guide files**
```bash
mv docs/RELEASE_GUIDE.md docs/guides/release-guide.md
mv docs/STUDIO_APP_SETUP.md docs/guides/setup.md
mv docs/ssh-and-ssm-user-guide.md docs/guides/ssh-tunnels.md
```

**Step 3: Move Spec files**
```bash
mv docs/ai-assistant.spec.md docs/specs/ai-features.md
mv docs/dbml-syntax-support.md docs/specs/dbml-support.md
mv docs/erd-panel.spec.md docs/specs/erd-panel.md
```

**Step 4: Archive old content**
```bash
# Move plans content (if directory not empty)
# Note: mv docs/plans/* will fail if empty, but we know it has content
mv docs/plans/* docs/archive/plans/
rmdir docs/plans

# Move fixes content
mv docs/fixes/* docs/archive/fixes/
rmdir docs/fixes

# Archive scattered root files
mv docs/workspace-screen.spec.md docs/archive/workspace-screen-old.md
mv docs/SQL_REFACTORING_TESTING_GUIDE.md docs/archive/sql-refactoring-testing.md
mv docs/CONNECTION_OPTIONS.md docs/archive/connection-options.md
```

**Step 5: Commit**
```bash
git add docs/
git commit -m "docs: migrate and rename files to new structure"
```

---

### Task 3: Write CONTRIBUTING_DB.md (The Gold Standard)

**Files:**
- Create: `docs/guides/CONTRIBUTING_DB.md`

**Step 1: Write the guide**
Write the following content to `docs/guides/CONTRIBUTING_DB.md`:

```markdown
# Adding New Database Adapters

This guide outlines the "Gold Standard" process for adding support for a new database (e.g., Oracle, Snowflake, Redis) to Query Pilot.

Query Pilot uses a **Split-Brain Adapter Pattern**:
1.  **Frontend (`SqlAdapter`):** The "Brain". Handles SQL generation, introspection queries, and DDL.
2.  **Backend (`DbAdapter`):** The "Muscle". Handles connection lifecycle, execution, and high-performance streaming.

---

## Part 1: Frontend Implementation (The Brain)

**Location:** `src/adapters/dialects/<DbName>Adapter.ts`

The Frontend adapter is the Source of Truth for "how to talk to the database".

### 1. Create the Adapter Class
Implement the `SqlAdapter` interface (from `src/adapters/base/SqlAdapter.ts`).

```typescript
import { SqlAdapter } from '../base/SqlAdapter';

export class OracleAdapter implements SqlAdapter {
  // ... implementation
}
```

### 2. Implement Core Methods

#### Metadata Queries (Introspection)
You must implement queries that return standard system catalog info:
*   `getTablesQuery(schema)`: Returns `table_name`, `table_schema`, `table_type`.
*   `getColumnsQuery(schema, table)`: Returns `column_name`, `data_type`, `is_nullable`.
*   `getIndexesQuery(...)`: Returns index definitions.

#### Data Manipulation (DML)
*   `buildSelect(...)`: Generate SELECT statements with LIMIT/OFFSET.
*   `buildInsert(...)`: Generate INSERT with `RETURNING` support if available.

#### Data Definition (DDL)
*   `addColumn(...)`: `ALTER TABLE ... ADD COLUMN ...`
*   `createTable(...)`: `CREATE TABLE ...`

### 3. Register the Adapter
Add your adapter to the registry in `src/adapters/index.ts` (or `adapterRegistry.ts`).

```typescript
export const getAdapter = (dbType: DbType): SqlAdapter => {
  switch (dbType) {
    case 'oracle': return new OracleAdapter();
    // ...
  }
};
```

---

## Part 2: Backend Implementation (The Muscle)

**Location:** `src-tauri/src/adapters/<dbname>/`

The Backend adapter handles the raw TCP connection and binary data transfer.

### 1. Structure
Create a new module directory:
```
src-tauri/src/adapters/oracle/
├── mod.rs              # Public exports
├── adapter.rs          # The DbAdapter implementation
├── types.rs            # Type mapping (Oracle -> CellValue)
└── direct_msgpack.rs   # Streaming encoder
```

### 2. Implement `DbAdapter` Trait
Implement `src-tauri/src/adapters/mod.rs::DbAdapter`.

```rust
#[async_trait]
impl DbAdapter for OracleAdapter {
    async fn connect(&mut self, profile: &ConnectionProfile) -> Result<()> {
        // Establish connection
    }

    async fn execute(&self, sql: &str) -> Result<u64> {
        // Run simple query
    }
    
    // ...
}
```

### 3. Type Mapping (`types.rs`)
Map database-specific types to Query Pilot's `CellValueType`.

```rust
pub fn map_type(oracle_type: &OracleType) -> CellValueType {
    match oracle_type {
        OracleType::Varchar2 => CellValueType::Text,
        OracleType::Number => CellValueType::Decimal,
        // ...
    }
}
```

### 4. High-Performance Streaming (`direct_msgpack.rs`)
Implement the `DirectMsgPackEncoder` for your database. This is critical for DataGrid performance.
*   It must take a raw row from the driver.
*   It must serialize it directly to MessagePack bytes **without** intermediate allocations.

### 5. Register in Factory
Update `src-tauri/src/connection_manager.rs` to initialize your adapter.

---

## Checklist for Reviewers

- [ ] **Frontend:** `getTablesQuery` returns correct columns?
- [ ] **Frontend:** DDL generation matches database syntax?
- [ ] **Backend:** `connect` handles SSL/TLS correctly?
- [ ] **Backend:** `DirectMsgPackEncoder` implemented for fast streaming?
- [ ] **Integration:** Can we browse tables in the UI?
- [ ] **Integration:** Can we run a `SELECT *` query?
```

**Step 2: Commit**
```bash
git add docs/guides/CONTRIBUTING_DB.md
git commit -m "docs: add CONTRIBUTING_DB guide"
```

---

### Task 4: Clean up Root README

**Files:**
- Modify: `docs/README.md`

**Step 1: Update README content**
Update `docs/README.md` to point to the new structure:

```markdown
# Query Pilot Documentation

## Architecture
Deep dives into system internals.
- [Backend API](./architecture/backend-api.md)
- [Query Execution](./architecture/query-execution.md)
- [Workbench Layout](./architecture/workbench-layout.md)

## Guides
How-to documentation for developers and users.
- [Adding New Databases](./guides/CONTRIBUTING_DB.md) (**Start Here for Contributors**)
- [Setup & Install](./guides/setup.md)
- [Release Guide](./guides/release-guide.md)
- [SSH Tunnels](./guides/ssh-tunnels.md)

## Specifications
Feature specifications and designs.
- [AI Features](./specs/ai-features.md)
- [DBML Support](./specs/dbml-support.md)
- [ERD Panel](./specs/erd-panel.md)

## Archive
Old plans and designs, kept for historical reference.
- [Plans](./archive/plans/)
- [Fixes](./archive/fixes/)
```

**Step 2: Commit**
```bash
git add docs/README.md
git commit -m "docs: update root documentation index"
```

---
