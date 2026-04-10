# Database Test Environment Setup

This guide explains how to set up and use the comprehensive database test environment for Query Pilot.

## Overview

The test environment includes:

- **PostgreSQL 16** - With advanced types (JSONB, arrays, full-text search, partitions, materialized views)
- **MySQL 8.3** - With JSON support, spatial types, and stored procedures
- **MariaDB 11** - MySQL-compatible alternative (uses same seeds as MySQL)
- **SQLite** - File-based database with FTS5, views, and triggers
- **SQL Server 2019** - With XML, hierarchyid, spatial types, and partitions
- **Oracle 21c XE** - With CLOB, XMLTYPE, and interval types
- **MongoDB 7** - Document database with all BSON types and aggregation pipelines
- **Redis 7** - Key-value store with all data structures (strings, hashes, lists, sets, sorted sets, streams, HyperLogLog, bitmaps)

## Data Schema

Each database is seeded with a comprehensive **E-Commerce** schema containing three domains:

### 1. E-Commerce Domain (Realistic Data)


| Table       | Rows     | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| customers   | 20       | Realistic customer profiles with names, emails, phones |
| products    | 17       | Tech products (laptops, headphones, watches, etc.)     |
| categories  | 6        | Hierarchical product categories                        |
| suppliers   | 7        | Product suppliers with contact info                    |
| orders      | 100-500  | Order history with multiple statuses                   |
| order_items | 250-1250 | Order line items with quantities and prices            |
| reviews     | 100-200  | Product reviews with ratings                           |
| inventory   | 17       | Stock levels per product                               |
| addresses   | ~40      | Customer shipping/billing addresses                    |


### 2. Edge Cases Domain (Data Type Testing)


| Table            | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| all_data_types   | Every database-specific data type                     |
| null_patterns    | NULL handling patterns (sparse, never-null, all-null) |
| unicode_samples  | International text (Japanese, Chinese, Arabic, emoji) |
| numeric_extremes | Min/max integers, floats, precision edge cases        |
| json_documents   | Nested JSON, arrays, empty objects                    |


### 3. Scale Test Domain (Performance Testing)


| Table            | Rows    | Purpose                                        |
| ---------------- | ------- | ---------------------------------------------- |
| large_table      | 100,000 | Pagination, sorting, filtering performance     |
| wide_table       | 100     | 50 columns - horizontal scrolling, many fields |
| empty_table      | 0       | Empty state handling                           |
| single_row_table | 1       | Single record display                          |


### Database Objects

Each SQL database includes:

- **5 Views** - Order details, product inventory, customer summary, top sellers, recent orders
- **4-8 Triggers** - Timestamp updates, audit logging, rating calculations
- **4 Stored Procedures** - Order processing, restocking, archival, reporting
- **4 Functions** - Calculations, search, aggregations
- **Partitioned Tables** - Orders partitioned by date (PostgreSQL, MySQL, SQL Server)
- **Multiple Index Types** - B-tree, GIN, full-text, spatial

## Quick Start

```bash
# Start all databases
docker-compose up -d

# Wait for health checks (especially SQL Server ~90s)
docker-compose ps

# Seed SQL Server (manual - no auto-init)
docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "DevPass123" -C -i /seeds/01_schema.sql
docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "DevPass123" -C -i /seeds/02_seed_data.sql

# Seed Redis (manual)
./seeds/redis/seed_redis.sh

# Create SQLite database
cd seeds/sqlite && python3 seed_sqlite.py

# Start the application
make dev
```

## Database Connection Details


| Database   | Host      | Port  | Username | Password   | Database Name                    |
| ---------- | --------- | ----- | -------- | ---------- | -------------------------------- |
| PostgreSQL | localhost | 15432 | devuser  | devpass123 | todoapp                          |
| MySQL      | localhost | 13306 | devuser  | devpass123 | todoapp                          |
| MariaDB    | localhost | 13307 | devuser  | devpass123 | todoapp                          |
| SQLite     | -         | -     | -        | -          | seeds/sqlite/query_pilot_test.db |
| SQL Server | localhost | 11435 | sa       | DevPass123 | master (then switch to todoapp)  |
| Oracle     | localhost | 11521 | system   | DevPass123 | XE (service)                     |
| MongoDB    | localhost | 17017 | devuser  | devpass123 | todoapp                          |
| Redis      | localhost | 16379 | -        | devpass123 | 0 (default)                      |


