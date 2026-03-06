# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [2026.1.0-beta.11] - 2026-03-06

### New Features
- Connect local AI workflows through the new `querypilot` CLI agent, which now links to Query Pilot over a local socket for workspace-aware assistance.
- Use a new multi-dialect Explain experience that parses and presents execution plans across PostgreSQL, MySQL, SQLite, and SQL Server in a consistent way.
- See your active SQL statement more clearly with current-statement highlighting in the editor, making execution intent easier to verify.
- Run AI-assisted, read-only SQL via `query.run` to quickly inspect data and get timed results without allowing write operations.

### Improvements
- AI tool calls are now shown with clearer, human-readable descriptions, so you can understand actions faster.
- AI chat workflows are smoother with improved input focus retention, clearer mention badges, and faster copy-message actions.
- Query export actions in the Query panel are easier to access and use.
- Large result sets now stream more smoothly with adaptive update pacing, keeping the UI responsive during heavy output.
- SQL editor performance is better on large scripts by limiting highlight work to visible regions and avoiding unnecessary dialect detection.
- Query tab state updates now skip no-op writes, reducing background churn and improving overall responsiveness.
- Connection grouping is more accurate when mixing real and auto-created workspaces.

### Bug Fixes
- Restored background query execution handling in the Query panel so background runs trigger correctly again.
- Removed duplicate execute-event handling that could cause redundant statement parsing and extra execution overhead.

### Breaking Changes
- The CLI/sidecar binary name changed from `querypilot-mcp` to `querypilot`; update any scripts, aliases, or automation that referenced the old name.
- Legacy MCP-sidecar integration paths were replaced by the new Query Pilot agent/socket flow; custom integrations using old internals may need updates.

### Security
- Hardened CLI command execution by validating parsed `querypilot` commands to reduce command-injection risk.
- Added guardrails for AI-triggered query execution with read-only validation, execution time limits, and row caps to better protect live databases.

## [2026.1.0-beta.10] - 2026-03-05

### Improvements
- Releases now follow one consistent publishing flow, so version labels are easier to understand and simpler to automate against.
- Release assets are handled more cleanly during publishing, which makes downloads clearer and reduces release-time friction.

## [2026.1.0-beta.10] - 2026-03-05

### Improvements
- Improved MCP sidecar discovery by checking the installed app location first, so AI features start more reliably across different local setups.

### Bug Fixes
- Updated the AI panel error message when the MCP sidecar is missing, with clearer guidance to restart Query Pilot or reinstall so you can recover faster.

## [2026.1.0-beta.9] - 2026-03-05

### New Features
- Command Palette search now handles normalized query variants and underscore-style names, so you can find commands and database objects with fewer exact keystrokes.

### Improvements
- Release packages now include both `aarch64` and `x86_64` artifacts, making installs and updates smoother across different CPU architectures.

### Bug Fixes
- Fixed an issue where sidebar visibility could reset when switching database connections, so your workspace layout stays the way you left it.
- Improved workspace initialization to preserve sidebar state more consistently when opening and changing connections.

## [2026.1.0-beta.8] - 2026-03-04

### Improvements
- Improved the release packaging and publishing flow to make beta updates more reliable and reduce the risk of missing update artifacts.
- This beta focuses on release stability and distribution quality, with no changes to core app features or database workflows.

## [2026.1.0-beta.8] - 2026-03-04

This beta release includes no user-facing changes. It focuses on internal release workflow updates to improve reliability for future publishes.

## [2026.1.0-beta.8] - 2026-03-04

### Improvements
- Improved release delivery reliability after the repository move, so update metadata and release links now resolve consistently.
- Streamlined local build targeting for Apple Silicon (`aarch64-apple-darwin`), making native macOS builds more predictable on M-series Macs.

### Bug Fixes
- Fixed outdated repository references in release automation that could point to the wrong project path during packaging and publishing.

## [2026.1.0-beta.8] - 2026-03-04

### New Features
- Manage app updates in a new in-app Update dialog. You can now check for updates, review release notes, download updates, and install them with a guided `Restart & Install` flow.
- Choose `Restart Later` after an update is downloaded. Query Pilot will remember the deferred update and apply it on your next launch.
- Control update behavior from Preferences with a new `Auto-check updates on startup` toggle.

### Improvements
- Unified update actions across the app menu, title bar, home screen, and Preferences so every update entry point follows the same workflow.
- Auto-checks can now pre-download eligible patch updates in the background, reducing wait time when you decide to install.
- Improved macOS update delivery so in-app updates are available more reliably.

### Bug Fixes
- Fixed update flow edge cases that could leave stale status or unclear messaging during check, download, or install.
- Improved command/tool detection reliability for ACP workflows on macOS by honoring your shell environment path.

### Security
- Strengthened macOS update integrity by consistently publishing and validating signed updater artifacts.
