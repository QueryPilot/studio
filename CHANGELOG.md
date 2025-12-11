# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed



## [0.10.0] - 2025-12-11

### New Features
- Work faster in the new high-performance SQL editor with smarter autocompletion, semantic highlights, and focus-aware shortcuts.
- Explore query output in more ways with new “raw” and “stats” views, plus a redesigned explain viewer that surfaces timing, JIT, and trigger details at a glance.
- Set a default schema for PostgreSQL and SQL Server connections directly in the connection form, and prioritize it in schema selection and toggles.

### Improvements
- Money and numeric cells validate and edit more reliably, with safer decimal handling for PostgreSQL parameters.
- Staged grid updates replace older edits for the same cell, reducing accidental overwrites during batch changes.
- Explain results now reset when you return to the default table view, keeping the panel in sync with your latest query.
- macOS releases ship as universal builds, so you get a single download that runs natively on both Apple Silicon and Intel.

### Breaking Changes
- Vim keybindings are no longer available in the SQL editor.

## [0.9.0] - 2025-12-04

### New Features
- Sign in with Azure AD SAML to request AWS roles and open database sessions, with a role picker and automatic STS credential handling.
- Spin up ephemeral ECS bastion hosts and SSM tunnels on demand for secure, time-limited access to private databases.
- Filter tables with advanced pattern search: regex, boolean logic, column targeting, grouping, anchors, and wildcards, plus cached parsing and auto-submit.
- Control DataGrid columns with a visibility menu, copy either selected cells or full rows, and manage insert/update/delete with staged change indicators.
- Get smarter SQL help: JOIN condition suggestions from keys or name matching, and completions that respect table/CTE aliases and JOIN ON context.
- AI text-to-SQL and chat flows now use richer schema metadata and cross-table context, with retries, rate limiting, and metrics for more reliable answers.

### Improvements
- QuickFilter is memoized and caches parsed queries for snappier re-use; duplicate submissions are skipped automatically.
- Column headers show clearer type icons and updated context menus; per-table view preferences persist by connection, schema, and table.
- Data streaming and grid transforms handle raw arrays more reliably, improving hover highlights and reducing UI glitches.
- Date/time and text editors respond better to content size and focus, reducing accidental closes and improving readability.
- Connection and workspace panels are streamlined for faster setup, with improved tunnel handling flows.
- Release helpers and UpdateChecker messaging are clearer for local builds and update checks.

### Bug Fixes
- PostgreSQL structure view now shows full data types and restores index usage statistics, including unused-index warnings.
- QuickFilter keyboard handling works correctly with contenteditable inputs; empty-value resets preserve the intended mode.
- Copy and SQL export actions use real column names, keeping headers aligned with the visible columns.
- DataGrid hover states, table transforms, and JSON/INSERT exports align with visible data, preventing mismatched selections.
- Various store and service fixes improve tab state, CRUD flows, and workspace panels stability.

## [0.8.0] - 2025-12-04

### New Features
- Sign in with Azure AD SAML to request AWS roles and open database sessions, including a role selection dialog and automatic STS credential handling.
- Spin up ephemeral ECS bastion hosts and SSM tunnels on demand for secure, time-limited access to private databases, with automatic cleanup on disconnect.
- Use powerful pattern search in QuickFilter (regex, boolean logic, column targeting, grouping, anchors, wildcards) to zero in on the rows you need.
- Control DataGrid columns with a visibility menu, and copy exactly what you need (selected cells vs. full rows) while keeping per-table view preferences.
- Edit data directly in TableDataGrid with new insert, update, and delete controls backed by the CRUD pipeline and staged change indicators.
- Get smarter SQL assistance: JOIN condition suggestions from foreign keys and name matching, plus completion that respects table/CTE aliases and JOIN ON context.

### Improvements
- Text-to-SQL and AI filters now use richer schema metadata, cross-table context, retries, rate limiting, and metrics for more accurate and reliable answers.
- QuickFilter submits automatically after brief inactivity and skips re-parsing repeated queries thanks to LRU caching for snappier filtering.
- Column headers gain clearer type icons and updated context menus; preferences persist per connection, schema, and table for consistent layouts.
- Date/time and text editors feel smoother with better focus handling, accurate sizing, and guarded closing behavior inside the grid.
- Connection and workspace panels are streamlined for faster setup and clearer navigation, including improved tunnel handling flows.

### Bug Fixes
- PostgreSQL structure view now shows full data types (e.g., `character varying(10)`) and restores index usage stats with unused-index warnings.
- QuickFilter keyboard handling works correctly with contenteditable inputs, and empty-value resets keep the intended mode.
- Copy and SQL export actions use real column names, preventing mismatched headers, and JSON/INSERT exports align with visible columns.
- Data streaming and table transforms handle raw arrays more reliably, reducing hover glitches and improving row/cell highlighting.

## [0.8.0] - 2025-12-04

### New Features
- Sign in with Azure AD SAML to assume AWS roles directly from Query Pilot, including a guided role picker for multi-role responses.
- Spin up ephemeral ECS Fargate bastion tunnels on demand for secure database access; tunnels auto-clean on disconnect.
- Work faster in DataGrid with built-in insert/update/delete actions, per-connection/schema/table view preferences, and separate “copy cells” vs. “copy rows” options.
- Apply powerful quick filters with regex, boolean logic, column targeting, wildcards, anchors, and automatic validation limits.
- Get smarter SQL assistance: JOIN condition suggestions from foreign keys, richer alias-aware completion, and metadata-aware AI text-to-SQL with cross-table context.
- Browse databases with unified dialect handling and a new Postgres introspection flow for more accurate schemas, relationships, and type metadata.

