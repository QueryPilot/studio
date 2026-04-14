-- ============================================================================
-- Query Pilot - DuckDB Comprehensive Test Seed
-- ============================================================================
-- Creates a test database with:
--   1. E-commerce tables (from existing parquet/csv/json seed files)
--   2. DuckDB-specific feature test data
--   3. Tables useful for testing new DuckDB features
-- ============================================================================

-- ============================================================================
-- 1. CORE TABLES — Import from seed files
-- ============================================================================

-- E-commerce orders from parquet
CREATE OR REPLACE TABLE ecommerce_orders AS
  SELECT * FROM read_parquet('seeds/duckdb/ecommerce_orders.parquet');

-- Financial transactions from CSV
CREATE OR REPLACE TABLE financial_transactions AS
  SELECT * FROM read_csv_auto('seeds/duckdb/financial_transactions.csv');

-- IoT sensor readings from parquet
CREATE OR REPLACE TABLE iot_sensors AS
  SELECT * FROM read_parquet('seeds/duckdb/iot_sensors.parquet');

-- Employees from CSV
CREATE OR REPLACE TABLE employees AS
  SELECT * FROM read_csv_auto('seeds/duckdb/sample_employees.csv');

-- Products from JSON
CREATE OR REPLACE TABLE products AS
  SELECT * FROM read_json_auto('seeds/duckdb/sample_products.json');

-- Events from JSONL
CREATE OR REPLACE TABLE events AS
  SELECT * FROM read_json_auto('seeds/duckdb/sample_events.jsonl', format='newline_delimited');

-- Weather from parquet
CREATE OR REPLACE TABLE weather AS
  SELECT * FROM read_parquet('seeds/duckdb/sample_weather.parquet');

-- Server logs from JSONL
CREATE OR REPLACE TABLE server_logs AS
  SELECT * FROM read_json_auto('seeds/duckdb/server_logs.jsonl', format='newline_delimited');

-- Web analytics from parquet
CREATE OR REPLACE TABLE web_analytics AS
  SELECT * FROM read_parquet('seeds/duckdb/web_analytics.parquet');


-- ============================================================================
-- 2. DUCKDB-SPECIFIC TEST TABLES
-- ============================================================================

-- All DuckDB data types for type-support testing
CREATE OR REPLACE TABLE all_duckdb_types (
  id              INTEGER PRIMARY KEY,
  col_boolean     BOOLEAN,
  col_tinyint     TINYINT,
  col_smallint    SMALLINT,
  col_integer     INTEGER,
  col_bigint      BIGINT,
  col_utinyint    UTINYINT,
  col_usmallint   USMALLINT,
  col_uinteger    UINTEGER,
  col_ubigint     UBIGINT,
  col_hugeint     HUGEINT,
  col_float       FLOAT,
  col_double      DOUBLE,
  col_decimal     DECIMAL(18, 4),
  col_varchar     VARCHAR,
  col_blob        BLOB,
  col_date        DATE,
  col_time        TIME,
  col_timestamp   TIMESTAMP,
  col_timestamptz TIMESTAMPTZ,
  col_interval    INTERVAL,
  col_uuid        UUID,
  col_json        JSON,
  col_list        INTEGER[],
  col_struct      STRUCT(name VARCHAR, age INTEGER),
  col_map         MAP(VARCHAR, INTEGER),
  col_enum        VARCHAR,
  col_bit         BIT
);

INSERT INTO all_duckdb_types VALUES
  (1, true, 127, 32767, 2147483647, 9223372036854775807,
   255, 65535, 4294967295, 18446744073709551615,
   170141183460469231731687303715884105727,
   3.14, 2.718281828459045,
   12345.6789, 'Hello DuckDB', '\xDEADBEEF'::BLOB,
   '2025-01-15', '14:30:00', '2025-01-15 14:30:00',
   '2025-01-15 14:30:00+00', INTERVAL '2 years 3 months 4 days',
   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   '{"key": "value", "nested": {"arr": [1,2,3]}}',
   [1, 2, 3, 4, 5],
   {'name': 'Alice', 'age': 30},
   MAP {'a': 1, 'b': 2, 'c': 3},
   'active', '10101010'::BIT),
  (2, false, -128, -32768, -2147483648, -9223372036854775808,
   0, 0, 0, 0, -170141183460469231731687303715884105727,
   -0.0, 0.0, 0.0000, '', '\x00'::BLOB,
   '1970-01-01', '00:00:00', '1970-01-01 00:00:00',
   '1970-01-01 00:00:00+00', INTERVAL '0 seconds',
   '00000000-0000-0000-0000-000000000000',
   'null', [], {'name': '', 'age': 0}, MAP {}, '', '0'::BIT),
  (3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL);


-- Large table for progress bar / cancel testing
CREATE OR REPLACE TABLE large_scan_test AS
  SELECT
    i AS id,
    'row_' || i AS label,
    random() AS value,
    CURRENT_TIMESTAMP + INTERVAL (i) SECOND AS ts
  FROM range(1, 500001) t(i);


-- View for testing
CREATE OR REPLACE VIEW v_order_summary AS
  SELECT count(*) AS total_orders FROM ecommerce_orders;


-- ============================================================================
-- 3. EXPORT TEST DATA (small tables for COPY TO testing)
-- ============================================================================

CREATE OR REPLACE TABLE export_test_data AS
  SELECT * FROM employees;


-- ============================================================================
-- 4. SCHEMA FOR ATTACH TESTING (create a second .duckdb file)
-- ============================================================================

-- This is handled by the seed script (seed_duckdb.sh) which creates
-- a second database file for ATTACH testing.


-- Done
SELECT 'DuckDB seed completed: ' || count(*) || ' tables'
FROM information_schema.tables
WHERE table_schema = 'main';
