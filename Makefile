.PHONY: help d dev build clean install test t test-all test-quick test-adapters test-postgres test-mysql test-mssql test-sqlite test-adapters-quiet test-adapters-verbose test-adapter docker-up docker-down docker-reset seed-all seed-postgres seed-mysql seed-sqlite seed-sqlserver seed-oracle setup

# Default target - show help
help:
	@echo "DevDB Studio - Available Commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev, make d    - Run in development mode"
	@echo "  make build          - Build for production"
	@echo "  make install        - Install dependencies"
	@echo "  make clean          - Clean build artifacts"
	@echo ""
	@echo "Testing:"
	@echo "  make test, make t   - Run MSSQL adapter tests"
	@echo "  make test-release   - Run tests in release mode (faster)"
	@echo "  make test-all       - Run all Rust tests"
	@echo "  make test-quick     - Quick MSSQL connection check"
	@echo "  make test-adapters  - Run all database adapter tests"
	@echo "  make test-postgres  - Run PostgreSQL adapter tests"
	@echo "  make test-mysql     - Run MySQL adapter tests"
	@echo "  make test-mssql     - Run MSSQL adapter tests"
	@echo "  make test-sqlite    - Run SQLite adapter tests"
	@echo "  make test-adapters-quiet   - Run all adapters (quiet mode)"
	@echo "  make test-adapters-verbose - Run all adapters (verbose mode)"
	@echo "  make test-adapter ADAPTER=<name> - Run specific adapter tests"
	@echo ""
	@echo "Docker Database Management:"
	@echo "  make docker-up      - Start all database containers"
	@echo "  make docker-down    - Stop all database containers"
	@echo "  make docker-reset   - Stop, remove volumes, and restart containers"
	@echo ""
	@echo "Database Seeding:"
	@echo "  make seed-all       - Seed all databases"
	@echo "  make seed-postgres  - Seed PostgreSQL only"
	@echo "  make seed-mysql     - Seed MySQL only"
	@echo "  make seed-sqlite    - Seed SQLite only"
	@echo "  make seed-sqlserver - Seed SQL Server only"
	@echo "  make seed-oracle    - Seed Oracle only"
	@echo "  make reseed-all     - Drop and reseed all databases (DELETES existing data)"
	@echo ""
	@echo "Quick Start:"
	@echo "  make setup          - Start containers and seed all databases"

# Development
d:
	pnpm tauri:dev

dev:
	pnpm tauri:dev

# Build for production
build:
	pnpm tauri:build

# Install dependencies
install:
	pnpm install

# Clean build artifacts
clean:
	rm -rf dist
	rm -rf src-tauri/target
	rm -rf node_modules

# Run tests
test:
	@echo "Running MSSQL adapter tests..."
	@cd src-tauri && cargo run --example test_mssql --features mssql
	@echo "Tests completed!"

# Shorthand for test
t:
	@$(MAKE) test

# Run tests with release build (faster execution)
test-release:
	@echo "Running MSSQL adapter tests (release mode)..."
	@cd src-tauri && cargo run --release --example test_mssql --features mssql
	@echo "Tests completed!"

# Run all Rust tests
test-all:
	@echo "Running all Rust tests..."
	@cd src-tauri && cargo test --features mssql
	@echo "All tests completed!"

# Quick test - just check if MSSQL connection works
test-quick:
	@echo "Quick MSSQL connection test..."
	@docker exec devdb-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "DevPass123" -Q "SELECT 'MSSQL connection OK'" -C
	@echo "Connection test passed!"

# Database adapter tests
test-adapters: test-postgres test-mysql test-mssql test-sqlite
	@echo "All adapter tests completed!"

# PostgreSQL adapter tests
test-postgres:
	@echo "Running PostgreSQL adapter tests..."
	@cd src-tauri && cargo test --lib database::adapter::postgres_test --features postgres -- --nocapture
	@echo "PostgreSQL adapter tests completed!"

# MySQL adapter tests  
test-mysql:
	@echo "Running MySQL adapter tests..."
	@cd src-tauri && cargo test --lib database::adapter::mysql_test --features mysql -- --nocapture
	@echo "MySQL adapter tests completed!"

# MSSQL adapter tests
test-mssql:
	@echo "Running MSSQL adapter tests..."
	@cd src-tauri && cargo test --lib database::adapter::mssql_test --features mssql -- --nocapture
	@echo "MSSQL adapter tests completed!"

# SQLite adapter tests
test-sqlite:
	@echo "Running SQLite adapter tests..."
	@cd src-tauri && cargo test --lib database::adapter::sqlite_test --features sqlite -- --nocapture
	@echo "SQLite adapter tests completed!"

# Run adapter tests in quiet mode (no capture)
test-adapters-quiet: 
	@echo "Running all adapter tests (quiet mode)..."
	@cd src-tauri && cargo test --lib database::adapter --features "postgres mysql mssql sqlite" -q
	@echo "All adapter tests completed!"

