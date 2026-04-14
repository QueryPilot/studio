.PHONY: help d dev dev-profile dp querypilot-cli build clean install test t test-all test-quick test-unit test-frontend test-backend test-integration ti test-watch test-coverage docker-up docker-down docker-reset seed-all seed-postgres seed-mysql seed-sqlite seed-duckdb seed-sqlserver seed-oracle seed-mongodb seed-redis setup version release beta release-manual generate-keys test-ssh-setup test-ssh test-ssh-all-adapters test-ssh-clean test-ssh-full test-ssh-all-smoke

SSH_KEYGEN ?= ssh-keygen
SQLSERVER_CONTAINER ?= query-pilot-sqlserver

# Platform library path prefix for dev mode
UNAME_S := $(shell uname -s 2>/dev/null || echo unknown)
ifeq ($(UNAME_S),Darwin)
  DEV_DYLD_PREFIX := DYLD_LIBRARY_PATH=/opt/homebrew/lib:$$DYLD_LIBRARY_PATH
else ifeq ($(UNAME_S),Linux)
  DEV_DYLD_PREFIX := LD_LIBRARY_PATH=/usr/local/lib:/usr/lib64:/usr/lib/x86_64-linux-gnu:$$LD_LIBRARY_PATH
else
  DEV_DYLD_PREFIX :=
endif

ifeq ($(OS),Windows_NT)
  WINDOWS_MSVC_ENV := powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-msvc-env.ps1
  QUERYPILOT_BUILD_CMD := $(WINDOWS_MSVC_ENV) "cargo build -p querypilot --release"
  DEV_CMD := $(WINDOWS_MSVC_ENV) "pnpm tauri:dev"
  DEV_PROFILE_CMD := $(WINDOWS_MSVC_ENV) "set QP_STREAM_PROFILE=1 && pnpm tauri:dev"
else
  QUERYPILOT_BUILD_CMD := cargo build -p querypilot --release
  DEV_CMD := $(DEV_DYLD_PREFIX) pnpm tauri:dev
  DEV_PROFILE_CMD := $(DEV_DYLD_PREFIX) QP_STREAM_PROFILE=1 pnpm tauri:dev
endif
SQLSERVER_USER ?= sa
SQLSERVER_PASSWORD ?= DevPass123
SQLSERVER_DB ?= todoapp
SQLSERVER_SQLCMD ?= /opt/mssql-tools18/bin/sqlcmd

# Default target - show help
help:
	@echo "Query Pilot - Available Commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev, make d       - Run in development mode (auto-builds querypilot CLI)"
	@echo "  make dev-profile, dp   - Run in development mode with QP_STREAM_PROFILE=1"
	@echo "  make querypilot-cli    - Build querypilot CLI only"
	@echo "  make build             - Build for production"
	@echo "  make install           - Install dependencies"
	@echo "  make clean             - Clean build artifacts"
	@echo ""
	@echo "Testing:"
	@echo "  make test, make t      - Run all unit tests (Rust + Frontend)"
	@echo "  make test-unit         - Run unit tests only"
	@echo "  make test-backend      - Run Rust tests only"
	@echo "  make test-frontend     - Run Frontend tests only"
	@echo "  make test-integration, make ti - Run Rust integration tests (requires Docker)"
	@echo "  make test-watch        - Run Frontend tests in watch mode"
	@echo "  make test-coverage     - Run tests with coverage report"
	@echo "  make test-all          - Run all tests (unit + integration)"
	@echo "  make test-quick        - Quick database connection check"
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
	@echo "  make seed-duckdb    - Seed DuckDB test databases"
	@echo "  make seed-sqlserver - Seed SQL Server only"
	@echo "  make seed-oracle    - Seed Oracle only"
	@echo "  make seed-mongodb   - Seed MongoDB only"
	@echo "  make seed-redis     - Seed Redis only"
	@echo "  make reseed-all     - Drop and reseed all databases (DELETES existing data)"
	@echo ""
	@echo "Release Management:"
	@echo "  make release                       - Stable release (AI-assisted version + changelog)"
	@echo "  make release beta                  - Beta release (auto-bump beta number)"
	@echo "  make version VERSION=2026.1.0      - Bump version only (no commit)"
	@echo "  make generate-keys          - Generate Tauri updater signing keys"
	@echo ""
	@echo "Quick Start:"
	@echo "  make setup          - Start containers and seed all databases"

