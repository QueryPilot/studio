.PHONY: d dev build clean install

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