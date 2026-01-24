# Development Database Setup

## Quick Start

```bash
# Start all containers and seed databases
make setup

# Or step by step:
make docker-up      # Start containers
make seed-all       # Seed all databases
```

## Docker Commands

| Command | Purpose |
|---------|---------|
| `make docker-up` | Start all database containers |
| `make docker-down` | Stop containers |
| `make docker-reset` | Reset containers and volumes |
| `make seed-all` | Seed all databases |
| `make seed-postgres` | Seed PostgreSQL only |
| `make seed-mysql` | Seed MySQL only |

## Connection Details

| Database | Host | Port | User | Password | Database |
|----------|------|------|------|----------|----------|
| PostgreSQL | localhost | 15432 | devuser | devpass123 | todoapp |
| MySQL | localhost | 13306 | devuser | devpass123 | todoapp |
| SQLite | - | - | - | - | seeds/sqlite/todoapp.db |
| SQL Server | localhost | 11434 | sa | DevPass123 | todoapp |
| Oracle | localhost | 11521 | todoapp | DevPass123 | XE (service) |

## Seed Data

Seed scripts are in the `seeds/` directory:
- `seeds/postgres/` - PostgreSQL seed data
- `seeds/mysql/` - MySQL seed data
- `seeds/sqlite/` - SQLite database file

The seed data provides a `todoapp` sample database for testing.

## Connecting in Development

1. Run `make setup` to start databases
2. Run `make dev` to start the app
3. Create a new connection using the credentials above