# Run adapter tests with detailed output
test-adapters-verbose:
	@echo "Running all adapter tests (verbose mode)..."
	@cd src-tauri && cargo test --lib database::adapter --features "postgres mysql mssql sqlite" -- --nocapture --test-threads=1
	@echo "All adapter tests completed!"

# Run specific adapter test
test-adapter:
	@if [ -z "$(ADAPTER)" ]; then \
		echo "Please specify ADAPTER: make test-adapter ADAPTER=postgres"; \
		exit 1; \
	fi
	@echo "Running $(ADAPTER) adapter tests..."
	@cd src-tauri && cargo test --lib database::adapter::$(ADAPTER)_test --features $(ADAPTER) -- --nocapture
	@echo "$(ADAPTER) adapter tests completed!"

# Docker commands
docker-up:
	docker-compose up -d
	@echo "Waiting for databases to be ready..."
	@echo "PostgreSQL and MySQL will be ready quickly, SQL Server and Oracle take longer..."
	@sleep 45
	@echo "Databases should be ready. You can check with: docker-compose ps"

docker-down:
	docker-compose down

docker-reset:
	docker-compose down -v
	docker-compose up -d
	@echo "Waiting for databases to be ready..."
	@sleep 30

# Seeding commands
seed-postgres:
	@echo "Seeding PostgreSQL..."
	@docker exec -i devdb-postgres psql -U devuser -d todoapp < seeds/postgres/01_schema.sql
	@docker exec -i devdb-postgres psql -U devuser -d todoapp < seeds/postgres/02_seed_data.sql
	@echo "PostgreSQL seeded successfully!"

seed-mysql:
	@echo "Seeding MySQL..."
	@docker exec -i devdb-mysql mysql -uroot -prootpass123 < seeds/mysql/01_schema.sql
	@docker exec -i devdb-mysql mysql -uroot -prootpass123 < seeds/mysql/02_seed_data.sql
	@echo "MySQL seeded successfully!"

seed-sqlite:
	@echo "Seeding SQLite..."
	@cd seeds/sqlite && python3 seed_sqlite.py
	@echo "SQLite seeded successfully!"

seed-sqlserver:
	@echo "Waiting for SQL Server to be ready..."
	@sleep 20
	@echo "Testing SQL Server connection..."
	@until docker exec devdb-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -Q "SELECT 1" -C -No > /dev/null 2>&1; do \
		echo "Waiting for SQL Server to accept connections..."; \
		sleep 5; \
	done
	@echo "Seeding SQL Server..."
	@docker exec -i devdb-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -i /seeds/01_schema.sql -C
	@docker exec -i devdb-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -i /seeds/02_seed_data.sql -C
	@echo "SQL Server seeded successfully!"

seed-oracle:
	@echo "Setting up Oracle user..."
	@docker exec -i devdb-oracle sqlplus -s system/DevPass123@localhost:1521/XE < seeds/oracle/setup.sql || true
	@echo "Creating Oracle schema..."
	@docker exec -i devdb-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/01_schema.sql || true
	@echo "Seeding Oracle data..."
	@docker exec -i devdb-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/02_seed_data.sql || true
	@echo "Oracle seeding attempted (may require manual setup for complex schemas)"

seed-all: seed-postgres seed-mysql seed-sqlite seed-sqlserver seed-oracle
	@echo "All databases seeded successfully!"

# Reset and reseed databases (cleans existing data first)
reseed-all: 
	@echo "Reseeding all databases (this will DELETE existing data)..."
	@$(MAKE) seed-all
	@echo "All databases reseeded successfully!"

reseed-postgres:
	@echo "Reseeding PostgreSQL (this will DELETE existing data)..."
	@$(MAKE) seed-postgres

reseed-mysql:
	@echo "Reseeding MySQL (this will DELETE existing data)..."
	@$(MAKE) seed-mysql

# Setup - complete initialization
setup: docker-up
	@echo "Waiting additional time for all databases to initialize..."
	@sleep 30
	@$(MAKE) seed-all
	@echo ""
	@echo "✅ Setup complete! All databases are running and seeded."
	@echo ""
	@echo "Database Connections:"
	@echo "  PostgreSQL: localhost:15432 (user: devuser, pass: devpass123, db: todoapp)"
	@echo "  MySQL:      localhost:13306 (user: devuser, pass: devpass123, db: todoapp)"
	@echo "  SQLite:     seeds/sqlite/todoapp.db"
	@echo "  SQL Server: localhost:11434 (user: sa, pass: DevPass123, db: todoapp)"
	@echo "  Oracle:     localhost:11521 (user: todoapp, pass: DevPass123, service: XE)"
	@echo ""
	@echo "Run 'make dev' to start the application"