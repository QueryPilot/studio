# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.5.0] - 2025-11-24

### New Features
- Meet the new Home Screen with an action bar, recent connections, and ERD workspace shortcuts so you can jump into the right workflow immediately.
- Design tables visually with the Table Designer, then export accurate SQL for new schemas without leaving the app.
- Filter any dataset faster using the Quick Filter toolbar: switch between simple search, raw WHERE clauses, or let the AI generate filters and human-readable explanations for you.
- Sort columns directly from the TableDataGrid header menu, pin or hide them, and act on hover icons for copy or foreign-key navigation without breaking your editing flow.
- Enjoy a smarter SQL editor with CodeMirror, context-aware completion, hover tooltips, semantic linting, Postgres-aware parsing, and worker-powered linting for instant feedback on large scripts.
- Automatically stay up to date thanks to the integrated Tauri updater plugin and in-app UpdateChecker for downloading and installing new versions.
- Opt into crash and performance reporting with the new Sentry integration, complete with user-controlled telemetry settings in Preferences.

### Improvements
- Data grids feel snappier with optimized column sizing/visibility, persistent sizing, clearer loading states, and richer status bars, making large tables easier to explore.
- Tab-specific connections and improved query context detection keep streaming queries, AI actions, and SQL completion aligned with the active workspace.
- Table Structure, Indexes, and Triggers now highlight pending edits, allow inline adjustments, and surface detailed DDL previews so you can review changes confidently.
- Vault storage handles keychain prompts gracefully, skipping writes when access isn’t granted and surfacing helpful toasts to avoid data loss.
- The AI Assistant sidebar, prompt input, and tool outputs gained clearer layouts and copy-to-clipboard controls for smoother conversational workflows.

### Bug Fixes
- DataGrid components now honor nullable defaults, align Quick Filter UI elements, and render status and selection summaries consistently, eliminating visual glitches seen in 0.4.x.

### Breaking Changes
- Connection management moved to the Home Screen; the legacy ConnectionDialog and ConnectionList have been removed, so update any scripts or workflows that relied on those legacy components.

## [0.4.0] - 2025-11-17

### Added
- End-to-end SSH tunneling and AWS SSM bastion support with rate limiting, tests, and user guides so remote databases can be reached securely from DevDB Studio.
- Real-time data invalidation bus plus table-level default sorting, ensuring grids auto-refetch after commits, SQL mutations, or Cmd+S shortcuts without stale data.
- Revamped AI assistant stack featuring a dedicated chat hook, new Radix-based conversation components, richer prompts, sidecar health checks, and a rebuilt panel focus manager.
- Workspace quality-of-life enhancements: drag-and-drop connection reordering, connection window tracking, duplicate/validation flows in the dialog, themed loading screen, and macOS traffic-light positioning for Tauri windows.
- Comprehensive table structure/index utilities, including command factories, custom cell renderers, confirmation toasts for unsaved changes, undo flows in Global Changes, and pending-change indicators across CRUD experiences.
- New UI primitives (button/input groups, hover cards, progress indicators, table toolbars, shared dialogs) that back modernized onboarding, window management shortcuts, and connection logos for every supported engine.

### Changed
- **BREAKING:** Workspaces now always open in dedicated windows with new close-handling, shortcut scopes, and cache-clearing rules—any automations relying on in-window navigation or shared vault lifecycles must be updated.
- Release, signing, and notarization workflows were upgraded for macOS DMG distribution, AWS Session Manager sidecars, and shell plugin initialization, aligning desktop builds with the latest Tauri toolchain.
- Data grid editors commit values before navigation, auto-select first cells on focus, and expose JSON copy commands while cache manager and tab-state logic preserve query results across auto-refresh cycles.
- Vault loading, window destruction, and connection auto-reconnect flows were overhauled for faster startup, URL-aware schema switching, and reliable background fetches.

### Fixed
- Cmd+S commit flow, unsaved-change detection, and invalidation broadcasts now fire consistently, preventing silent failures and ensuring optimistic updates clear once refetches complete.
- Sidecar shutdown, HTTP server lifecycle, and connection auto-reconnect logging handle edge cases without crashes or stale notifications, improving desktop stability.

### Removed
- Legacy AI sidebar components, mock providers, and unused Rust AI sessions were retired in favor of the new chat stack, and obsolete sidecar manifests were deleted to streamline packaging.

## [0.3.0] - 2025-11-17

### Added
- End-to-end SSH tunneling and AWS SSM bastion support, including rate limiting, new tests, and companion guides for secure remote database access.
- Real-time data invalidation bus with default table sorting so grids auto-refetch after commits, SQL mutations, or Cmd+S shortcuts.
- Revamped AI assistant with a dedicated chat hook, sidecar health checks, richer Radix-based components, and improved prompt routing.
- Workspace quality-of-life features: drag-and-drop connection reordering, connection window tracking, duplicate/validation flows in the dialog, and macOS code signing/notarization assets.
- Modernized onboarding UI with a branded loading screen, theme management, and refreshed database logos.
- Table structure/index utilities (command factories, custom cell renderers, shared toolbar actions) plus confirmation toasts and pending-change indicators across CRUD flows.

### Changed
- BREAKING: Workspaces now always open in dedicated windows, with new close-handling rules and keyboard shortcuts—automations that assumed in-window navigation must be updated.
- Data grid editors commit before navigation, keep refs for original values, auto-select on focus, and expose JSON copy commands for more reliable editing.
- Query panel caching, auto-refresh, and cache manager APIs now maintain tab state and invalidate queries after mutations.
- Vault loading, window destruction, and panel focus handling were overhauled for faster startup and more predictable shortcuts.
- Release workflows and Tauri configs now target the latest CLI/build versions with notarized macOS artifacts and shell plugin initialization.

### Fixed
- Cmd+S commit flow and unsaved-change detection now fire reliably, preventing silent failures when broadcasting grid invalidations.
- Sidecar shutdown, HTTP server lifecycle, and connection auto-reconnect logging now handle edge cases without crashes or stale notifications.

### Removed
- Legacy AI sidebar components (auto-resize textareas, mention autocomplete, old model selectors, mock providers, and unused Rust sessions) were retired in favor of the new chat stack.

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
