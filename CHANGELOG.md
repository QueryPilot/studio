# Changelog

<!-- All notable changes to Query Pilot will be documented in this file. -->

<!-- The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), -->
<!-- and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). -->

## [2026.1.0-beta.18] - 2026-04-08

### Improvements
- Enabled ARM builds by default for broader platform coverage.
- Simplified build scripts and improved release pipeline smoke tests.

## [2026.1.0-beta.16] - 2026-04-07

### New Features
- Added Windows support with NSIS installer and code signing.
- Added Linux support with deb, AppImage, and rpm packages.
- Added Trino multi-catalog support. You can now browse, filter, and query across multiple Trino catalogs with a 3-level catalog-schema-table sidebar tree, per-catalog visibility controls, and cross-catalog SQL linting and autocomplete.
- Enabled write support (insert, update, delete) for Trino in the data grid.

### Improvements
- Improved platform compatibility by conditionally applying macOS-specific overlay titlebar and padding on non-macOS platforms.
- Migrated release publishing to QueryPilot/studio repository.

### Bug Fixes
- Fixed Trino sidebar filter to show all catalogs with schema sub-filters and corrected table click behavior.

### Security
- Added GPG signing for Linux AppImage and RPM packages.

## [2026.1.0-beta.15] - 2026-04-05

### New Features
- Added native Trino support. You can now create Trino connections, browse catalogs and schemas, and run Trino queries from the same workspace as your other databases.

### Improvements
- Improved the SQL editor for Trino with dialect-aware linting, completion, and formatting. Generated queries now use Trino-friendly boolean syntax, which reduces manual cleanup before execution.
- Improved Trino connection setup across the app. Query Pilot now recognizes Trino connection strings and environment-based configs more reliably, making it easier to import existing setups.
- Updated in-app version reporting so the version shown in the UI matches the build you installed.

### Bug Fixes
- Fixed a production startup issue that could cause the app to open and immediately close in some builds with error reporting enabled.
- Fixed file loading in the Welcome screen so onboarding and local file access work correctly in Tauri 2 builds.

## [2026.1.0-beta.14] - 2026-04-04

### New Features
- Added Oracle support in beta, so you can connect to Oracle databases, browse schema objects, run queries, view explain plans, and work with Oracle-aware SQL editing in one place.
- Added DuckDB support for local analytics workflows, including native DuckDB parsing, progressive query results, backups, extension management, and import flows from files and URLs.
- Added secure tunnel workflows for remote databases with reusable SSH and AWS SSM tunnel profiles, plus auth profiles for static credentials, environment credentials, and Azure AD SAML sign-in.
- Added SQL query variables with inline highlighting, variable chips, and a dedicated variables panel, making it much easier to run parameterized queries without editing the SQL text each time.

### Improvements
- Made large and batch query runs feel smoother. Results stream in more progressively, row counts show clearer loading states, and the UI stays more responsive while you switch tabs.
- Improved the Command Palette with focused modes, mode badges, and smarter filtering, so you can narrow searches faster and jump to the right action with less noise.
- Improved result grid defaults for both SQL and document databases. Primary-key and `_id` sorting now appear more predictably, making fresh result sets easier to scan.
- Expanded Preferences and connection setup with dedicated panels for integrations, auth profiles, and tunnel profiles, plus clearer PostgreSQL pooler mode options and connection progress feedback.
- Improved database coverage across the app with better DuckDB and Oracle handling in schema inspection, SQL validation, imports, and connection parsing.

### Bug Fixes
- Fixed `Cmd+L` behavior so the AI panel closes when focus is already inside it instead of repeatedly stealing focus.
- Fixed command palette state issues that could cause stale search text, inconsistent toggles, or incorrect filtering when switching modes.
- Fixed PostgreSQL pooler mode issues that could break explicit transactions, multi-statement scripts, and some write operations with no returned columns.
- Fixed several streaming and grid issues that could cause unstable row counts, misleading sort indicators, or rendering problems while results were still loading.
- Fixed multiple cell editor edge cases that could trigger phantom writes or unwanted value normalization in date/time, numeric, interval, network, XML, and reference fields.
- Fixed DuckDB backup and restore edge cases with safer recovery behavior, better temporary-file cleanup, and more reliable handling of special values and multi-statement SQL.
- Fixed Oracle schema browsing to hide internal sequences and reduced false validation errors for some database objects.