## Connection Strings

Tip: You can paste most of these into the Connection Form (Paste Config) to auto-fill fields:

- Standard URIs: `postgresql://`, `mysql://`, `mssql://`, `sqlite://`, `mongodb://`, `mongodb+srv://`, `redis://`, `rediss://`
- JDBC URIs: `jdbc:postgresql://`, `jdbc:mysql://`, `jdbc:sqlserver://`
- SQL Server ADO.NET strings: `Server=...;Database=...;User Id=...;Password=...;`
- MySQL DSN: `mysql:host=...;port=...;dbname=...;charset=utf8mb4`
- SQLite file paths and `sqlite::memory:`

### PostgreSQL

```
# Standard connection string
postgresql://devuser:devpass123@localhost:15432/todoapp

# With SSL disabled (for local development)
postgresql://devuser:devpass123@localhost:15432/todoapp?sslmode=disable

# JDBC format
jdbc:postgresql://localhost:15432/todoapp

# psql command line
psql -h localhost -p 15432 -U devuser -d todoapp

# Environment variables
PGHOST=localhost
PGPORT=15432
PGUSER=devuser
PGPASSWORD=devpass123
PGDATABASE=todoapp
```

### MySQL

```
# Standard connection string
mysql://devuser:devpass123@localhost:13306/todoapp

# With charset
mysql://devuser:devpass123@localhost:13306/todoapp?charset=utf8mb4

# JDBC format
jdbc:mysql://localhost:13306/todoapp

# mysql command line
mysql -h localhost -P 13306 -u devuser -pdevpass123 todoapp

# PHP/PDO format
mysql:host=localhost;port=13306;dbname=todoapp;charset=utf8mb4
```

### MariaDB

```
# Standard connection string
mysql://devuser:devpass123@localhost:13307/todoapp

# With charset
mysql://devuser:devpass123@localhost:13307/todoapp?charset=utf8mb4

# JDBC format
jdbc:mariadb://localhost:13307/todoapp

# mariadb command line
mariadb -h localhost -P 13307 -u devuser -pdevpass123 todoapp

# PHP/PDO format
mysql:host=localhost;port=13307;dbname=todoapp;charset=utf8mb4
```

### SQLite

```
# File path (absolute)
/path/to/query-pilot/seeds/sqlite/query_pilot_test.db

# Connection string format
sqlite:///path/to/query-pilot/seeds/sqlite/query_pilot_test.db

# JDBC format
jdbc:sqlite:/path/to/query-pilot/seeds/sqlite/query_pilot_test.db

# In-memory database (for testing)
sqlite::memory:

# Command line
sqlite3 seeds/sqlite/query_pilot_test.db
```

### SQL Server

```
# Standard connection string
Server=localhost,11435;Database=todoapp;User Id=sa;Password=DevPass123;

# With additional options
Server=localhost,11435;Database=todoapp;User Id=sa;Password=DevPass123;TrustServerCertificate=true;

# ADO.NET format
Data Source=localhost,11435;Initial Catalog=todoapp;User ID=sa;Password=DevPass123;

# JDBC format
jdbc:sqlserver://localhost:11435;databaseName=todoapp;user=sa;password=DevPass123;

# sqlcmd command line
sqlcmd -S localhost,11435 -U sa -P "DevPass123" -d todoapp

# Node.js mssql format
mssql://sa:DevPass123@localhost:11435/todoapp
```

### Oracle

```
# Standard connection string (Easy Connect)
system/DevPass123@localhost:11521/XE

# Full connection string
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=11521))(CONNECT_DATA=(SERVICE_NAME=XE)))

# JDBC Thin Driver format
jdbc:oracle:thin:@localhost:11521:XE
jdbc:oracle:thin:system/DevPass123@localhost:11521:XE

# SQLPlus command line
sqlplus system/DevPass123@localhost:11521/XE

# Node.js oracledb format
{
  user: "system",
  password: "DevPass123",
  connectString: "localhost:11521/XE"
}

# TNS format (if using tnsnames.ora)
XE_LOCAL = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=11521))(CONNECT_DATA=(SERVICE_NAME=XE)))
```

### MongoDB

