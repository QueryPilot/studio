# Documentation Directory

This directory contains technical documentation for the DevDB Studio project.

## Documentation Status Legend

- ✅ **Current** - Actively maintained, matches implementation
- 📋 **Reference** - Historical/research docs, valuable reference material
- 🔄 **Implementation Status** - Documents with implementation progress tracking

## Core Documentation

### Architecture & Research

- **`adr/0001_initial_research.md`** 📋 - Initial tech stack research and decisions
- **`adr/0002_research.md`** 📋 - Comprehensive architecture research for TablePlus-class database client

### API & Backend

- **`api.spec.md`** ✅ - Complete Tauri backend API specification
  - Database commands (connect, query, introspection)
  - CellValue structure and type handling
  - Adapter architecture (PostgreSQL, MySQL, SQLite, SQL Server)
  - Performance considerations

### Feature Documentation

#### Data Grid

- **`data-grid-v2.spec.md`** ✅ - DataGridV2 architecture and read-only usage
  - Focus on virtualization, column personalization, clipboard exports
  - Read-only adapters for table/query views after CUD removal (Oct 2025)

#### Query & Performance

- **`data-query.spec.md`** 🔄 - Query performance optimization strategy
  - Performance targets and bottleneck analysis
  - Streaming architecture redesign
  - Schema cache invalidation

#### ERD & Visualization

- **`erd-panel.spec.md`** ✅ - ERD panel implementation
  - DBML service integration
  - ReactFlow visualization with ELK layout
  - Dual-mode editing (visual + code)

#### DBML Support

- **`dbml-syntax-support.md`** ✅ - DBML syntax highlighting status

  - Comprehensive feature coverage
  - CodeMirror integration
  - Type and relationship support

- **`dbml-enhanced-features.md`** ✅ - Enhanced DBML editor features
  - Code folding implementation
  - Smart indentation
  - Auto-completion
  - Implementation details and usage

#### Database Features

- **`index_usage.spec.md`** ✅ - Index usage statistics
  - PostgreSQL implementation (with PG16+ support)
  - MySQL, SQL Server, SQLite support matrix
  - Performance metrics and caching

#### AI Assistant

- **`ai-assistant.spec.md`** ✅ - AI assistant implementation
  - Multi-provider support (OpenAI, Anthropic, Google, Ollama)
  - Bun HTTP sidecar architecture
  - Secure keychain API key storage
  - Cursor-style chat UI with @mentions
  - Latest October 2025 models

#### UI Components

- **`workbench.spec.md`** ✅ - VS Code-style workbench layout

  - Binary tree-based layout system
  - Panel splitting and resizing
  - Drag-and-drop implementation

- **`workspace-screen.spec.md`** ✅ - Workspace screen architecture

  - Title bar and sidebar components
  - Tab management
  - Connection binding

- **`theme-usage.md`** ✅ - Theme system reference
  - Color palette and CSS classes
  - Light/dark mode support
  - Component theming

## File Organization

### Keep These Files

All files currently in the `docs/` directory are actively maintained and provide value:

- Historical research provides context for technical decisions
- Implementation specs document current features and architecture
- Reference guides support development and onboarding

### Removed Files (2025-10-30 Cleanup)

The following outdated planning documents were removed:

- ❌ `connection.spec.md` - Outdated connection refactoring plan
- ❌ `editor-intellisense.spec.md` - Unimplemented SQL autocomplete plan
- ❌ `dbml-syntax-highlighter.spec.md` - Consolidated into `dbml-syntax-support.md`
- ❌ `dbml-linter-intellisense.spec.md` - Future work, removed to focus on current state
- ❌ `central-table-editing-store.spec.md` - Removed after deprecating table editing CUD flows (Oct 2025)

## Contributing to Documentation

When adding new documentation:

1. **Choose the right location**:

   - `adr/` - Architecture Decision Records
   - Root - Feature specifications and implementation guides

2. **Update this README** with:

   - File name and status (✅/📋/🔄)
   - Brief description
   - Key topics covered

3. **Use consistent headers**:

   - Executive Summary / Overview
   - Architecture / Implementation
   - Usage / Examples
   - Status / Implementation Timeline (if applicable)

4. **Mark implementation status**:
   - ✅ Implemented
   - 🚧 In Development
   - 📋 Planned

## Quick Reference

### Finding Information

| Looking for...         | See...                                                 |
| ---------------------- | ------------------------------------------------------ |
| Backend API reference  | `api.spec.md`                                          |
| Data grid usage        | `data-grid-v2.spec.md`                                 |
| ERD visualization      | `erd-panel.spec.md`                                    |
| DBML editor features   | `dbml-syntax-support.md`, `dbml-enhanced-features.md`  |
| Data grid architecture | `data-grid-v2.spec.md`                                 |
| Index statistics       | `index_usage.spec.md`                                  |
| AI assistant           | `ai-assistant.spec.md`                                 |
| Workbench layout       | `workbench.spec.md`                                    |
| Theme system           | `theme-usage.md`                                       |
| Architecture decisions | `adr/0001_initial_research.md`, `adr/0002_research.md` |

## Maintenance

This README should be updated when:

- New documentation is added
- Features are implemented or deprecated
- Major architectural changes occur
- Documentation is reorganized

**Last Updated**: 2025-11-01
