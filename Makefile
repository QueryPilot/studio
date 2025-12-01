.PHONY: help d dev build build-ai build-ai-all verify-sidecars dev-sidecar ds package-dist clean install test t test-all test-quick test-unit test-frontend test-backend test-watch test-coverage docker-up docker-down docker-reset seed-all seed-postgres seed-mysql seed-sqlite seed-sqlserver seed-oracle setup version release release-publish release-manual release-local relc generate-keys test-ssh-setup test-ssh test-ssh-clean test-ssh-full setup-ssm-plugin

SSH_KEYGEN ?= ssh-keygen

ifeq ($(OS),Windows_NT)
SETUP_SSM_PLUGIN_CMD := powershell -ExecutionPolicy Bypass -File scripts/download-ssm-plugin.ps1
else
SETUP_SSM_PLUGIN_CMD := bash scripts/download-ssm-plugin.sh
endif

# Default target - show help
help:
	@echo "Query Pilot - Available Commands:"
	@echo ""
	@echo "Development:"
	@echo "  make dev, make d       - Run in development mode"
	@echo "  make dev-sidecar, ds   - Run AI sidecar in dev mode (Bun)"
	@echo "  make build             - Build for production (includes all sidecars)"
	@echo "  make build-ai          - Build AI sidecar for current platform"
	@echo "  make build-ai-all      - Build AI sidecar for all platforms"
	@echo "  make setup-ssm-plugin  - Download AWS Session Manager plugin"
	@echo "  make verify-sidecars   - Verify all sidecar binaries are present"
	@echo "  make package-dist      - Package build with installation instructions"
	@echo "  make install           - Install dependencies"
	@echo "  make clean             - Clean build artifacts"
	@echo ""
	@echo "Testing:"
	@echo "  make test, make t      - Run all unit tests (Rust + Frontend)"
	@echo "  make test-unit         - Run unit tests only"
	@echo "  make test-backend      - Run Rust tests only"
	@echo "  make test-frontend     - Run Frontend tests only"
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
	@echo "  make seed-sqlserver - Seed SQL Server only"
	@echo "  make seed-oracle    - Seed Oracle only"
	@echo "  make reseed-all     - Drop and reseed all databases (DELETES existing data)"
	@echo ""
	@echo "Release Management:"
	@echo "  make release                - AI-powered release with cross-repo publishing"
	@echo "  make relc [V=0.7.1]         - AI-powered local build, sign, notarize & upload"
	@echo "  make release-publish V=0.5.0 - Publish built release to studio-app repo"
	@echo "  make release-manual VERSION=1.2.3  - Manual release with specific version"
	@echo "  make version VERSION=1.2.3  - Bump version only (no commit)"
	@echo "  make generate-keys          - Generate Tauri updater signing keys"
	@echo ""
	@echo "Quick Start:"
	@echo "  make setup          - Start containers and seed all databases"

# Development
dev d:
	pnpm tauri:dev

dev-sidecar ds:
	@echo "Starting AI sidecar in dev mode..."
	@cd src-tauri/sidecar-ai && bun install && PORT=3001 bun run index.ts

# AI Sidecar build
build-ai:
	@echo "Building AI sidecar for current platform..."
	@bash scripts/build-ai-sidecar.sh

build-ai-all:
	@echo "Building AI sidecar for all platforms..."
	@BUILD_ALL=true bash scripts/build-ai-sidecar.sh

# Verify all sidecars are present
verify-sidecars:
	@bash scripts/verify-sidecars.sh

# Build for production
build:
	@echo "Building AI sidecar..."
	@$(MAKE) build-ai
	@echo "Downloading AWS Session Manager plugin..."
	@$(MAKE) setup-ssm-plugin
	@echo "Verifying all sidecars..."
	@$(MAKE) verify-sidecars
	@echo "Building Tauri app..."
	@pnpm tauri:build

# Package for distribution (includes installation instructions)
package-dist:
	@bash scripts/package-for-distribution.sh

# Install dependencies
install i:
	pnpm install
	@echo "Installing AI sidecar dependencies..."
	@cd src-tauri/sidecar-ai && bun install

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist
	@rm -rf src-tauri/target
	@rm -rf node_modules
	@rm -rf src-tauri/sidecar-ai/node_modules
	@rm -f src-tauri/sidecars/qp-ai-*
	@rm -f src-tauri/sidecars/session-manager-plugin-*
	@echo "Clean complete!"