### Improvements
- Toggle column visibility from the header menu, and copy/export now uses real column names for JSON/INSERT output.
- Quick Filter auto-submits after short pauses, caches recent parses, and avoids redundant re-renders for snappier filtering.
- DataGrid editing feels smoother: better keyboard handling, refined hover states, new column type icons, improved date/time picker behavior, and auto-sized text inputs.
- AI chat and text-to-SQL add rate limiting, richer metrics, and clearer error feedback to keep responses reliable.
- Table and schema views now surface PK/FK metadata, healthier index usage stats, and more readable type names.
- Command Palette and sidebar updates streamline model selection, preferences, and panel/workbench layouts for multi-panel workflows.

### Bug Fixes
- Postgres column types now display formatted names (e.g., `character varying(10)`) and index usage statistics are restored with unused index warnings.
- Quick Filter preserves mode prefixes when clearing values and correctly handles contenteditable keyboard events.
- Table streaming outputs and copy actions use accurate column mappings, preventing mismatched data during export and AI-assisted queries.


## [0.8.0] - 2025-12-04

### New Features
- Sign in with Azure AD SAML to assume AWS roles directly from Query Pilot, including a guided role picker for multi-role responses.
- Spin up ephemeral ECS Fargate bastion tunnels on demand for secure database access; tunnels auto-clean on disconnect.
- Work faster in DataGrid with built-in insert/update/delete actions, per-connection/schema/table view preferences, and separate “copy cells” vs. “copy rows” options.
- Apply powerful quick filters with regex, boolean logic, column targeting, wildcards, anchors, and automatic validation limits.
- Get smarter SQL assistance: JOIN condition suggestions from foreign keys, richer alias-aware completion, and metadata-aware AI text-to-SQL with cross-table context.
- Browse databases with unified dialect handling and a new Postgres introspection flow for more accurate schemas, relationships, and type metadata.

### Improvements
- Toggle column visibility from the header menu, and copy/export now uses real column names for JSON/INSERT output.
- Quick Filter auto-submits after short pauses, caches recent parses, and avoids redundant re-renders for snappier filtering.
- DataGrid editing feels smoother: better keyboard handling, refined hover states, new column type icons, improved date/time picker behavior, and auto-sized text inputs.
- AI chat and text-to-SQL add rate limiting, richer metrics, and clearer error feedback to keep responses reliable.
- Table and schema views now surface PK/FK metadata, healthier index usage stats, and more readable type names.
- Command Palette and sidebar updates streamline model selection, preferences, and panel/workbench layouts for multi-panel workflows.

### Bug Fixes
- Postgres column types now display formatted names (e.g., `character varying(10)`) and index usage statistics are restored with unused index warnings.
- Quick Filter preserves mode prefixes when clearing values and correctly handles contenteditable keyboard events.
- Table streaming outputs and copy actions use accurate column mappings, preventing mismatched data during export and AI-assisted queries.

## [0.7.0] - 2025-11-27

### New Features
- Work faster in the SQL editor with dedicated PostgreSQL parsing and linting workers, giving immediate feedback tailored to your selected dialect.
- Enjoy smoother autocomplete and linting from the first keystroke thanks to pre-initialized workers and smarter request handling across PostgreSQL, MySQL, SQLite, and MSSQL.

### Improvements
- Edit large result sets with less lag: DataGrid updates now avoid redundant transforms, cache repeated work, and keep quick filters responsive during heavy input.
- Stream query results more reliably with background decode workers that reduce UI stalls while data loads.
- See clearer diagnostics: standardized logging replaces ad hoc console output so issues surface with better context.
- SQL completion and hover feel snappier with content deduplication, caching, and cancellation of outdated requests to prevent slowdowns.
- Query workspace panels and sidebars render more efficiently through memoized selectors and reduced re-renders, keeping navigation fluid.

### Bug Fixes
- SQL metadata and completion now ignore common transient errors, preventing interruptions while typing and browsing schemas.

## [0.6.1] - 2025-11-26

### Improvements
- Checking for desktop updates in Preferences now pulls the latest release feed and gives you a Download + Install flow with clearer status, instead of auto-installing in the background.
- Quick Filter mode switching is smoother: typing `?`, `#`, or `!` instantly swaps WHERE/AI/Search modes without stray prefixes, clearing/backspacing resets cleanly, and focus returns to the editor after changing modes.

### Bug Fixes
- Quick Filter no longer errors when an operator is typed without a column name, and Cmd+Backspace resets empty inputs back to search mode as expected.
- The telemetry toggle now rolls back and explains when the backend was built without telemetry support, so development builds don’t leave the switch in a broken state.

## [0.6.0] - 2025-11-26

### New Features
- Work in a multi-dialect SQL editor with context-aware autocomplete, real-time linting, and metadata hovers for PostgreSQL, MySQL, SQLite, and MSSQL.
- Pick and configure AI provider models in Preferences and the assistant sidebar, enabling or hiding models per provider so only allowed options appear.
- Track grid performance with built-in FPS and render-time monitoring to keep large tables feeling smooth.
- Use the refreshed desktop menu for dynamic actions plus built-in update checks and installs.

### Improvements
- QuickFilter switches modes instantly, debounces typing, and serves faster, more accurate suggestions for long SQL queries.
- DataGrid scrolling, column resizing, and cell editors are leaner, cutting redraws for snappier edits on big datasets.
- Query panel and toolbar manage SQL dialect selection more reliably, with clearer linting feedback while you type.
- AIAssistant sidebar layout is cleaner, making model choices and conversations easier to follow.
- Home screen connection form is clearer and steadier with improved placeholders and state handling.

### Bug Fixes
- Desktop updates are more reliable after correcting updater configuration and menu event handling.

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
