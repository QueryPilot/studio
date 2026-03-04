# Changelog

All notable changes to Query Pilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

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