# Run all unit tests (Rust + Frontend)
test:
	@echo "Running all unit tests..."
	@$(MAKE) test-backend
	@$(MAKE) test-frontend
	@echo "All unit tests completed!"

# Shorthand for test
t:
	@$(MAKE) test

# Run unit tests only
test-unit:
	@$(MAKE) test

# Run Rust backend tests
test-backend: build-ai
	@echo "Running Rust unit tests..."
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
	@docker compose up -d ssh-bastion-password ssh-bastion-key postgres-private
	@echo "⏳ Waiting for bastions and private database to be ready..."
	@sleep 10
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
		cargo test --test ssh_tunnel_test -- --nocapture --test-threads=1

test-ssh-clean:
	@echo "🧹 Cleaning up SSH testing environment..."
	@docker compose down -v
	@rm -rf tests/ssh-keys/test_*
	@echo "✅ Cleanup complete"

test-ssh-full: test-ssh-setup test-ssh test-ssh-clean

setup-ssm-plugin:
	@echo "📦 Downloading AWS Session Manager plugin binaries..."
	@$(SETUP_SSM_PLUGIN_CMD)
	@echo "✅ session-manager-plugin downloaded"

# Run all tests (unit + integration)
test-all: build-ai
	@echo "Running all Rust unit tests..."
	@cd src-tauri && cargo test
	@echo "Running Frontend unit tests..."
	@pnpm test:unit
	@echo "Running comprehensive integration tests..."
	@cd src-tauri && cargo run --example run_tests
	@echo "All tests completed!"

# Quick test - just check if database connection works
test-quick: build-ai
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

seed-sqlserver:
	@echo "Waiting for SQL Server to be ready..."
	@sleep 20
	@echo "Testing SQL Server connection..."
	@until docker exec query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -Q "SELECT 1" -C -No > /dev/null 2>&1; do \
		echo "Waiting for SQL Server to accept connections..."; \
		sleep 5; \
	done
	@echo "Seeding SQL Server..."
	@docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -i /seeds/01_schema.sql -C
	@docker exec -i query-pilot-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P DevPass123 -i /seeds/02_seed_data.sql -C
	@echo "SQL Server seeded successfully!"

seed-oracle:
	@echo "Setting up Oracle user..."
	@docker exec -i query-pilot-oracle sqlplus -s system/DevPass123@localhost:1521/XE < seeds/oracle/setup.sql || true
	@echo "Creating Oracle schema..."
	@docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/01_schema.sql || true
	@echo "Seeding Oracle data..."
	@docker exec -i query-pilot-oracle sqlplus -s todoapp/DevPass123@localhost:1521/XE < seeds/oracle/02_seed_data.sql || true
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

# Release Management

# Generate Tauri updater signing keys (interactive)
generate-keys:
	@bash scripts/generate-updater-keys.sh

# Smart AI-powered release with cross-repo publishing
release:
	@bash scripts/smart-release-v2.sh

# Publish built release to studio-app (after GitHub Actions completes)
release-publish:
	@if [ -z "$(V)" ]; then \
		echo "❌ Error: Version not specified"; \
		echo "Usage: make release-publish V=0.5.0"; \
		exit 1; \
	fi
	@bash scripts/publish-to-app-repo.sh v$(V)

# Manual release with specific version
release-manual:
	@if [ -z "$(VERSION)" ]; then \
		echo "❌ Error: VERSION not specified"; \
		echo "Usage: make release-manual VERSION=1.2.3"; \
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
		echo "Usage: make version VERSION=1.2.3"; \
		exit 1; \
	fi
	@bash scripts/bump-version.sh $(VERSION)

# Local release - build, sign, notarize, upload to GitHub
# Usage: make relc V=0.7.1
# Requires: gh CLI authenticated, Apple Developer cert in keychain
# Optional env: APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID (for notarization)
#               TAURI_PRIVATE_KEY, TAURI_KEY_PASSWORD (for update signing)
#               SENTRY_DSN (for telemetry build)
release-local relc:
	@bash scripts/release-local.sh $(V)
