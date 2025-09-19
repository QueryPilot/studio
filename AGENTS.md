# Repository Guidelines

## Project Structure & Module Organization
React and TypeScript code resides in `src`: shared UI in `components`, domain logic in `features`, routed experiences in `screens`, state under `stores`, and cross-cutting utilities in `lib` and `utils`. Static assets live in `src/assets` and `public`. Desktop logic, commands, and Rust crates live in `src-tauri` with config in `tauri.conf.json` and async integration tests in `src-tauri/tests`. Reference material—including ADRs, UX specs, and keyboard plans—sits in `docs` and `specs`. Supporting automation and seed data are under `scripts`, `seeds`, and `templates`.

## Build, Test, and Development Commands
Install once with `pnpm install`. Use `pnpm dev` for a hot Vite client or `pnpm tauri:dev` to boot the desktop shell. Production bundles come from `pnpm build` (web) and `pnpm tauri:build` (desktop). Enforce quality with `pnpm lint` and `pnpm typecheck`. Spin up database fixtures locally using `docker compose up -d postgres mysql mariadb sqlserver mongodb oracle` before exercising adapters.

## Coding Style & Naming Conventions
Honor the repository ESLint setup and Tailwind config. Keep two-space indentation, TypeScript `strict` types, and favor named exports. Components and hooks use `PascalCase` with `use`-prefixed hooks (`useSessionStore`), while helpers stay `camelCase`. Feature folders should encapsulate UI, state, and services for that slice. Format Tailwind classes logically (layout → size → color) and run `pnpm lint --fix` prior to committing.

## Testing Guidelines
Backend adapters rely on Tokio tests; run `cargo test` from `src-tauri` after ensuring the Docker databases are healthy. Type safety and linting currently cover most UI, but new automated UI tests should live beside the owning feature and use the `.test.tsx` suffix. Document any manual scripts (e.g., `test-connection.js`) in PR notes if they validate new behavior.

## Commit & Pull Request Guidelines
Follow Conventional Commits with scoped subjects such as `feat(CodeEditor): improve completion latency` or `fix(Connections): guard ssl mode`. Write imperative, present-tense summaries under 75 characters and keep commits atomic. Pull requests should state the problem, summarize the solution, note impacted database engines, and attach screenshots or GIFs for UI changes. Link issues or ADRs where relevant and confirm `pnpm lint`, `pnpm typecheck`, and `cargo test` in the checklist.

## Environment & Security Notes
Never commit secrets or local `.env` files; use the secure store service. When adding new platform APIs, update `src-tauri/capabilities` simultaneously. Validate adapter changes against the seeded Docker instances before requesting review to prevent regressions across supported databases.
