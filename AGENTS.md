# Repository Guidelines

## Project Structure & Module Organization
Keep React and TypeScript code under `src`. Shared UI primitives live in `src/components`, feature-specific UI and logic stay in `src/features`, routed screens in `src/screens`, and global state in `src/stores`. Utilities sit in `src/lib` and `src/utils`. Static assets belong in `src/assets` or `public`. Desktop shells, commands, and Rust crates are maintained in `src-tauri` with configuration in `tauri.conf.json` and async tests in `src-tauri/tests`. Reference docs and specs live in `docs` and `specs`; automation, seeds, and templates live in `scripts`, `seeds`, and `templates`.

## Build, Test, and Development Commands
Install dependencies once with `pnpm install`. Use `pnpm dev` for the Vite web client and `pnpm tauri:dev` when iterating on the desktop shell. Produce release bundles with `pnpm build` (web) or `pnpm tauri:build` (desktop). Run `pnpm lint` and `pnpm typecheck` to keep code style and types healthy. Start database fixtures locally via `docker compose up -d postgres mysql mariadb sqlserver mongodb oracle` before validating adapters. Execute Rust integration and adapter tests with `cargo test` from `src-tauri`.

## Coding Style & Naming Conventions
Follow the repository ESLint and Prettier settings with two-space indentation and `strict` TypeScript. Favor named exports. Components and hooks use `PascalCase`, with hooks prefixed by `use` (for example, `useSessionStore`); helpers remain `camelCase`. Organize Tailwind classes by layout → sizing → color. Run `pnpm lint --fix` before committing to auto-resolve common issues.

## Testing Guidelines
UI components rely on unit tests colocated beside their owners using the `.test.tsx` suffix. Rust backends use Tokio-driven tests executed through `cargo test`. When adding adapters or database integrations, verify against the seeded Docker instances and document any manual validation scripts in review notes. Aim for comprehensive type coverage via `pnpm typecheck`.

## Commit & Pull Request Guidelines
Use Conventional Commits with scoped subjects (e.g., `feat(CodeEditor): improve completion latency`). Keep messages imperative, under 75 characters, and commits atomic. Pull requests should describe the problem, summarize the solution, list affected database engines, and include screenshots or GIFs for UI changes. Link related issues or ADRs and confirm `pnpm lint`, `pnpm typecheck`, and `cargo test` in the checklist.

## Security & Configuration Tips
Never commit secrets or local `.env` files; rely on the secure store service. When adding platform APIs, update `src-tauri/capabilities` concurrently. Before requesting review, validate adapter changes against all seeded databases to catch cross-engine regressions.
