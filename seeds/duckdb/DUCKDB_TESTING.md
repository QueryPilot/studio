# DuckDB Features — End-to-End Test Guide

Manual test walkthrough for the 15 DuckDB features added in the `feature/duckdb-enhancements` branch.

## Prerequisites

```bash
# Install DuckDB CLI (needed for seeding only)
brew install duckdb

# Seed the test databases
./seeds/duckdb/seed_duckdb.sh

# Start the app
make dev
```

**Files created by the seed script:**


| File                              | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `seeds/duckdb/test_main.duckdb`   | Primary test database (e-commerce, types, large scan) |
| `seeds/duckdb/test_attach.duckdb` | Secondary database for ATTACH testing                 |
| `seeds/duckdb/test_exports/`      | Empty directory for COPY TO output                    |


---

## Connection Setup

1. Open Query Pilot → **New Connection**
2. Select **DuckDB**
3. File path: `<repo>/seeds/duckdb/test_main.duckdb`
4. Name: `DuckDB Test`
5. Click **Connect**

You should see tables: `all_duckdb_types`, `ecommerce_orders`, `employees`, `events`, `export_test_data`, `financial_transactions`, `iot_sensors`, `large_scan_test`, `products`, `server_logs`, `weather`, `web_analytics`.

---

## Feature Tests

### S1: ATTACH Multi-Database Federation

**Where:** Sidebar → Tables dropdown → **Attach Database...**


| #   | Step                                                                                                              | Expected                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Click "Attach Database..."                                                                                        | Dialog opens                                             |
| 2   | Click folder icon → browse to `seeds/duckdb/test_attach.duckdb`                                                   | Path fills in, alias auto-populates to `test_attach`     |
| 3   | Leave type as "Auto-detect", check "Read-only"                                                                    | —                                                        |
| 4   | Click **Attach**                                                                                                  | Toast: "Database attached as test_attach", dialog closes |
| 5   | Run: `SELECT * FROM test_attach.departments`                                                                      | Returns 5 departments                                    |
| 6   | Run: `SELECT d.name, p.name FROM test_attach.departments d JOIN test_attach.projects p ON d.id = p.department_id` | Cross-table join works                                   |
| 7   | Sidebar → Tables dropdown → **Detach** → `test_attach`                                                            | Toast: "Database test_attach detached"                   |
| 8   | Run the SELECT again                                                                                              | Error: catalog "test_attach" does not exist              |


**Edge cases:**

- Try attaching with an invalid alias like `my-db` (has hyphen) → validation error
- Try attaching a non-existent file → backend error in toast
- Attach the Docker PostgreSQL: path = `postgres://devuser:devpass123@localhost:15432/todoapp`, type = POSTGRES (requires `make docker-up`)

---

### S2: Secrets Manager

**Where:** Sidebar → Tables dropdown → **Secrets...**


| #   | Step                                                                           | Expected                                                     |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | Click "Secrets..."                                                             | Secrets panel opens (empty list)                             |
| 2   | Click **Add Secret**                                                           | Create Secret dialog                                         |
| 3   | Select type: **S3**, name: `test_s3`                                           | S3-specific fields appear (Key ID, Secret, Region, Endpoint) |
| 4   | Fill Key ID: `AKIAIOSFODNN7EXAMPLE`, Secret: `wJalr...`, Region: `us-east-1`   | —                                                            |
| 5   | Uncheck "Persistent"                                                           | —                                                            |
| 6   | Click **Create Secret**                                                        | Toast: success, secret appears in list                       |
| 7   | Verify list shows: name=`test_s3`, type=`S3`, provider=`config`, persistent=No | —                                                            |
| 8   | Click delete (trash icon) on `test_s3`                                         | Secret removed from list                                     |


**Edge cases:**

- Create with empty name → validation prevents submit
- Switch between types (GCS, Azure, R2, HuggingFace) → form fields change dynamically
- Create a persistent secret → check "Persistent" → verify it shows `Yes` in list

---

### S3: COPY TO / Data Export

**Where:** Sidebar → Tables dropdown → **Export...**


| #   | Step                                                              | Expected                        |
| --- | ----------------------------------------------------------------- | ------------------------------- |
| 1   | Click "Export..."                                                 | Export dialog opens             |
| 2   | Source: select **Table** → schema: `main`, table: `employees`     | —                               |
| 3   | Format: **CSV**                                                   | CSV options appear              |
| 4   | Destination: `seeds/duckdb/test_exports/employees.csv`            | —                               |
| 5   | Expand "Advanced Options" → check "Include header row"            | —                               |
| 6   | Click **Export**                                                  | Toast: "Exported N rows to ..." |
| 7   | Verify file exists: `cat seeds/duckdb/test_exports/employees.csv` | CSV with headers                |