### Security
- Tightened tunnel security by binding SSH port forwards to `127.0.0.1` instead of exposing them on all local interfaces.
- Fixed an XSS issue in the tunnel login flow and closed several lifecycle leaks that could leave tunnel resources open longer than intended.

## [2026.1.0-beta.13] - 2026-03-23

### New Features
- Redesigned the MongoDB collection workbench with dedicated Data, Structure, Indexes, Aggregation, Validation, and Explain tabs. You can now inspect collections in table, tree, or raw JSON views and work with large datasets more comfortably.
- Added a visual MongoDB aggregation builder with draggable stages, per-stage previews, and a code view. Complex pipelines are easier to build, understand, and debug without leaving the workbench.
- Expanded execution plan support across PostgreSQL, MySQL/MariaDB, SQL Server, and SQLite. You can now view more EXPLAIN and SHOWPLAN formats directly in Query Pilot, including SQL Server statistics plans and PostgreSQL XML/YAML output.
- Added in-app approval prompts for AI actions that need permission. Prompts now show clearer connection context so you can review sensitive actions before they run.

### Improvements
- Made SQL linting much smarter across dialects. Query Pilot now catches more real issues in INSERT/UPDATE/DELETE targets, aliases, joins, and schema references while cutting down on false positives.
- Improved query feedback in the editor. DDL statements, CTE-wrapped mutations, and per-tab SHOWPLAN state now surface clearer success states and more useful result presentation.
- Made tabs and heavy panels feel faster with better rendering behavior and visible loading indicators. Switching between complex views is smoother, especially in busy workspaces.
- Refined editing across grids and document views with better paste handling, editor resizing, UUID validation, and more reliable inline editing in tree and JSON modes.
- Improved AI-assisted filtering for SQL and MongoDB with cleaner generated filters and richer schema context, making natural-language filtering more dependable.

### Bug Fixes
- Fixed multiple execution-plan parsing edge cases so EXPLAIN and SHOWPLAN output render more accurately across MySQL, MariaDB, PostgreSQL, SQL Server, and SQLite.
- Fixed MongoDB staged edits, inserts, deletes, and index actions so changes stay in sync across table, tree, and JSON views.
- Fixed Redis element deletion so removing an item from a list or sorted set no longer removes the entire key.
- Fixed several workbench UI regressions, including layout shifts on tab focus, SQL infinite-scroll loops, and focus issues in editor overlays and the Redis CLI.
- Fixed date formatting and editing issues that could shift values unexpectedly across time zones, helping preserve the local date users intended.

### Security
- Hardened SQL Server rename workflows against unsafe input.
- Improved local vault/keychain handling and permission approval flows, giving safer credential retrieval and clearer prompts for sensitive actions.

## [2026.1.0-beta.12] - 2026-03-13

### New Features
- Added smart nested array views in the document grid. Query Pilot now shows object arrays as tables and mixed arrays as typed-value lists, making complex documents easier to inspect.
- Added nested-view search with background worker processing. You can filter large nested datasets without blocking the UI.
- Added a new Flatten depth control for document views. You can quickly tune how much nested structure appears in the grid.
- Added a redesigned Inspector tree with syntax-highlighted JSON, collapsible nodes, inline value editing, inline subtree editing, and undo at the field level.
- Added MongoDB query result modes for both Data and JSON views. You can switch between tabular exploration and raw result inspection more easily.
- Added Redis database filtering in the sidebar with per-connection persistence. You can choose which DBs stay visible and Query Pilot now respects server-configured DB counts.
- Added new Command Palette actions for MongoDB and Redis workflows, including quick open actions and copyable Redis `SELECT` commands.
- Added new tab management commands in the workbench to close tabs/panels faster and merge tabs into a single panel.
- Added an in-app changelog popover in Preferences so you can review release notes without leaving the app.

### Improvements
- Improved staged-change visibility in the data grid and Inspector, including better highlighting for nested document edits.
- Improved selection persistence in the grid when toggling Inspector with active filters, so your current row context is retained.
- Improved keyboard handling in grid-heavy views so typing in editors and text inputs no longer conflicts with grid shortcuts.
- Improved SQL editor safety and feedback with diagnostics status and confirmation prompts for destructive queries.
- Improved SQL metadata and reconnect behavior so schema/lint context refreshes more reliably after reconnecting.
- Improved sidebar filtering for database functions with a toggle between user-created functions and the full function list.

