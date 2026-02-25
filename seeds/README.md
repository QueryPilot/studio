# Query Pilot - Database Seeds

Test data for Query Pilot development and testing. Covers 7 database systems with consistent schemas across three testing domains.

## Quick Start

```bash
# Ensure Docker containers are running
make docker-up

# Seed all databases
make seed-all

# Or reseed (drop and recreate data)
make reseed-all
```

## Supported Databases

| Database | Seed Command | Connection |
|----------|--------------|------------|
| PostgreSQL | `make seed-postgres` | `localhost:15432` (devuser/devpass123) |
| MySQL | `make seed-mysql` | `localhost:13306` (devuser/devpass123) |
| MariaDB | Uses MySQL seeds | `localhost:13307` (devuser/devpass123) |
| SQL Server | `make seed-sqlserver` | `localhost:11435` (sa/DevPass123) |
| Oracle | `make seed-oracle` | `localhost:11521` (todoapp/DevPass123) |
| SQLite | `make seed-sqlite` | `seeds/sqlite/query_pilot_test.db` |
| MongoDB | Auto-seeds on container start | `localhost:17017` (devuser/devpass123) |
| Redis | `make seed-redis` | `localhost:16379` (devpass123) |

> **Note**: All passwords are for development only. See [Security Note](#security-note) below.

## Testing Domains

Each database contains data across three testing domains:

### 1. E-commerce (Realistic Data)
Complete e-commerce schema with realistic relationships:
- **customers** (20 records) - User accounts with preferences, loyalty points
- **products** (17 records) - Product catalog with pricing, inventory
- **orders** (500 records) - Order history with status, payment info
- **order_items** - Line items with pricing, discounts
- **reviews** - Product ratings and reviews
- **categories** - Hierarchical category tree
- **suppliers** - Vendor information
- **inventory** - Stock levels per warehouse
- **addresses** - Customer shipping/billing addresses

### 2. Edge Cases (Data Type Testing)
Tables designed to test data handling edge cases:
- **all_data_types** - Every data type the database supports
- **null_patterns** - Various null/empty value combinations
- **unicode_samples** - International characters, emoji, RTL text
- **numeric_extremes** - Min/max values, precision edge cases
- **json_documents** - Complex nested JSON structures
- **temporal_data** - Date/time edge cases (PostgreSQL)
- **geometric_data** - Spatial types (PostgreSQL)
- **network_data** - IP/MAC addresses (PostgreSQL)

### 3. Scale Testing (Performance)
Large datasets for pagination and performance testing:
- **large_table** (100,000 rows) - Bulk data for pagination testing
- **wide_table** (100 rows, 50 columns) - Horizontal scroll testing
- **empty_table** - Zero rows (edge case)
- **single_row_table** - Single row (edge case)

## Directory Structure

```
seeds/
├── postgres/
│   ├── 01_schema.sql          # Full schema with partitions, views, functions
│   ├── 02_seed_data.sql       # All test data
│   └── optional/              # Simplified alternatives
├── mysql/
│   ├── 01_schema.sql          # MySQL-specific schema
│   └── 02_seed_data.sql       # MySQL seed data
├── mariadb/
│   ├── 01_schema.sql          # MariaDB schema (MySQL-compatible)
│   └── 02_seed_data.sql       # MariaDB seed data
├── sqlserver/
│   ├── 01_schema.sql          # SQL Server with partition schemes
│   ├── 02_seed_data.sql       # SQL Server seed data
│   └── 03_advanced_types.sql  # SQL Server-specific types
├── oracle/
│   ├── setup.sql              # User/schema setup (run first)
│   ├── 01_schema.sql          # Full Oracle schema
│   ├── 01_schema_simple.sql   # Simplified schema (faster)
│   ├── 02_seed_data.sql       # Full seed data
│   └── 02_seed_data_simple.sql # Simplified seed data
├── sqlite/
│   ├── seed_sqlite.py         # Python seeder (creates query_pilot_test.db)
│   └── query_pilot_test.db    # Generated SQLite database (gitignored)
├── mongodb/
│   ├── 00_create_user.js      # User creation (auto-runs on container start)
│   └── 01_init_todoapp.js     # Full MongoDB seed with BSON types
├── redis/
│   └── seed_redis.sh          # Comprehensive Redis data structures
├── generate_data.py           # Bulk data generator (requires Faker)
├── bulk_seed_postgres.py      # 100K record bulk loader
└── README.md                  # This file
```

## Database-Specific Features

### PostgreSQL
- **Partitioning**: Orders table partitioned by year (2023-2027+)
- **Extensions**: uuid-ossp, hstore, pg_trgm
- **Custom Types**: ENUMs for order_status, payment_method, address_type
- **Full-Text Search**: tsvector/tsquery with GIN indexes
- **Materialized Views**: Product sales summary, customer lifetime value
- **Stored Procedures**: Order processing, inventory restocking
- **Triggers**: Audit logging, timestamp updates, rating calculations

### MySQL/MariaDB
- Native JSON support
- ENUM types for constrained values
- Stored procedures and functions
- Update triggers

### SQL Server
- Partition functions and schemes
- UNIQUEIDENTIFIER for UUIDs
- NVARCHAR for Unicode support
- Advanced spatial types

### Oracle
- JSON constraints on CLOB columns
- Identity columns with GENERATED BY DEFAULT
- PL/SQL procedures

### SQLite
- FTS5 virtual table for full-text search
- JSON1 extension functions
- Comprehensive triggers
- Views for common queries

### MongoDB
- Full BSON type demonstration
- Embedded documents (addresses in customers)
- Text indexes for search
- Aggregation-friendly schema

### Redis
All Redis data structures demonstrated:
- **Strings**: Sessions, config, cache, counters
- **Hashes**: Customer/product/order details
- **Lists**: Queues, activity feeds, logs
- **Sets**: Tags, wishlists, permissions
- **Sorted Sets**: Rankings, leaderboards, schedules
- **Streams**: Event sourcing (orders, inventory)
- **HyperLogLog**: Unique visitor counting
- **Bitmaps**: Feature flags, daily active users

## Bulk Data Generation

For testing with larger datasets, use the bulk data generator:

### Prerequisites
```bash
# Create virtual environment (one-time setup)
cd seeds
python3 -m venv bulk_seed_venv
source bulk_seed_venv/bin/activate
pip install faker
```

### Usage
```bash
# Generate users
python generate_data.py --database postgres --table users --count 10000 --output users.csv

# Generate todos
python generate_data.py --database postgres --table todos --count 80000 --output todos.csv --users 10000

# Generate categories
python generate_data.py --database postgres --table categories --count 10000 --output categories.csv --users 10000
```

### Output Formats
- `--format csv` (default) - CSV file
- `--format jsonl` - JSON Lines (one JSON object per line)
- `--format sql` - SQL INSERT statements

### Bulk Load into PostgreSQL
```bash
# Uses the virtual environment and generates 100K total records
python bulk_seed_postgres.py
```

## Data Volumes

| Table/Collection | PostgreSQL | SQLite | MongoDB | Redis |
|------------------|------------|--------|---------|-------|
| customers | 20 | 20 | 5 | 6 hashes |
| products | 17 | 17 | 4 | 5 hashes |
| orders | 500 | 500 | 100 | 4 hashes |
| reviews | ~18 | 200 | 5 | - |
| large_table | 100,000 | 100,000 | 100,000 | 1,000 list items |
| wide_table | 100 | 100 | - | - |
| unicode_samples | 26 | 12 | 9 | ~10 keys |

## Security Note

All passwords in seed files are **development-only credentials**:

| Credential | Value | Used In |
|------------|-------|---------|
| devuser password | `devpass123` | PostgreSQL, MySQL, MariaDB, MongoDB |
| sa password | `DevPass123` | SQL Server |
| todoapp password | `DevPass123` | Oracle |
| Redis password | `devpass123` | Redis |
| Password hash | `$2b$12$LQv3c1yqBwEHbNkZxK7Uru` | Customer records (bcrypt placeholder) |

**Never use these credentials in production!**

These are intentionally simple for development convenience. The bcrypt hash in customer records is a valid hash but represents a placeholder password, not a real credential.

## Troubleshooting

### Oracle seeding fails
Oracle may require manual setup for complex schemas:
```bash
# Run setup first
docker exec -i query-pilot-oracle sqlplus -s system/DevPass123@localhost:1521/XE < seeds/oracle/setup.sql

# Then run schema and data
docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/01_schema.sql
docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/02_seed_data.sql
```

Or use the simplified versions:
```bash
docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/01_schema_simple.sql
docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/02_seed_data_simple.sql
```

### MongoDB not seeding
MongoDB auto-seeds via init scripts in docker-compose. To manually re-seed:
```bash
docker exec -i query-pilot-mongodb mongosh -u devuser -p devpass123 --authenticationDatabase admin todoapp < seeds/mongodb/01_init_todoapp.js
```

### SQLite database missing
The SQLite database is generated, not committed:
```bash
cd seeds/sqlite
python3 seed_sqlite.py
```

### Bulk seeder fails with "faker not found"
Set up the virtual environment:
```bash
cd seeds
python3 -m venv bulk_seed_venv
source bulk_seed_venv/bin/activate
pip install faker
```

## Related Documentation

- [Dev Database Setup](../docs/llm-context/dev-database-setup.md) - Docker container setup
- [Adding New Databases](../docs/guides/CONTRIBUTING_DB.md) - Database adapter guide
- [Testing](../docs/llm-context/testing.md) - Running tests with seed data