```
# Standard connection string (with authentication)
mongodb://devuser:devpass123@localhost:17017/todoapp?authSource=admin

# Without specifying database (defaults to admin)
mongodb://devuser:devpass123@localhost:17017?authSource=admin

# Atlas SRV (for MongoDB Atlas cloud)
mongodb+srv://user:password@cluster0.abc123.mongodb.net/mydb?retryWrites=true&w=majority

# Replica set
mongodb://host1:27017,host2:27017,host3:27017/mydb?replicaSet=rs0

# With TLS
mongodb://localhost:27017/mydb?tls=true

# mongosh command line
mongosh mongodb://devuser:devpass123@localhost:17017/todoapp?authSource=admin
```

### Redis

```
# Standard connection string (with password)
redis://:devpass123@localhost:16379/0

# Without password (not configured)
redis://localhost:16379/0

# TLS connection
rediss://:devpass123@localhost:16379/0

# Cluster mode (multiple nodes)
redis://:devpass123@host1:16379,:devpass123@host2:16379,:devpass123@host3:16379

# redis-cli command line (with password)
redis-cli -h localhost -p 16379 -a devpass123

# With database selection
redis-cli -h localhost -p 16379 -a devpass123 -n 2

# Warning: Using -a flag is insecure. Use REDISCLI_AUTH environment variable instead:
export REDISCLI_AUTH=devpass123
redis-cli -h localhost -p 16379
```

## Query Pilot Connection Examples

When connecting from Query Pilot, use these settings:

### PostgreSQL Connection

- Host: `localhost`
- Port: `15432`
- Database: `todoapp`
- Username: `devuser`
- Password: `devpass123`
- SSL Mode: `Disable` (for local development)

### MySQL Connection

- Host: `localhost`
- Port: `13306`
- Database: `todoapp`
- Username: `devuser`
- Password: `devpass123`

### MariaDB Connection

- Host: `localhost`
- Port: `13307`
- Database: `todoapp`
- Username: `devuser`
- Password: `devpass123`

### SQLite Connection

- Database Path: `./seeds/sqlite/query_pilot_test.db` (relative to project root)
- Or full path: `/path/to/query-pilot/seeds/sqlite/query_pilot_test.db`

### SQL Server Connection

- Host: `localhost`
- Port: `11435`
- Database: `todoapp`
- Username: `sa`
- Password: `DevPass123`
- Trust Server Certificate: `Yes` (for local development)

### Oracle Connection

- Host: `localhost`
- Port: `11521`
- Service Name: `XE`
- Username: `system`
- Password: `DevPass123`
- **Note**: Oracle requires manual schema setup due to SQLPlus limitations with complex DDL

### MongoDB Connection

- Host: `localhost`
- Port: `17017`
- Database: `todoapp`
- Username: `devuser`
- Password: `devpass123`
- Auth Source: `admin`
- **Note**: For Atlas connections, use `mongodb+srv://` connection strings

### Redis Connection

- Host: `localhost`
- Port: `16379`
- Database: `0` (default, Redis has databases 0-15)
- Password: `devpass123`
- **Note**: For TLS connections, use `rediss://` scheme

## Available Commands

### Docker Management

```bash
docker-compose up -d      # Start all database containers
docker-compose down       # Stop all database containers
docker-compose down -v    # Stop and remove volumes (reset data)
docker-compose ps         # Check container status
docker-compose logs -f    # Follow logs
```

### Database Seeding

```bash
# PostgreSQL, MySQL, MariaDB, MongoDB - Auto-seeded on container start

# SQL Server (manual)
docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "DevPass123" -C -i /seeds/01_schema.sql
docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "DevPass123" -C -i /seeds/02_seed_data.sql

# Redis (manual)
./seeds/redis/seed_redis.sh

# SQLite (manual)
cd seeds/sqlite && python3 seed_sqlite.py
```

## Data Types Showcase

### PostgreSQL

- **Native Types**: UUID, JSONB, arrays, money, inet, tsvector, hstore
- **Custom Types**: ENUMs (order_status, payment_method, address_type)
- **Extensions**: uuid-ossp, hstore, pg_trgm
- **Special**: Partitioned tables, materialized views, GIN indexes

### MySQL

- **JSON Types**: JSON columns for preferences, dimensions, attributes
- **Spatial**: POINT, GEOMETRY types
- **Full-text**: FULLTEXT indexes on products
- **Partitions**: Orders partitioned by RANGE on created_at

