# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub Actions workflow for automated multi-platform builds and releases
- AI-powered release automation using Codex CLI (`make release`)
- Self-signed build support with optional production code signing
- Version bump automation script
- Release management Makefile commands
- Version display on main screen (dynamically from package.json)
- cross-env package for cross-platform environment variable support

### Changed
- Removed "Load PostgreSQL Dev" and "Emergency Clear All" buttons from main screen

### Fixed
- Fixed pnpm version mismatch in GitHub Actions workflows (now uses packageManager field from package.json)
- Fixed YAML syntax error in coverage.yml caused by corrupted emoji characters
- Fixed deprecated set-output command in release workflow (replaced actions/create-release@v1 with gh CLI)
- Fixed deprecated upload-artifact action (upgraded from v3 to v4)
- Fixed Node.js out-of-memory errors during production builds by increasing heap size to 4GB
- Fixed Linux build errors by adding missing glib2 and GTK3 development libraries
- Fixed pkg-config missing in Linux workflows causing glib-2.0 not found errors
- Fixed Windows build failure by using cross-env for NODE_OPTIONS and setting it in workflow environment
- Fixed AI sidecar build verification in CI workflows with platform-specific binary checks and executable permissions
- Fixed Rust test targets to build AI sidecar first (required by Tauri build script validation)
- Fixed unit-tests.yml workflow to build AI sidecar before running Rust tests
- Fixed coverage.yml workflow to build AI sidecar and install Linux dependencies before generating Rust coverage

## [0.2.0] - 2025-11-10
### Added
- TabGroupProvider and modifier-key tracking enable Cmd/Ctrl+number shortcuts for instant tab focusing across the workbench.
- GlobalChangesModal surfaces workspace-wide pending CRUD operations with indicators, bulk commit/discard actions, and shortcut bindings.
- CRUD diff viewer suite (DataDiff, StructureDiff, SqlPreview, ImpactSummary) visualizes data, schema, and SQL impacts before committing changes.
- Cross-platform GitHub Actions workflows now run build verification and generate frontend/Rust coverage reports with Vitest coverage output bundled.
- ERD tooling gained layout-direction toggles (LR/TB), Dagre-powered positioning, node memoization, and faster edge handling for smoother diagrams.

### Changed
- **Breaking** TableDataGridV2 has transitioned to read-only mode, retiring the centralized editing store and write-path UI until the redesigned editor ships.
- Row insertion, staging, and context menus were overhauled: inserts can target relative positions, copy/export options are consolidated, and undo/redo clutter was removed.
- All cell editors now display column metadata (name, PK/FK status, database type) directly in the editor header for safer, context-aware edits.
- Global ErrorBoundary and FeatureErrorBoundary wrappers isolate crashes at the app and feature level, keeping the workspace responsive during failures.

### Fixed
- Streaming query batches are now fully accumulated before resolving, and TabStateStore caching prevents runaway rerenders during long-running queries.
- Smart-release changelog generation writes via a temp file to eliminate awk newline errors that previously broke release automation.
- WorkspaceTitleBar and sidebar interactions now log disconnect failures and show user-facing errors instead of failing silently.

### Removed
- BulkEditModal, undo/redo staging controls, and the legacy CommitPreviewModal were retired in favor of the streamlined global change review flow.
- The deprecated CommandPalette and its keyboard plumbing were removed to reduce bundle size ahead of the new keyboard/tab experience.

---

<!--
  When you run `make release`, the AI will automatically add a new version section here.

  Manual format (if needed):

  ## [1.0.0] - 2025-01-15

  ### Added
  - New features

  ### Changed
  - Changes to existing features

  ### Fixed
  - Bug fixes

  ### Removed
  - Removed features
-->
