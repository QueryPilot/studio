# Database Test Environment Setup

This guide explains how to set up and use the comprehensive database test environment for Query Pilot.

## Overview

The test environment includes:

- **PostgreSQL 16** - With advanced types (JSONB, arrays, full-text search, etc.)
- **MySQL 8.3** - With JSON support and spatial types
- **SQLite** - File-based database with comprehensive types
- **SQL Server 2022** - With XML, hierarchyid, and spatial types
- **Oracle 21c XE** - With CLOB, XMLTYPE, and interval types
- **MongoDB 7** - Document database with collections, aggregation pipelines
- **Redis 7** - Key-value store with rich data types (strings, hashes, lists, sets, sorted sets, streams)

Each database is seeded with:

- 100 users
- 50-200 todos per user (randomized)
- Rich data using all available database-specific types
- Comments, activity logs, categories, and relationships

## Quick Start

```bash
# Start all databases and seed with test data
make setup

# Start the application
make dev
```

## Database Connection Details

| Database   | Host      | Port  | Username | Password    | Database Name           |
| ---------- | --------- | ----- | -------- | ----------- | ----------------------- |
| PostgreSQL | localhost | 15432 | devuser  | devpass123  | todoapp                 |
| MySQL      | localhost | 13306 | devuser  | devpass123  | todoapp                 |
| SQLite     | -         | -     | -        | -           | seeds/sqlite/todoapp.db |
| SQL Server | localhost | 11434 | sa       | DevPass123  | todoapp                 |
| Oracle     | localhost | 11521 | todoapp  | DevPass123  | XE (service)            |
| MongoDB    | localhost | 27017 | -        | -           | test                    |
| Redis      | localhost | 6379  | -        | -           | 0 (default)             |

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

### SQLite

```
# File path (absolute)
/path/to/query-pilot/seeds/sqlite/todoapp.db

# Connection string format
sqlite:///path/to/query-pilot/seeds/sqlite/todoapp.db

# JDBC format
jdbc:sqlite:/path/to/query-pilot/seeds/sqlite/todoapp.db

# In-memory database (for testing)
sqlite::memory:

# Command line
sqlite3 seeds/sqlite/todoapp.db
```

### SQL Server

```
# Standard connection string
Server=localhost,11434;Database=todoapp;User Id=sa;Password=DevPass123;

# With additional options
Server=localhost,11434;Database=todoapp;User Id=sa;Password=DevPass123;TrustServerCertificate=true;

# ADO.NET format
Data Source=localhost,11434;Initial Catalog=todoapp;User ID=sa;Password=DevPass123;

# JDBC format
jdbc:sqlserver://localhost:11434;databaseName=todoapp;user=sa;password=DevPass123;

# sqlcmd command line
sqlcmd -S localhost,11434 -U sa -P "DevPass123" -d todoapp

# Node.js mssql format
mssql://sa:DevPass123@localhost:11434/todoapp
```

### Oracle

```
# Standard connection string (Easy Connect)
todoapp/DevPass123@localhost:11521/XE

# Full connection string
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=11521))(CONNECT_DATA=(SERVICE_NAME=XE)))

# JDBC Thin Driver format
jdbc:oracle:thin:@localhost:11521:XE
jdbc:oracle:thin:todoapp/DevPass123@localhost:11521:XE

# SQLPlus command line
sqlplus todoapp/DevPass123@localhost:11521/XE

# Node.js oracledb format
{
  user: "todoapp",
  password: "DevPass123",
  connectString: "localhost:11521/XE"
}

# TNS format (if using tnsnames.ora)
XE_LOCAL = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=11521))(CONNECT_DATA=(SERVICE_NAME=XE)))
```

### MongoDB

```
# Standard connection string
mongodb://localhost:27017/test

# With authentication
mongodb://user:password@localhost:27017/mydb?authSource=admin

# Atlas SRV (for MongoDB Atlas cloud)
mongodb+srv://user:password@cluster0.abc123.mongodb.net/mydb?retryWrites=true&w=majority

# Replica set
mongodb://host1:27017,host2:27017,host3:27017/mydb?replicaSet=rs0

# With TLS
mongodb://localhost:27017/mydb?tls=true

# mongosh command line
mongosh mongodb://localhost:27017/test
```

### Redis