### SQLite

- **JSON**: Stored as TEXT with JSON functions
- **FTS5**: Full-text search virtual table for products
- **Triggers**: 8 triggers for timestamps, audit, FTS sync
- **Views**: 5 views for common queries

### SQL Server

- **XML**: XMLTYPE for structured data
- **Spatial**: GEOGRAPHY types for locations
- **Hierarchical**: Categories with parent relationships
- **Partitions**: Orders partitioned by date

### MongoDB

- **BSON Types**: ObjectId, Date, Decimal128, Binary, arrays
- **Embedded Documents**: Addresses, order items nested in documents
- **Aggregation**: Pre-built pipelines for analytics
- **Indexes**: Compound, text, geospatial indexes

### Redis

- **Strings**: Sessions, config, counters, cache with TTL
- **Hashes**: Customer profiles, product details, orders
- **Lists**: Job queues, activity feeds, recent items
- **Sets**: Tags, wishlists, permissions
- **Sorted Sets**: Rankings, leaderboards, schedules
- **Streams**: Event sourcing with consumer groups
- **HyperLogLog**: Unique visitor counting
- **Bitmaps**: Feature flags, daily active users

## E-Commerce Schema

The test data represents a comprehensive e-commerce platform with:

### Customers Table

- Profile information (name, email, phone, date of birth)
- Authentication flags (active, verified)
- Loyalty points and preferences as JSON

### Products Table

- Full product details (SKU, name, description, price, cost)
- Category and supplier relationships
- Ratings, tags, dimensions, weights
- Featured and active flags

### Orders Table

- Customer relationship
- Status workflow (pending → confirmed → processing → shipped → delivered)
- Payment information
- Shipping/billing addresses
- Partitioned by creation date

### Supporting Tables

- Categories (hierarchical with parent_id)
- Suppliers (contact info, ratings)
- Inventory (stock levels, reorder points)
- Reviews (ratings, verified purchase)
- Addresses (billing/shipping)
- Order audit log (status change history)

## Testing Different Data Types

When testing Query Pilot, pay attention to how different data types are:

- Displayed in the data grid (formatting, truncation)
- Edited in cell editors (validation, input types)
- Filtered and sorted (comparison operators)
- Exported/imported (serialization)
- Shown in schema explorer (type icons, constraints)

## Troubleshooting

### Docker Issues

```bash
# Check container status
docker-compose ps

# View logs for a specific service
docker-compose logs postgres
docker-compose logs sqlserver

# Restart a specific service
docker-compose restart sqlserver

# Force recreate containers
docker-compose up -d --force-recreate
```

### SQL Server Specific

SQL Server container takes longer to initialize (up to 90 seconds). If seeding fails:

```bash
# Wait for SQL Server to be ready
docker-compose logs -f sqlserver

# Check if SQL Server is accepting connections
docker exec query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "DevPass123" -C -Q "SELECT 1"
```

### Oracle Specific

Oracle container takes longer to initialize (up to 2 minutes). If issues occur:

```bash
# Check Oracle logs
docker-compose logs oracle

# Connect manually
docker exec -it query-pilot-oracle sqlplus system/DevPass123@//localhost:1521/XE
```

### PostgreSQL/MySQL Auto-Seed Not Running

If changes to seed files aren't reflected:

```bash
# Remove volumes and recreate
docker-compose down -v
docker-compose up -d
```

## Development Tips

1. **Testing Pagination**: large_table has 100K rows for performance testing
2. **Testing Horizontal Scroll**: wide_table has 50 columns
3. **Testing Empty States**: empty_table has 0 rows
4. **Testing Relationships**: Orders have items, customers have addresses
5. **Testing JSON**: Products have dimensions, attributes, images as JSON
6. **Testing Unicode**: unicode_samples has text in 12 languages + emoji
7. **Testing Nulls**: null_patterns shows various NULL scenarios

## Cleanup

```bash
# Stop and remove all containers and volumes
docker-compose down -v

# Remove SQLite database
rm seeds/sqlite/query_pilot_test.db

# Remove any lingering data
docker volume prune

postgresql://postgres.zrrvnaooiflbelrqiiws:tnUkcHCR6SnDYaUE@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
```