# Build Query Pilot CLI (used by ACP agent shell calls)
querypilot-cli:
	@echo "Building querypilot CLI..."
	@if ! $(QUERYPILOT_BUILD_CMD); then \
		echo "WARN: querypilot CLI build failed - ACP workspace reads will be unavailable"; \
		exit 0; \
	fi
	@HOST_TRIPLE=$$(rustc -vV | sed -n 's/^host: //p'); \
	if [ -f target/release/querypilot.exe ]; then \
		cp target/release/querypilot.exe "target/release/querypilot-$$HOST_TRIPLE.exe" && \
		echo "querypilot CLI ready (release, $$HOST_TRIPLE)"; \
	elif [ -f target/release/querypilot ]; then \
		cp target/release/querypilot "target/release/querypilot-$$HOST_TRIPLE" && \
		chmod +x "target/release/querypilot-$$HOST_TRIPLE" 2>/dev/null || true && \
		echo "querypilot CLI ready (release, $$HOST_TRIPLE)"; \
	else \
		echo "WARN: querypilot CLI binary missing after build - ACP workspace reads will be unavailable"; \
	fi

# Development
dev d: querypilot-cli
	$(DEV_CMD)

dev-profile dp: querypilot-cli
	$(DEV_PROFILE_CMD)

# Build for production
build:
	@echo "Building Tauri app..."
	@pnpm tauri:build

# Install dependencies
install i:
	pnpm install

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist
	@rm -rf src-tauri/target
	@rm -rf node_modules
	@echo "Clean complete!"

# Run all unit tests (Rust + Frontend)
test:
	@echo "Running all unit tests..."
	@$(MAKE) test-backend
	@$(MAKE) test-frontend
	@echo "All unit tests completed!"

