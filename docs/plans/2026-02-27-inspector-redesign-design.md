# Inspector Panel Redesign — Design Document

**Date:** 2026-02-27
**Status:** Approved

## Overview

Redesign the Inspector panel to support multi-record selection with merged views, inline editing, automatic diff (no manual baseline), and a high-performance Raw view using CodeEditor. Add `Cmd+J` keyboard shortcut and persist state per connection.

## Current State

- Single-record inspector with Tree/Raw/Diff tabs
- Manual "Set Baseline" button for diff comparison
- Tree view: read-only recursive JSON explorer
- Raw view: `<pre>` tag with `JSON.stringify`
- No keyboard shortcut
- Ephemeral state (not persisted)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Subcomponents (B) | Clean separation for Tree/Diff/Raw views, testable |
| Edit scope | All selected records | Editing any field stages changes for all selected rows |
| Diff display | Inline unified | Single list with reference + colored differences per row |
| Single-record editing | Always editable | Click a value to edit in place |
| Raw view engine | CodeEditor (CodeMirror) | Syntax highlighting, performance for large JSON |
| State persistence | Per-connection | Store open/closed + active tab in grid preferences |

## Architecture

### Component Structure

```
InspectorPanel (shell — tabs, header, record count badge)
├── InspectorTreeView   — merged key/value tree with inline editing
├── InspectorDiffView   — inline unified diff (first record = reference)
└── InspectorRawView    — JSON array via CodeEditor (read-only)
```

### Data Flow

```
BaseDataGrid
├── gridSelection.rows → collect ALL selected row indexes
├── Map indexes → effectiveDisplayRows[idx] → selectedRows: GridRowModel[]
├── Pass selectedRows[] + columns to InspectorPanel
└── InspectorPanel converts rows to documents internally
```

### Props Interface

```ts
interface InspectorPanelProps {
  selectedRows: GridRowModel[];
  columns: GridColumnV2[];
  onCellEdit?: (rowIndex: number, field: string, value: unknown) => void;
  className?: string;
}
```

**Removed:** `baselineRow`, `onSetBaseline` (no more baseline concept)
**Added:** `onCellEdit` callback for tree view inline editing, `selectedRows[]` replaces `selectedRow`

## Tree View

### Single Record

Flat key-value tree (like today), but each value is click-to-edit. Click a value → inline input field. On blur/enter → fires `onCellEdit(0, field, newValue)`.

### Multiple Records (2+)

Fields merged across all selected records:

```
id:          <multiple values>     [Badge: "42", "57", "91"]
name:        "John Doe"            (same across all → plain value, editable)
status:      <multiple values>     [Badge: "active", "pending"]
email:       "john@example.com"    (same → editable)
metadata:    {3 fields}            (expandable, recursively merged)
```

**Rendering rules:**
- Same value across all records → display value directly, click-to-edit
- Different values → `<multiple values>` text + small badges showing distinct values (max 3, then "+N more")
- Nested objects → recurse: merge children individually

**Editing:**
- Click any value (same or different) → inline input
- On commit → `onCellEdit` fires for each selected row index with the new value
- Stages CRUD edit commands for all selected records in the grid's undo/redo system

**Badge design:** Muted color badges, truncated to ~60px with ellipsis. Shows variety at a glance.

## Diff View

### Single Record

Message: "Select 2+ records to compare differences."

### Multiple Records (2+)

First selected record is the reference. All others compared against it.

```
Field          Reference (Row 1)     Differences
─────────────────────────────────────────────────
id             42                    Row 2: 57, Row 3: 91
name           "John Doe"            — (same)
status         "active"              Row 2: "pending", Row 3: "inactive"
```

**Rendering rules:**
- Default: only show fields with at least one difference
- Toggle to show all fields (including identical ones)
- Reference value in normal text, differing values highlighted with row indicators
- Color coding: reference = neutral, differences = amber/warning
- Collapsible "Show N identical fields" section
- Search across field names and all values

## Raw View

### Single Record

```json
{
  "id": 42,
  "name": "John Doe"
}
```

### Multiple Records

```json
[
  { "id": 42, "name": "John Doe" },
  { "id": 57, "name": "Jane Smith" }
]
```

- Uses `CodeEditor` component (`src/components/CodeEditor/`) with JSON language mode
- Read-only — no editing in raw view
- Replaces current `<pre>` tag with CodeMirror instance

## Keyboard Shortcut

- `Cmd+J` (Mac) / `Ctrl+J` (Windows/Linux) in BaseDataGrid keyboard handler
- Toggles `showInspector` state
- Works when grid is focused

## Persistence

- Store Inspector open/closed state and active tab in `useGridPreferencesStore`
- Keyed per connection (consistent with column order, sort preferences)
- On mount: read persisted state → set initial `showInspector` and default tab
- On change: write back to store

## Header Redesign

- Remove "Set Baseline" and "Clear" buttons entirely
- Show: `Inspector` title + record count badge (e.g., "3 records")
- Search input lives within each tab that needs it (Tree and Diff)

## Files to Create/Modify

### New Files
- `src/components/DataGrid/components/inspector/InspectorPanel.tsx` — shell component
- `src/components/DataGrid/components/inspector/InspectorTreeView.tsx` — merged tree with editing
- `src/components/DataGrid/components/inspector/InspectorDiffView.tsx` — unified diff
- `src/components/DataGrid/components/inspector/InspectorRawView.tsx` — CodeEditor JSON view
- `src/components/DataGrid/components/inspector/utils.ts` — shared helpers (rowToDocument, mergeDocuments, etc.)
- `src/components/DataGrid/components/inspector/types.ts` — shared types
- `src/components/DataGrid/components/inspector/index.ts` — barrel export

### Modified Files
- `src/components/DataGrid/base/BaseDataGrid.tsx` — multi-row selection collection, Cmd+J shortcut, pass `selectedRows[]`
- `src/components/DataGrid/adapters/SqlDataGrid.tsx` — remove baseline state, pass edit callback
- `src/stores/gridPreferencesStore.ts` — add Inspector persistence fields
- Delete: `src/components/DataGrid/components/InspectorPanel.tsx` (old single-record panel)
