# Data Grid v2 Reference (Read-Only Baseline)

**Status**: ✅ **Current**  
**Last Updated**: 2025-11-01

## Overview

DataGridV2 is the shared grid layer for DevDB Studio. As of October 2025 the application operates in **read-only mode**: the grid focuses on fast rendering, streaming results, column personalization, and clipboard export. All create/update/delete workflows and the table-edit store were removed pending a redesign.

## Current Responsibilities

- Render table data and ad-hoc query results using Glide Data Grid virtualization.
- Provide the shared shell (status bar, skeleton, empty/error states) for table and query screens.
- Persist view preferences (column order/width/visibility, pinned rows, scroll offsets) through `gridPreferencesStore`.
- Expose clipboard export shortcuts (TSV by default, JSON on Cmd/Ctrl+Shift+C).
- Support column and row pinning for analysis workflows.
- Coordinate with `useTableDataQuery` to stream pages and indicate loading state.

## Removed in Oct 2025 Cleanup

- Cell editors, trailing-row add buttons, paste-to-insert, and delete callbacks.
- Pending edits drawer, `tableEditStore`, undo stacks, and SQL preview/apply services.
- Global commands and toolbar actions that referenced pending edits.
- Tab-close confirmation for unsaved edits.

## Folder Snapshot

```
src/components/DataGridV2/
├── adapters/
│   └── TableDataGridV2.tsx           # Read-only adapter for tables & queries
├── base/                             # Glide wrapper components
├── components/                       # Status bar, context menus, skeletons
├── hooks/                            # Clipboard, pinning, sizing, view state
├── renderers/                        # Display-only cell renderers
├── stores/                           # Grid preference persistence (Zustand)
└── utils/                            # Value formatting, copy/export helpers
```

### Table Adapter Notes

- Uses `useTableDataQuery` to hydrate rows and track streaming progress.
- Maintains row keys via primary keys or synthetic fallbacks for stable selection.
- Surfaces presentation-only props to `EditableDataGrid`; mutation callbacks are undefined.
- Still respects pinned rows/columns and selection persistence through the preference store.

### Clipboard & Pinning

- Cmd/Ctrl+C → TSV of visible cells; Cmd/Ctrl+Shift+C → JSON array.
- Up to 5 pinned columns and 5 pinned rows per grid, keyed by `gridId` in preferences.
- Context menu retains pin/unpin and copy/export entries; editing entries have been excised.

## Migration Summary

- Deleted `tableEditStore` (store, types, selectors) and related services (`applyChangesService`, `sqlPreviewService`, `validationService`).
- Removed Pending Edits indicator/drawer UI and associated commands.
- Simplified workbench close logic; no edit scope lookups remain.
- Updated docs (`docs/README.md`) to mark the editing spec as removed.

## Future Work

- Produce a replacement spec once the redesigned CUD workflow is defined (placeholder: `table-editing-redesign.md`).
- Audit hooks/components under `src/components/DataGridV2/hooks/` to prune editing-specific utilities when safe.
- Evaluate re-introducing editors after the new architecture is approved.

## Related Documents

- `api.spec.md` – Backend query/cell contract consumed by the grid.
- `workspace-screen.spec.md` – Workbench integration details for grid panels.
- `docs/README.md` – Documentation index highlighting the CUD removal.