# Run integration tests (requires Docker)
test-integration ti:
	@echo "Running Rust integration tests..."
	@cd src-tauri && \
		for test in tests/*.rs; do \
			name=$$(basename $$test .rs); \
			echo "  - $$name"; \
			cargo test --test $$name; \
		done
	@echo "Integration tests completed!"

# Shorthand for test
t:
	@$(MAKE) test

# Run unit tests only
test-unit:
	@$(MAKE) test

# Run Rust backend tests
test-backend:
	@echo "Running Rust unit tests..."
	@mkdir -p dist
	@cd src-tauri && cargo test --lib --bins
	@echo "Rust tests completed!"

# Run Frontend tests
test-frontend:
	@echo "Running Frontend unit tests..."
	@pnpm test:unit
	@echo "Frontend tests completed!"

# Run Frontend tests in watch mode
test-watch:
	@echo "Running Frontend tests in watch mode..."
	@pnpm test:watch

# Run tests with coverage
test-coverage:
	@echo "Running tests with coverage..."
	@pnpm test:coverage

# SSH tunnel integration tests
test-ssh-setup:
	@echo "🔧 Setting up SSH test environment..."
	@mkdir -p tests/ssh-keys
	@$(SSH_KEYGEN) -t rsa -b 4096 -f tests/ssh-keys/test_rsa_key -N "" -C "test@querypilot" >/dev/null 2>&1 || true
	@$(SSH_KEYGEN) -t ed25519 -f tests/ssh-keys/test_ed25519_key -N "testpass123" -C "test@querypilot" >/dev/null 2>&1 || true
	@docker compose --profile ssh-test up -d ssh-bastion-password ssh-bastion-key postgres-private
	@echo "⏳ Waiting for bastions and private database to be ready..."
	@sleep 10
	@mkdir -p tests/ssh-known-hosts
	@rm -f tests/ssh-known-hosts/known_hosts
	@for port in 2222 2223; do \
		for attempt in 1 2 3 4 5; do \
			if ssh-keyscan -p $$port 127.0.0.1 >> tests/ssh-known-hosts/known_hosts 2>/dev/null; then \
				break; \
			fi; \
			sleep 1; \
		done; \
	done
	@sort -u tests/ssh-known-hosts/known_hosts -o tests/ssh-known-hosts/known_hosts
	@echo "✅ SSH testing environment ready"

test-ssh:
	@echo "🧪 Running SSH tunnel integration tests..."
	@cd src-tauri && \
		TEST_SSH_ENABLED=1 \
		TEST_SSH_KEY_HOST=127.0.0.1 \
		TEST_SSH_KEY_PORT=2223 \
		TEST_SSH_KEY_USER=sshuser \
		TEST_SSH_KEY_PATH=../tests/ssh-keys/test_rsa_key \
		TEST_DB_POSTGRES_HOST=postgres-private \
		TEST_DB_POSTGRES_PORT=5432 \
		TEST_DB_POSTGRES_USER=devuser \
		TEST_DB_POSTGRES_PASSWORD=devpass123 \
		TEST_DB_POSTGRES_DB=todoapp \
		QUERY_PILOT_SSH_KNOWN_HOSTS=../tests/ssh-known-hosts/known_hosts \
		cargo test --test ssh_tunnel_test -- --nocapture --test-threads=1

test-ssh-all-adapters:
	@echo "🧪 Running SSH integration tests for all supported adapters..."
	@cd src-tauri && \
		TEST_SSH_ENABLED=1 \
		TEST_SSH_HOST=127.0.0.1 \
		TEST_SSH_PORT=2222 \
		TEST_SSH_USER=sshuser \
		TEST_SSH_PASSWORD=bastionpass123 \
		QUERY_PILOT_SSH_KNOWN_HOSTS=../tests/ssh-known-hosts/known_hosts \
		cargo test --test ssh_all_adapters_test -- --nocapture --test-threads=1

test-ssh-clean:
	@echo "🧹 Cleaning up SSH testing environment..."
	@docker compose down -v
	@rm -rf tests/ssh-keys/test_*
	@rm -rf tests/ssh-known-hosts
	@echo "✅ Cleanup complete"

test-ssh-full: test-ssh-setup test-ssh test-ssh-all-adapters test-ssh-clean

test-ssh-all-smoke:
	@echo "🔍 Checking SSH bastion reachability to all supported DB services..."
	@docker compose --profile ssh-test up -d ssh-bastion-password >/dev/null
	@for target in \
		"query-pilot-postgres:5432" \
		"query-pilot-mysql:3306" \
		"query-pilot-mariadb:3306" \
		"query-pilot-sqlserver:1433" \
		"query-pilot-mongodb:27017" \
		"query-pilot-redis:6379" \
		"query-pilot-oracle:1521"; do \
		host=$${target%%:*}; \
		port=$${target##*:}; \
		printf "  - %-32s " "$$target"; \
		docker exec -i query-pilot-ssh-bastion-password sh -c "nc -z -w 3 $$host $$port" >/dev/null 2>&1 && echo "OK" || (echo "FAIL"; exit 1); \
	done
	@echo "✅ SSH bastion can reach all supported DB services"

# Run all tests (unit + integration)
test-all:
	@echo "Running all Rust unit tests..."
	@cd src-tauri && cargo test
	@echo "Running Frontend unit tests..."
	@pnpm test:unit
	@echo "Running comprehensive integration tests..."
	@cd src-tauri && cargo run --example run_tests
	@echo "All tests completed!"

# Quick test - just check if database connection works
test-quick:
	@echo "Quick database connection test..."
	@cd src-tauri && cargo run --example test_connection
	@echo "Connection test passed!"

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
	@docker exec -i query-pilot-postgres psql -U devuser -d todoapp < seeds/postgres/01_schema.sql
	@docker exec -i query-pilot-postgres psql -U devuser -d todoapp < seeds/postgres/02_seed_data.sql
	@echo "PostgreSQL seeded successfully!"

seed-mysql:
	@echo "Seeding MySQL..."
	@docker exec -i query-pilot-mysql mysql -uroot -prootpass123 < seeds/mysql/01_schema.sql
	@docker exec -i query-pilot-mysql mysql -uroot -prootpass123 < seeds/mysql/02_seed_data.sql
	@echo "MySQL seeded successfully!"

seed-sqlite:
	@echo "Seeding SQLite..."
	@cd seeds/sqlite && python3 seed_sqlite.py
	@echo "SQLite seeded successfully!"

seed-duckdb:
	@echo "Seeding DuckDB..."
	@./seeds/duckdb/seed_duckdb.sh
	@echo "DuckDB seeded successfully!"

seed-sqlserver:
	@echo "Waiting for SQL Server to be ready..."
	@echo "Testing SQL Server connection..."
	@until docker exec $(SQLSERVER_CONTAINER) $(SQLSERVER_SQLCMD) -S localhost -U $(SQLSERVER_USER) -P $(SQLSERVER_PASSWORD) -Q "SELECT 1" -C > /dev/null 2>&1; do \
		echo "Waiting for SQL Server to accept connections..."; \
		sleep 5; \
	done
	@echo "Ensuring SQL Server database exists..."
	@docker exec -i $(SQLSERVER_CONTAINER) $(SQLSERVER_SQLCMD) -S localhost -U $(SQLSERVER_USER) -P $(SQLSERVER_PASSWORD) -d master -Q "IF DB_ID('$(SQLSERVER_DB)') IS NULL CREATE DATABASE [$(SQLSERVER_DB)]" -C -b
	@echo "Seeding SQL Server..."
	@docker exec -i $(SQLSERVER_CONTAINER) $(SQLSERVER_SQLCMD) -S localhost -U $(SQLSERVER_USER) -P $(SQLSERVER_PASSWORD) -d master -i /seeds/01_schema.sql -C -b
	@docker exec -i $(SQLSERVER_CONTAINER) $(SQLSERVER_SQLCMD) -S localhost -U $(SQLSERVER_USER) -P $(SQLSERVER_PASSWORD) -d $(SQLSERVER_DB) -i /seeds/02_seed_data.sql -C -b
	@docker exec -i $(SQLSERVER_CONTAINER) $(SQLSERVER_SQLCMD) -S localhost -U $(SQLSERVER_USER) -P $(SQLSERVER_PASSWORD) -d $(SQLSERVER_DB) -i /seeds/03_advanced_types.sql -C -b
	@echo "SQL Server seeded successfully!"

seed-oracle:
	@echo "Waiting for Oracle to be ready..."
	@until docker exec query-pilot-oracle bash -c "echo 'SELECT 1 FROM DUAL;' | sqlplus -s system/DevPass123@//localhost:1521/XE" > /dev/null 2>&1; do \
		echo "Waiting for Oracle to accept connections..."; \
		sleep 10; \
	done
	@echo "Oracle is ready. Setting up user..."
	@docker exec -i query-pilot-oracle sqlplus -s system/DevPass123@//localhost:1521/XE < seeds/oracle/setup.sql
	@echo "Creating Oracle schema..."
	@docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@//localhost:1521/XE < seeds/oracle/01_schema.sql
	@echo "Seeding Oracle data..."
	@docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@//localhost:1521/XE < seeds/oracle/02_seed_data.sql
	@echo "Oracle seeded successfully!"

seed-mongodb:
	@echo "MongoDB is seeded automatically via init scripts."
	@echo "If you need to manually re-seed, run:"
	@echo "  docker exec -i query-pilot-mongodb mongosh -u devuser -p devpass123 --authenticationDatabase admin todoapp < seeds/mongodb/01_init_todoapp.js"
	@echo "Checking MongoDB collections..."
	@docker exec query-pilot-mongodb mongosh -u devuser -p devpass123 --authenticationDatabase admin todoapp --quiet --eval "db.getCollectionNames()" 2>/dev/null || echo "MongoDB not running or not ready"

seed-redis:
	@echo "Seeding Redis..."
	@bash seeds/redis/seed_redis.sh
	@echo "Redis seeded successfully!"

seed-all: seed-postgres seed-mysql seed-sqlite seed-duckdb seed-sqlserver seed-oracle seed-mongodb seed-redis
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
	@echo "  SQLite:     seeds/sqlite/query_pilot_test.db"
	@echo "  SQL Server: localhost:11435 (user: sa, pass: DevPass123, db: todoapp)"
	@echo "  Oracle:     localhost:11521 (user: todoapp, pass: DevPass123, service: XE)"
	@echo "  MongoDB:    localhost:17017 (user: devuser, pass: devpass123, db: todoapp)"
	@echo "  Redis:      localhost:16379 (pass: devpass123)"
	@echo ""
	@echo "Run 'make dev' to start the application"

# Release Management

# Generate Tauri updater signing keys (interactive)
generate-keys:
	@bash scripts/generate-updater-keys.sh

# Create release
# Usage: make release          - stable release (AI-assisted version + changelog)
#        make release beta     - beta release (auto-bump beta number, skip changelog)
release:
	@bash scripts/smart-release-v2.sh $(filter beta,$(MAKECMDGOALS))

# Allow 'beta' as a no-op target so `make release beta` works
beta:
	@true

# Publish built release to QueryPilot/studio (after GitHub Actions completes)
# Manual release with specific version
release-manual:
	@if [ -z "$(VERSION)" ]; then \
		echo "❌ Error: VERSION not specified"; \
		echo "Usage: make release-manual VERSION=2026.1.0"; \
		echo "  or:  make release-manual VERSION=2026.1.0-beta.1"; \
		exit 1; \
	fi
	@echo "🚀 Creating release v$(VERSION)..."
	@echo ""
	@bash scripts/bump-version.sh $(VERSION)
	@echo ""
	@echo "📝 Please update CHANGELOG.md with release notes"
	@echo "Press Enter when ready to continue, or Ctrl+C to abort..."
	@read dummy
	@echo ""
	@echo "📦 Committing changes..."
	@git add .
	@git commit -m "chore: bump version to v$(VERSION)"
	@echo ""
	@echo "🏷️  Creating tag..."
	@git tag v$(VERSION)
	@echo ""
	@echo "⬆️  Pushing to GitHub..."
	@git push origin master
	@git push origin v$(VERSION)
	@echo ""
	@echo "✅ Release v$(VERSION) created!"
	@echo ""
	@echo "🔗 Monitor the build at:"
	@echo "   https://github.com/$$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
	@echo ""
	@echo "📦 View releases at:"
	@echo "   https://github.com/$$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases"

# Bump version only (no commit/tag)
version:
	@if [ -z "$(VERSION)" ]; then \
		echo "❌ Error: VERSION not specified"; \
		echo "Usage: make version VERSION=2026.1.0"; \
		exit 1; \
	fi
	@bash scripts/bump-version.sh $(VERSION)