### Bug Fixes
- Fixed nested Inspector edits that could corrupt parent objects. Edits now apply cleanly at the correct subtree level.
- Fixed array drill-down when filtered so opening an item targets the correct original element.
- Fixed MongoDB flatten projection path collisions that could break deeper flatten operations.
- Fixed drillable cell preview overflow and navigation icon visibility issues for clearer in-grid navigation.
- Fixed Redis DB selection behavior by removing hardcoded DB limits, improving compatibility with non-default Redis setups.
- Fixed keyboard capture edge cases where internal hidden inputs could interfere with normal editing.
- Fixed workspace title bar labeling and connection-count display for clearer context in single- and multi-connection workspaces.

## [2026.1.0-beta.11] - 2026-03-08

### New Features

- Reference connections, tables, views, functions, and open tabs directly in AI chat with inline `@` mentions. Query Pilot now resolves the right database context for you, even when similar names exist across multiple connections.
- Give the AI assistant better context automatically. Your focused tab now attaches to each message, and you can add images with preview before sending for query help, schema questions, and troubleshooting.
- Keep typing while the AI is still responding. You can queue follow-up prompts, review or remove them, and let Query Pilot send them automatically when the current turn finishes.
- Recover from SQL errors faster with `Fix with AI`. Send a failed query to the assistant in one click instead of rewriting the prompt yourself.
- Connect local AI workflows through the new `querypilot` CLI agent, which gives external AI tools access to live workspace context from Query Pilot.
- Use the new multi-dialect Explain experience to inspect execution plans across PostgreSQL, MySQL, SQLite, and SQL Server in one consistent view.
- See the SQL statement you are about to run more clearly with current-statement highlighting in the editor.
- Run AI-assisted, read-only SQL with `query.run` to inspect live data and get timed results without allowing write operations.

### Improvements

- Made AI mentions and tab references clearer by showing connection details, so similarly named objects are easier to distinguish across databases.
- Made AI tool calls easier to follow with clearer, human-readable action descriptions.
- Improved AI chat usability with better input focus retention, visible mention badges, faster message copying, and more consistent send and stop controls during streaming.
- Made SQL data edits more type-aware across PostgreSQL, MySQL, SQL Server, and SQLite, so inserts, updates, deletes, and some schema changes generate cleaner, more accurate SQL.
- Smoothed large result streaming with adaptive update pacing, which keeps the UI more responsive when queries return heavy output.
- Improved SQL editor performance on large scripts by limiting highlight work to visible lines and avoiding unnecessary dialect detection.
- Made query export actions easier to find in the Query panel.
- Refined Preferences layouts across AI, General, Keyboard Shortcuts, and Telemetry pages to use space better and feel more consistent.
- Improved connection grouping when real and auto-created workspaces are mixed, making workspace lists easier to understand.
- Reduced unnecessary query tab state writes, which cuts background churn and improves overall responsiveness.

### Bug Fixes

- Fixed AI cancellation race conditions so stopping a response is more reliable and cancelled turns show a clear cancelled state.
- Fixed queued AI prompts so they keep their full context when resumed, and message entry stays available while a response is streaming.
- Restored background query execution handling in the Query panel, so background runs trigger correctly again.
- Removed duplicate execute-event handling that could cause redundant statement parsing and extra execution overhead.
- Added a warning before the AI prompt queue reaches its limit, which helps prevent confusing send failures.

### Breaking Changes

- Renamed the CLI/sidecar binary from `querypilot-mcp` to `querypilot`. Update any scripts, aliases, or automation that still reference the old name.
- Replaced legacy MCP-sidecar integration paths with the new Query Pilot agent flow. Custom integrations built on the old internals may need updates.

### Security

- Hardened AI-triggered query execution with read-only validation, execution time limits, and row caps to better protect live databases.
- Validated parsed `querypilot` commands before execution to reduce command-injection risk in local AI workflows.
- Automatically reject late AI permission requests after a session is canceled, which lowers the chance of approving an action from a session you already stopped.
