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

- Start faster with the new Home Screen, featuring an action bar, recent connection cards, ERD workspace shortcuts, and an inline ConnectionForm so you can jump into the right workflow immediately.
- Design databases visually with the Table Designer: add columns, define constraints, preview SQL, and export ready-to-run CREATE statements without leaving the app.
- Explore data with the upgraded Quick Filter, now powered by CodeMirror for SQL editing, raw WHERE clause support, AI-generated filters plus explanations, and per-column header menus for sorting, pinning, or hiding columns.
- Work smarter in the SQL editor thanks to context-aware completions, INSERT/UPDATE helpers, hover tooltips, worker-backed linting, semantic validation, PostgreSQL parsing, and new code actions like expanding `SELECT *`.
- Stay current effortlessly: the integrated Tauri updater plugin plus the in-app UpdateChecker handle version checks, downloads, and installations right from the desktop shell.
- Opt into telemetry with confidence—Sentry integration now offers crash and performance reporting that you fully control from the Preferences panel.

### Improvements

- TableDataGridV2 feels snappier with optimized column sizing + visibility handling, richer loading states, faster hover icons for copy/FK links, smarter paste handling, and persistent preferences for column layout.
- Streaming queries respect tab context so AI actions, completion, and query execution stay aligned with the active workspace; query panels now surface clearer result messaging for mutations, DDL, and transactions.
- Table Structure, Indexes, and Triggers gain editable grids, improved row theming, and detailed DDL previews so you can review pending schema changes confidently.
- Vault storage gracefully handles keychain prompts, skipping writes when access is denied while surfacing actionable toasts to prevent data loss.
- AIAssistant, Workbench tabs, and shared UI components pick up layout refinements, keyboard shortcut hints, and Tabler icons for a more cohesive experience across the app.

### Bug Fixes

- Data grids now honor nullable defaults, keep Quick Filter UI aligned, and render selection/status summaries consistently, eliminating the visual glitches seen in 0.4.x.

### Breaking Changes

- Connection management now lives entirely on the Home Screen; the legacy ConnectionDialog and ConnectionList have been removed, so update any scripts or workflows that referenced those components.

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
