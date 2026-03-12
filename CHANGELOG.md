# Changelog

<!-- All notable changes to Query Pilot will be documented in this file. -->

<!-- The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), -->
<!-- and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). -->

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
