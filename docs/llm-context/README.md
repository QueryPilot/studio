# LLM Context Files

Detailed documentation for AI assistants working on Query Pilot. These files provide context beyond the minimal root `CLAUDE.md` and `AGENTS.md`.

## Index

| File                                                | When to Read                                       |
| --------------------------------------------------- | -------------------------------------------------- |
| [Architecture Overview](./architecture-overview.md) | Understanding the system design, adapters, IPC     |
| [Frontend Patterns](./frontend-patterns.md)         | Working on React components, Zustand stores, hooks |
| [Backend Patterns](./backend-patterns.md)           | Working on Rust commands, database adapters        |
| [Testing](./testing.md)                             | Writing or running tests                           |
| [Code Editor](./code-editor.md)                     | Working on SQL editor, linting, autocomplete       |
| [Security](./security.md)                           | Working with vault, keychain, credentials          |
| [Build and Release](./build-and-release.md)         | Building, signing, releasing the app               |
| [Dev Database Setup](./dev-database-setup.md)       | Setting up local databases for development         |

## Related Docs

These existing docs provide even deeper detail:

- [Query Execution Architecture](../architecture/query-execution.md) - Dual-path query system
- [DataGrid Adapter Architecture](../guides/datagrid-adapter-architecture.md) - Grid implementation
- [Adding New Databases](../guides/CONTRIBUTING_DB.md) - Database adapter guide
- [Workbench Layout](../architecture/workbench-layout.md) - Panel and tab management