**Also test:**

- Export as **Parquet** to `seeds/duckdb/test_exports/employees.parquet`
- Export as **JSON** to `seeds/duckdb/test_exports/employees.json`
- Export from a **custom query**: `SELECT * FROM employees WHERE department = 'Engineering'`
- Try exporting with empty destination → validation error

---

### S4: Read-Only Mode


| #   | Step                                                     | Expected                                |
| --- | -------------------------------------------------------- | --------------------------------------- |
| 1   | Create a **new** DuckDB connection to `test_main.duckdb` | —                                       |
| 2   | Check **"Open as read-only"**                            | —                                       |
| 3   | Connect                                                  | Connection succeeds                     |
| 4   | Run: `SELECT count(*) FROM employees`                    | Works normally                          |
| 5   | Run: `CREATE TABLE test_readonly (id INT)`               | Error: cannot execute in read-only mode |
| 6   | Run: `INSERT INTO employees VALUES (...)`                | Error: read-only                        |


---

### A5: MotherDuck First-Class Connection

> **Requires:** A MotherDuck account and token from [app.motherduck.com](https://app.motherduck.com)


| #   | Step                                   | Expected                                   |
| --- | -------------------------------------- | ------------------------------------------ |
| 1   | New Connection → select **MotherDuck** | MotherDuck-specific form with token field  |
| 2   | Paste your MotherDuck token            | —                                          |
| 3   | Optionally enter a database name       | —                                          |
| 4   | Click **Connect**                      | Connects, shows MotherDuck logo in sidebar |
| 5   | Run: `SHOW DATABASES`                  | Lists your MotherDuck databases            |
| 6   | Query cloud tables                     | Works like DuckDB with cloud data          |


**Skip if:** No MotherDuck token available. The UI rendering can still be verified.

---

### A6: DuckDB-Native SQL Autocomplete


| #   | Step                                          | Expected                                                    |
| --- | --------------------------------------------- | ----------------------------------------------------------- |
| 1   | Open a new query tab on the DuckDB connection | —                                                           |
| 2   | Type `SELECT` (with space)                    | Autocomplete popup appears with column/table suggestions    |
| 3   | Type `SELECT * FROM emp`                      | `employees` suggested                                       |
| 4   | Type `SELECT * FROM read`_                    | `read_csv_auto`, `read_parquet`, `read_json_auto` suggested |
| 5   | Accept a suggestion with Tab/Enter            | Suggestion inserted                                         |


**Note:** DuckDB native completions appear alongside the existing schema-based completions.

---

### A7: EXPLAIN / Query Profiling

**Where:** Query toolbar → Run dropdown → **Explain Analyze**


| #   | Step                                                                         | Expected                                        |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Write: `SELECT * FROM large_scan_test WHERE value > 0.5`                     | —                                               |
| 2   | Click Run dropdown → **Explain Analyze**                                     | Query plan panel appears below                  |
| 3   | Check the plan text                                                          | Shows operators (SEQ_SCAN, FILTER) with timings |
| 4   | Check "Total Time"                                                           | Displayed with color coding                     |
| 5   | Click **Copy** button                                                        | Plan text copied to clipboard                   |
| 6   | Try a join: `SELECT e.*, p.* FROM employees e, products p WHERE e.id = p.id` | Shows HASH_JOIN in plan                         |


---

### A8: Extension Manager UI

**Where:** Sidebar → Tables dropdown → **Extensions...**


| #   | Step                                        | Expected                                    |
| --- | ------------------------------------------- | ------------------------------------------- |
| 1   | Click "Extensions..."                       | Extensions panel opens                      |
| 2   | See list of extensions                      | Shows installed/loaded status badges        |
| 3   | Search for "httpfs"                         | Filters to httpfs extension                 |
| 4   | If not installed, click **Install & Load**  | Extension installs and loads, badge updates |
| 5   | If installed but not loaded, click **Load** | Badge changes to "loaded"                   |
| 6   | Look for recommended extensions             | `httpfs`, `json`, `parquet` highlighted     |


---

### A9: Iceberg / Delta Lake / DuckLake Catalog Attach

**Where:** Sidebar → Tables dropdown → **Attach Catalog...**


| #   | Step                                                                                              | Expected                   |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Click "Attach Catalog..."                                                                         | 3-step wizard opens        |
| 2   | **Step 1:** Select **Iceberg**                                                                    | Iceberg card highlighted   |
| 3   | Click **Next**                                                                                    | Step 2: configuration form |
| 4   | Enter alias: `my_iceberg`, URI: `http://localhost:8181`                                           | —                          |
| 5   | Select Catalog Type: REST                                                                         | —                          |
| 6   | Click **Review**                                                                                  | Step 3: SQL preview shown  |
| 7   | Verify SQL: `INSTALL 'iceberg'; LOAD 'iceberg'; ATTACH '...' AS "my_iceberg" (TYPE ICEBERG, ...)` | —                          |


> **Note:** Actually attaching will fail without a real Iceberg catalog. The UI flow and SQL generation can be verified without one. To test for real, set up a local [Nessie](https://projectnessie.org/) or [Tabular](https://tabular.io/) catalog.

**Also test:**

- Switch between Delta Lake and DuckLake in Step 1 → form changes
- Check "Read-only" → appears in SQL preview
- Back button works between steps

---

### A10: DuckDB Preferences / Settings Panel

**Where:** App menu → **Preferences** → **DuckDB** (in sidebar)


| #   | Step                                           | Expected                                              |
| --- | ---------------------------------------------- | ----------------------------------------------------- |
| 1   | Open Preferences → click **DuckDB** in sidebar | DuckDB settings panel appears                         |
| 2   | Click preset: **High Performance**             | Toast: "High Performance preset applied (N settings)" |
| 3   | Expand "Memory" section                        | Shows `memory_limit`, `temp_directory`, etc.          |
| 4   | Edit `memory_limit` → type `4GB` → press Enter | Setting applied                                       |
| 5   | Click reset icon on `memory_limit`             | Reverts to default                                    |
| 6   | Expand "All Settings" at bottom                | Full searchable table of all DuckDB settings          |
| 7   | Search for "threads"                           | Filters to thread-related settings                    |
| 8   | Edit a setting inline → press Enter            | Setting updated                                       |


**Presets to test:**

- **Low Memory** — reduces memory limits
- **High Performance** — increases threads, memory
- **Safe Mode** — restricts external access

---

### B11: Query Progress for Long Scans


| #   | Step                                                               | Expected                                   |
| --- | ------------------------------------------------------------------ | ------------------------------------------ |
| 1   | Run: `SELECT count(*) FROM large_scan_test WHERE value > 0.999999` | —                                          |
| 2   | While running, observe the result area                             | Progress bar shows percentage              |
| 3   | Click **Cancel** button during execution                           | Query interrupted, error message shown     |
| 4   | Run: `SELECT * FROM range(0, 10000000) t(i) WHERE i % 7919 = 0`    | Progress bar fills up over several seconds |


> **Note:** Progress only shows for queries that DuckDB can track. Very fast queries may complete before the progress bar renders.

---

### B12: Database File Encryption


| #   | Step                                                       | Expected                 |
| --- | ---------------------------------------------------------- | ------------------------ |
| 1   | Create a new DuckDB connection                             | —                        |
| 2   | File path: `seeds/duckdb/test_encrypted.duckdb` (new file) | —                        |
| 3   | Enter Encryption Key: `my-test-key-123`                    | —                        |
| 4   | Connect → create a table → insert data                     | Works normally           |
| 5   | Disconnect                                                 | —                        |
| 6   | Reconnect **without** encryption key                       | Error: file is encrypted |
| 7   | Reconnect **with** the same key                            | Connects, data is there  |


> **Note:** Requires DuckDB encryption extension. If it fails with "encryption not available", the extension may need to be installed first via Extensions panel.

---

### B13: VARIANT Type Support


| #   | Step                                                          | Expected                          |
| --- | ------------------------------------------------------------- | --------------------------------- |
| 1   | Run: `SELECT 'hello'::VARIANT, 42::VARIANT, [1,2,3]::VARIANT` | Query succeeds, values displayed  |
| 2   | Check column type in result header                            | Shows as VARIANT or fallback type |


> **Note:** VARIANT support depends on the `duckdb-rs` crate version. The query may work in the DuckDB CLI but show a fallback type in Query Pilot.

---

### B14: Drag-and-Drop File Import


| #   | Step                                          | Expected                                                                     |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Open a query editor for the DuckDB connection | —                                                                            |
| 2   | Open Finder → navigate to `seeds/duckdb/`     | —                                                                            |
| 3   | Drag `sample_employees.csv` onto the editor   | Drop zone highlight appears                                                  |
| 4   | Drop the file                                 | SQL inserted: `SELECT * FROM read_csv_auto('/path/to/sample_employees.csv')` |
| 5   | Run the query                                 | Shows employee data                                                          |
| 6   | Drag `sample_weather.parquet` onto the editor | `SELECT * FROM read_parquet(...)` inserted                                   |
| 7   | Drag a `.txt` file                            | Toast: "Unsupported file type"                                               |


---

### B15: Glob Pattern Helper

**Where:** Sidebar → Tables dropdown → **File Pattern Helper...**


| #   | Step                                          | Expected                                                  |
| --- | --------------------------------------------- | --------------------------------------------------------- |
| 1   | Click "File Pattern Helper..."                | Dialog opens                                              |
| 2   | Click folder icon → browse to `seeds/duckdb/` | Base directory fills in                                   |
| 3   | File type: **Parquet**                        | —                                                         |
| 4   | Check "Recursive"                             | —                                                         |
| 5   | See SQL preview                               | `SELECT * FROM read_parquet('seeds/duckdb/**/*.parquet')` |
| 6   | Click **Insert into Editor**                  | SQL inserted into active editor                           |
| 7   | Run the query                                 | Returns combined data from all parquet files              |
| 8   | Change to **CSV**, uncheck recursive          | Preview updates                                           |
| 9   | Click **Copy SQL**                            | Copies to clipboard                                       |


---

## Cross-Feature Tests

These test interactions between multiple features:

### ATTACH + Export

1. Attach `test_attach.duckdb` as `ext_db`
2. Export → Source = Query: `SELECT * FROM ext_db.departments`
3. Export as CSV → verify output

### ATTACH + EXPLAIN

1. Attach `test_attach.duckdb`
2. Run Explain Analyze on: `SELECT * FROM main.employees e JOIN test_attach.departments d ON e.department = d.name`
3. Verify cross-database join appears in plan

### Read-Only + Safe Mode

1. Connect in read-only mode
2. Try ATTACH → should fail (DDL in read-only)
3. Try export → should succeed (reads only)

### Extensions + Secrets + Export

1. Install `httpfs` extension
2. Create S3 secret with test credentials
3. Try exporting to `s3://test-bucket/output.parquet` (will fail without real S3, but the flow should work up to the actual write)

---

## Cleanup

```bash
# Remove test databases
rm -f seeds/duckdb/test_main.duckdb seeds/duckdb/test_main.duckdb.wal
rm -f seeds/duckdb/test_attach.duckdb seeds/duckdb/test_attach.duckdb.wal
rm -f seeds/duckdb/test_encrypted.duckdb seeds/duckdb/test_encrypted.duckdb.wal
rm -rf seeds/duckdb/test_exports/

# Or re-seed from scratch
./seeds/duckdb/seed_duckdb.sh
```

---

## Test Matrix


| Feature                  | No Docker | Docker (PG) | MotherDuck Token | Iceberg Catalog |
| ------------------------ | --------- | ----------- | ---------------- | --------------- |
| S1: ATTACH (DuckDB file) | **Yes**   | —           | —                | —               |
| S1: ATTACH (Postgres)    | —         | **Yes**     | —                | —               |
| S2: Secrets              | **Yes**   | —           | —                | —               |
| S3: COPY TO              | **Yes**   | —           | —                | —               |
| S4: Read-Only            | **Yes**   | —           | —                | —               |
| A5: MotherDuck           | —         | —           | **Yes**          | —               |
| A6: Autocomplete         | **Yes**   | —           | —                | —               |
| A7: EXPLAIN              | **Yes**   | —           | —                | —               |
| A8: Extensions           | **Yes**   | —           | —                | —               |
| A9: Iceberg/Delta        | —         | —           | —                | **Yes**         |
| A10: Preferences         | **Yes**   | —           | —                | —               |
| B11: Progress            | **Yes**   | —           | —                | —               |
| B12: Encryption          | **Yes**   | —           | —                | —               |
| B13: VARIANT             | **Yes**   | —           | —                | —               |
| B14: Drag & Drop         | **Yes**   | —           | —                | —               |
| B15: Glob Helper         | **Yes**   | —           | —                | —               |


**13 out of 15 features** can be fully tested with just DuckDB (no Docker, no accounts).