# Repository Guidelines

## Project Structure & Module Organization
Query Pilot couples a React 19 SPA with a Tauri 2 host. `src/` contains the entrypoint plus `components/`, `lib/`, `hooks/`, and `test-utils/`. `src-tauri/` stores the Rust commands, `tauri.conf.json`, and the Bun-based sidecar in `src-tauri/sidecar-ai/`. Sample DB schemas stay in `seeds/`; release/deployment helpers sit in `scripts/`, while SSH/Docker fixtures live in `tests/`. Keep generated files confined to `dist/` or `src-tauri/target/` and ship-ready assets in `public/`.

## Build, Test, and Development Commands
Install deps with `pnpm install` or `make install`. `pnpm tauri:dev` runs the desktop shell; `pnpm dev` is browser-only. Ship builds with `pnpm tauri:build` (or `pnpm build:strict` for stricter TS). `pnpm lint` and `pnpm typecheck` enforce ESLint + `tsc`. Run Vitest through `pnpm test`, and emit coverage with `pnpm test:coverage`. Make targets mirror those flows: `make dev`, `make setup` (boot + seed Docker DBs), `make seed-all`, `make test-frontend`, `make test-backend`, and `make release`.

## Coding Style & Naming Conventions
Formatting is enforced by `eslint.config.js` plus the TS configs. Use two-space indentation, named exports where practical, and `PascalCase` filenames for React components. Hooks belong in `src/hooks` with a `use` prefix, utilities in `src/lib`/`src/utils` use `camelCase`, and environment constants use `SCREAMING_SNAKE_CASE`. Tailwind classes should reference tokens from `tailwind.config.js`, and shadcn wrappers stay under `components/ui`.

## Testing Guidelines
Vitest (see `vitest.config.ts`) runs in jsdom and loads `src/test-utils/setup.ts`. Co-locate specs as `ComponentName.test.tsx` or `.spec.ts`. Use `pnpm test` for watch mode, `pnpm test:coverage` for the V8 report, and `make test` when you also need the Rust backend’s `cargo test`. Database/SSH flows rely on the Docker fixtures in `tests/`; only run `test-ssh-app.py` after `make setup` reports healthy containers.

## Commit & Pull Request Guidelines
Follow the conventional commit pattern already in history (`feat(macos-signing): …`, `chore(deps): …`). Keep each change scoped and include matching tests/docs. Pull requests should explain intent, attach UI screenshots when relevant, note any touched seed folders, and confirm that `pnpm lint`, `pnpm typecheck`, and `pnpm test:coverage` passed. Link tracking issues, flag release-impacting changes (sidecar versions, Make targets), and use `make release` or `make release-manual VERSION=x.y.z` so changelog entries and tags line up.

## Security & Configuration Tips
Never commit secrets—load them from local `.env` files referenced by `src-tauri/tauri.conf.json` or the OS keychain. Keep DB access within `docker-compose.yml` and reuse the sample accounts inside `seeds/`. After touching `scripts/build-ai-sidecar.sh` or binary artifacts, run `make verify-sidecars` and store outputs inside `src-tauri/sidecars/` (ignored by git).
