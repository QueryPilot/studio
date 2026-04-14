#!/usr/bin/env bash
# ============================================================================
# Query Pilot — DuckDB Test Database Seeder
# ============================================================================
# Creates two database files:
#   1. seeds/duckdb/test_main.duckdb     — primary test database
#   2. seeds/duckdb/test_attach.duckdb   — secondary for ATTACH testing
#
# Prerequisites: DuckDB CLI (`brew install duckdb` or https://duckdb.org)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAIN_DB="$SCRIPT_DIR/test_main.duckdb"
ATTACH_DB="$SCRIPT_DIR/test_attach.duckdb"

echo "=== DuckDB Test Database Seeder ==="
echo ""

# Check for duckdb CLI
if ! command -v duckdb &>/dev/null; then
  echo "ERROR: duckdb CLI not found."
  echo "Install with:  brew install duckdb"
  echo "Or download:   https://duckdb.org/docs/installation"
  exit 1
fi

echo "DuckDB version: $(duckdb --version)"
echo ""

# ---------------------------------------------------------------------------
# 1. Create main test database
# ---------------------------------------------------------------------------
echo "[1/3] Creating main test database: $MAIN_DB"
rm -f "$MAIN_DB" "$MAIN_DB.wal"

cd "$REPO_ROOT"
duckdb "$MAIN_DB" < seeds/duckdb/seed_duckdb.sql

echo "  Tables created:"
duckdb "$MAIN_DB" -c "
  SELECT table_name, estimated_size
  FROM duckdb_tables()
  WHERE schema_name = 'main'
  ORDER BY table_name;
"

# ---------------------------------------------------------------------------
# 2. Create secondary database for ATTACH testing
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Creating attach-test database: $ATTACH_DB"
rm -f "$ATTACH_DB" "$ATTACH_DB.wal"

duckdb "$ATTACH_DB" -c "
  CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name VARCHAR NOT NULL,
    budget DECIMAL(12, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO departments VALUES
    (1, 'Engineering',  2500000.00, '2024-01-15 09:00:00'),
    (2, 'Marketing',    1200000.00, '2024-02-01 10:30:00'),
    (3, 'Sales',        1800000.00, '2024-01-20 08:45:00'),
    (4, 'Support',       800000.00, '2024-03-10 11:00:00'),
    (5, 'Research',     3200000.00, '2024-04-01 09:15:00');

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    department_id INTEGER REFERENCES departments(id),
    name VARCHAR NOT NULL,
    status VARCHAR DEFAULT 'active',
    start_date DATE,
    budget DECIMAL(10, 2)
  );

  INSERT INTO projects VALUES
    (1, 1, 'Query Pilot v2',     'active',    '2025-01-01', 500000.00),
    (2, 1, 'AI Sidecar',         'active',    '2025-03-01', 300000.00),
    (3, 2, 'Brand Refresh',      'completed', '2024-06-01', 150000.00),
    (4, 3, 'Enterprise Launch',  'active',    '2025-02-15', 400000.00),
    (5, 5, 'DuckDB Integration', 'active',    '2025-04-01', 250000.00);

  SELECT 'attach-test database created: ' || count(*) || ' tables'
  FROM information_schema.tables WHERE table_schema = 'main';
"

# ---------------------------------------------------------------------------
# 3. Create sample export directory
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Creating export test directory"
EXPORT_DIR="$SCRIPT_DIR/test_exports"
mkdir -p "$EXPORT_DIR"
echo "  Export directory: $EXPORT_DIR"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Done ==="
echo ""
echo "Files created:"
echo "  Main DB:    $MAIN_DB  ($(du -h "$MAIN_DB" | cut -f1))"
echo "  Attach DB:  $ATTACH_DB  ($(du -h "$ATTACH_DB" | cut -f1))"
echo "  Export dir:  $EXPORT_DIR"
echo ""
echo "To connect in Query Pilot:"
echo "  1. New Connection → DuckDB"
echo "  2. File path: $MAIN_DB"
echo ""
echo "See seeds/duckdb/TESTING.md for the full test walkthrough."