```
# Standard connection string
redis://localhost:6379/0

# With ACL authentication (Redis 6+)
redis://username:password@localhost:6379/0

# With legacy password authentication
redis://:password@localhost:6379/0

# TLS connection
rediss://localhost:6380/0

# Cluster mode (multiple nodes)
redis://host1:6379,host2:6379,host3:6379

# redis-cli command line
redis-cli -h localhost -p 6379

# With database selection
redis-cli -h localhost -p 6379 -n 2
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

### SQLite Connection

- Database Path: `./seeds/sqlite/todoapp.db` (relative to project root)
- Or full path: `/path/to/query-pilot/seeds/sqlite/todoapp.db`

### SQL Server Connection

- Host: `localhost`
- Port: `11434`
- Database: `todoapp`
- Username: `sa`
- Password: `DevPass123`
- Trust Server Certificate: `Yes` (for local development)

### Oracle Connection

- Host: `localhost`
- Port: `11521`
- Service Name: `XE`
- Username: `todoapp`
- Password: `DevPass123`
- **Note**: Oracle requires manual schema setup due to SQL\*Plus limitations with complex DDL

### MongoDB Connection

- Host: `localhost`
- Port: `27017`
- Database: `test`
- Authentication: None (for local development)
- **Note**: For Atlas connections, use `mongodb+srv://` connection strings

### Redis Connection

- Host: `localhost`
- Port: `6379`
- Database: `0` (default, Redis has databases 0-15)
- Authentication: None (for local development)
- **Note**: For TLS connections, use `rediss://` scheme

## Available Commands

### Docker Management

```bash
make docker-up      # Start all database containers
make docker-down    # Stop all database containers
make docker-reset   # Reset containers and volumes
```

### Database Seeding

```bash
make seed-all       # Seed all databases
make seed-postgres  # Seed PostgreSQL only
make seed-mysql     # Seed MySQL only
make seed-sqlite    # Seed SQLite only
make seed-sqlserver # Seed SQL Server only
make seed-oracle    # Seed Oracle only
```

## Data Types Showcase

### PostgreSQL

- **Native Types**: UUID, JSONB, arrays, money, inet, tsvector
- **Custom Types**: ENUMs (todo_status, priority_level)
- **Extensions**: uuid-ossp, pgcrypto, hstore
- **Special**: tstzrange, full-text search indexes

### MySQL

- **JSON Types**: JSON columns for tags, attachments, custom fields
- **Spatial**: POINT, GEOGRAPHY types
- **Sets**: SET type for flags
- **Full-text**: FULLTEXT indexes

### SQLite

- **JSON**: Stored as TEXT with JSON validation
- **Binary**: BLOB for thumbnails
- **Flexible**: Dynamic typing system

### SQL Server

- **XML**: XMLTYPE for structured data
- **Spatial**: GEOGRAPHY, GEOMETRY types
- **Hierarchical**: HIERARCHYID for tree structures
- **Versioning**: ROWVERSION for optimistic locking

### Oracle

- **LOB Types**: CLOB for large text, BLOB for binary
- **XML**: XMLTYPE for XML data
- **Intervals**: DAY TO SECOND, YEAR TO MONTH
- **RAW**: RAW data type for binary data

## Todo App Schema

The test data represents a comprehensive todo application with:

### Users Table

- Profile information (avatar, bio, preferences)
- Authentication flags (active, verified)
- Metadata stored as JSON

### Todos Table

- Comprehensive task management fields
- Location data (latitude/longitude)
- Custom fields as JSON
- Hierarchical relationships (parent/child todos)
- Recurring task support
- File attachments
- Checklists

### Supporting Tables

- Categories (per user)
- Comments
- Activity logs
- Collaborators
- Related todos (blocks, blocked_by, etc.)

## Testing Different Data Types

When testing Query Pilot, pay attention to how different data types are:

- Displayed in the data viewer
- Edited in the editor
- Exported/imported
- Searched and filtered

## Troubleshooting

### Docker Issues

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs [service-name]

# Restart a specific service
docker-compose restart [service-name]
```

### Oracle Specific

Oracle container takes longer to initialize (up to 2 minutes). If seeding fails:

```bash
# Wait and retry
sleep 60
make seed-oracle
```

### SQL Server Specific

If SQL Server seeding fails with connection errors:

```bash
# Check if SQL Server is ready
docker exec query-pilot-sqlserver /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P "DevPass123" -Q "SELECT 1"
```

## Development Tips

1. **Testing Pagination**: Each user has 50-200 todos for testing large datasets
2. **Testing Search**: Full-text search indexes are configured
3. **Testing Relationships**: Todos have parent-child and blocking relationships
4. **Testing JSON**: Custom fields and preferences use JSON types
5. **Testing Binary**: Thumbnail fields contain sample binary data

## Cleanup

```bash
# Stop and remove all containers and volumes
make docker-reset

# Remove SQLite database
rm seeds/sqlite/todoapp.db
```
