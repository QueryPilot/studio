# Index Table Context Menu Design

## Overview

Add a right-click context menu to the Table Indexes grid, providing quick access to all index operations without requiring toolbar buttons or inline cell editing.

## Menu Structure

```
┌──────────────────────────┐
│  Add Index               │
│ ─────────────────────── │
│  Rename Index            │
│  Edit Columns...         │
│  Change Type         ▸   │  ← submenu: btree, hash, gin, gist, etc.
│  Toggle Unique           │  ← "Make Unique" / "Remove Unique"
│  Edit Condition...       │
│ ─────────────────────── │
│  Copy Index Name         │
│  Copy DDL                │
│ ─────────────────────── │
│  Delete Index            │  ← destructive style
└──────────────────────────┘
```

## Trigger

- Right-click anywhere on a row via glide-data-grid's `onCellContextMenu` callback.
- Captures row index and cursor coordinates to position the menu.

## Component

- New component: `IndexTableContextMenu` using shadcn/ui `ContextMenu` primitives (Base UI).
- State in parent `TableIndexes`: tracks which row is right-clicked and cursor position.

## Row State Rules

| Row State | Add Index | Edit Actions | Copy Actions | Delete |
|-----------|-----------|-------------|-------------|--------|
| Normal | Enabled | Enabled | Enabled | Enabled (destructive) |
| Primary Key (locked) | Enabled | Disabled | Enabled | Disabled |
| Pending Delete | Enabled | Disabled | Enabled | Shows "Undo Delete" |
| Pending New | Enabled | Enabled | Enabled | Shows "Discard" |

## Action Behaviors

- **Add Index**: Reuses existing toolbar "Create Index" logic. Always enabled.
- **Rename Index**: Programmatically opens the inline name cell editor.
- **Edit Columns**: Programmatically opens the inline columns cell editor.
- **Change Type**: Submenu lists database-specific index types from `availableIndexTypes`. Current type is checked. Selecting one stages the change directly via `crudStore`.
- **Toggle Unique**: Label adapts ("Make Unique" / "Remove Unique"). Stages change directly.
- **Edit Condition**: Programmatically opens the inline condition cell editor.
- **Copy Index Name**: Copies index name to clipboard via `navigator.clipboard`.
- **Copy DDL**: Constructs `CREATE INDEX` DDL from row data (name, columns, type, unique, condition) and copies to clipboard.
- **Delete Index**: Existing indexes show `ConfirmDeleteDialog`. Pending indexes discard immediately.

## DDL Construction

Built from row data on the frontend:

```sql
CREATE [UNIQUE] INDEX [name] ON [table] USING [type] ([columns]) [WHERE condition];
```
