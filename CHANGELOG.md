# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.2.0] - 2025-11-10

### Added
- AI Sidecar and assistant panel with secure provider preferences, session management, and sidecar build verification across CI targets.
- TabGroupProvider plus modifier-key tracking to enable Cmd/Ctrl + number tab switching and richer keyboard shortcut coverage in Query and workspace panels.
- GlobalChangesModal with CRUD diff suite (data, structure, SQL preview, impact summary) for reviewing staged operations across the workspace.
- ERD upgrades including layout-direction toggles, Dagre-based positioning, memoized nodes, and throttled edge highlighting for smoother diagrams.
- Distribution guides, installation docs, and scripts (AppImage, DMG, notarization helpers) to streamline packaging and resolve macOS “damaged app” reports.
- SQL editing improvements: formatting utilities, contextual linting, autocomplete fixes for dialects/CTEs, parameter hints, hover tooltips, and command suggestions.

### Changed
- **Breaking:** TableDataGridV2 now operates in read-only mode; bulk editing stores, pending edit drawers, and legacy commit preview flows were removed pending the redesigned editor.
- Table insertion workflows now support relative row placement, refined context menus, staged-change indicators, and richer column metadata in cell editors.
- Connection management migrated to backend vault storage with retries, pooled connections, smart pre-warming, and improved health monitoring per window/workspace.
- Workbench layout refactors introduced VS Code–style panel management, drag-and-drop tabs, keyboard-driven splits, and layout persistence across connections.
- CI workflows and Makefile targets now build the frontend and AI sidecar before Rust tests, install missing Linux/macOS dependencies, upgrade upload-artifact, and enforce NODE_OPTIONS heap sizing.
- Preferences, QueryPanel, and sidebar components gained query limit controls, keyboard shortcut displays, and status/error surfacing to keep long-running operations transparent.

### Fixed
- Resolved ERR_PNPM_TARBALL_INTEGRITY and mismatched pnpm versions by regenerating the lockfile and letting workflows read packageManager metadata.
- Stabilized Linux/macOS packaging by ensuring libfuse2, create-dmg, pkg-config, glib/gtk deps, executable bits, and sidecar verification are run in every workflow.
- Eliminated Tauri build/test failures by building frontend assets ahead of cargo commands and validating resource paths for sidecar binaries.
- Addressed Postgres adapter regressions with SSL/TLS handling, numeric precision conversions, bigint serialization, cursor cleanup, and transaction APIs.
- Fixed keyboard shortcut regressions, query streaming accumulation, TabStateStore caching loops, and workspace title bar disconnect feedback to prevent UI freezes.

### Removed
- Legacy CommandPalette, keyboard plumbing, and unused data grid components were dropped in favor of the new keyboard provider architecture.
- BulkEditModal, undo/redo staging controls, and other deprecated table editing flows were retired to align with the read-only grid strategy.

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
