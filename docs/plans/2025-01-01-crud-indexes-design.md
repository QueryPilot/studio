# CRUD Indexes Design

## Overview

Enable full inline CRUD operations for the TableIndexes component, following the same patterns established in TableStructure. Users can create, edit, and delete indexes directly in the data grid with staging/commit workflow.

## Decisions Summary

| Decision | Choice |
|----------|--------|
| Editing approach | Full inline grid editing |
| Column selection | Command selector → tag display |
| Column reordering | Selection order + up/down buttons |
| Definition field | Renamed to "Condition" |
| New row behavior | Empty row at bottom with smart defaults |
| Index type dropdown | Dynamic from adapter per database |
| Editing existing indexes | Name inline, others require recreate confirmation |
| Condition editing | CodeMirror popover with syntax highlighting |
| Validation | Frontend syntax check for Condition field |
| Primary key indexes | Completely read-only with visual distinction |

## Grid Columns & Cell Types

| Column | Cell Type | Editable | Notes |
|--------|-----------|----------|-------|
| **#** | Text (right-aligned) | No | Row number |
| **Name** | Custom text cell | Yes | With PK/Unique badges |
| **Columns** | Tag cell | Yes | Command selector → tag display |
| **Type** | Dropdown | Yes | Dynamic options per DB |
| **Unique** | Toggle (YES/NO) | Yes | Green highlight for YES |
| **Usage Stats** | Text | No | Read-only statistics |
| **Condition** | Code cell | Yes | SQL editor popover |
| **Actions** | Icon button | - | Delete/Undo |

### New Custom Renderers

- `IndexColumnsCellRenderer` - displays columns as tags, opens command selector on edit
- `IndexTypeCellRenderer` - dropdown with DB-specific options
- `ConditionCellRenderer` - shows truncated SQL, opens CodeMirror popover

### Reusable from TableStructure

- `IndexNameCellRenderer` (update for edit mode)
- `NullableCellRenderer` pattern for Unique toggle
- `ActionsCellRenderer` for delete/undo

## Creating New Indexes

### Flow

1. User clicks "Create Index" button
2. New row appears at bottom with smart defaults:
   - **Name**: Empty (required)
   - **Columns**: Empty (required)
   - **Type**: Database-specific default
   - **Unique**: "NO"
   - **Condition**: Empty (optional)
3. Row shows pending state (green background)
4. `index.create` command staged in crudStore

### Smart Defaults per Database

| Database | Default Type | Notes |
|----------|--------------|-------|
| PostgreSQL | btree | Most versatile |
| MySQL | btree | Most common |
| SQLite | btree | Only option |
| SQL Server | nonclustered | Clustered reserved for PK |

### Validation

- Name required and unique among indexes
- At least one column must be selected
- Condition syntax check (if provided)
- Invalid rows block commit with inline error indicators

## Editing Existing Indexes

### Name Editing (Simple Rename)

- Click name cell → inline text editor
- On blur/enter → stages `index.rename` command
- Row shows modified state (golden background)
- Generates: `ALTER INDEX "old_name" RENAME TO "new_name"`

### Columns, Type, Unique, Condition (Requires Recreate)

1. Cell shows edit icon (pencil) on hover
2. Tooltip: "Changing this will recreate the index"
3. Click edit icon → confirmation popover:
   - "This index will be dropped and recreated. Continue?"
   - [Cancel] [Continue]
4. On confirm → cell becomes editable
5. Changes stage both commands:
   - `index.drop` (original)
   - `index.create` (new definition)
6. Row visual: strikethrough original + new values

### Primary Key Index Rows

- All cells locked/grayed
- Tooltip: "Primary key index - manage in Table Structure"
- No edit icons, delete button hidden
- Visually distinct locked appearance

## Columns Cell - Command Selector & Tags

### Display Mode

- Columns as horizontal tags: `[email]` `[created_at]`
- Compact badge styling
- Overflow: first N tags + "+2 more"
- Monospace font

### Edit Mode (Command Selector Popover)

1. Click cell → popover opens:
   - Search input (auto-focused)
   - Available columns list
   - Selected columns with checkmarks
2. Type to filter columns
3. Click column → adds to selection
4. Selected tags shown with:
   - Column name
   - [x] remove button
   - [↑] [↓] reorder buttons
5. Click outside / Escape → closes

### Data Flow

- Fetch columns via `databaseService.tableColumns()` or parent context
- Cache per table
- Selection stored as `string[]`

## Condition Cell - Code Editor Popover

### Display Mode

- Truncated SQL with ellipsis
- Monospace font, muted blue color
- Empty: "—" or italic "No condition"

### Edit Mode (CodeMirror Popover)

1. Click cell → popover with CodeMirror editor
2. ~4-6 lines visible height
3. SQL syntax highlighting (dialect-aware)
4. Real-time validation:
   - Syntax check as user types
   - Red underline for errors
   - Error message below editor
5. Close behavior:
   - Click outside → save and close
   - Escape → cancel, revert
   - Save/Cancel buttons

### Infrastructure

- Reuse `SqlEditor` or lightweight CodeMirror setup
- Dialect linting from `linter-strategy.ts`

## Component Architecture

### File Structure

```
src/components/TableIndexes/
├── index.tsx                    # Main component (update)
├── columns.ts                   # Column definitions (update)
├── types.ts                     # Types (update)
├── utils.ts                     # Transform utils (update)
├── commandFactory.ts            # Existing, reuse
├── IndexNameCellRenderer.tsx    # Update for edit mode
├── IndexColumnsCellRenderer.tsx # NEW
├── IndexTypeCellRenderer.tsx    # NEW
├── ConditionCellRenderer.tsx    # NEW
├── ColumnSelectorPopover.tsx    # NEW
└── ConditionEditorPopover.tsx   # NEW
```

### Data Dependencies

- Table columns list (for selector) - fetch once, cache
- Supported index types per DB - from adapter
- Existing index names - for uniqueness validation

### State Management

- `crudStore` for staging commands (existing)
- Local state for popover open/closed
- `useTableColumns` hook or prop for column list

## Visual States

Following TableStructure patterns:

| State | Background | Text | Notes |
|-------|------------|------|-------|
| Normal | Default | Default | Existing index |
| Pending (new) | Green 6% | Default | New index not committed |
| Modified | Golden 4% | Default | Existing index with changes |
| Pending Delete | Red 8% | Red | Marked for deletion |
| Primary Key | Grayed | Muted | Locked, non-editable |

## Database-Specific Considerations

### PostgreSQL

- Index types: btree, hash, gist, gin, spgist, brin
- Supports partial indexes (WHERE)
- Supports INCLUDE columns
- Supports expression indexes

### MySQL

- Index types: btree, hash, fulltext, spatial
- No partial indexes
- FULLTEXT only on text columns

### SQLite

- Only btree (hide Type column)
- Supports partial indexes (WHERE)
- No INCLUDE columns

### SQL Server

- Index types: clustered, nonclustered, columnstore, xml, spatial
- Clustered typically reserved for PK
- Supports INCLUDE columns
- Supports filtered indexes (WHERE)

## Commands Generated

### index.create

```typescript
{
  type: 'index.create',
  payload: {
    definition: {
      name: string,
      columns: string[],
      unique: boolean,
      using: string,
      where?: string,
      includeColumns?: string[]
    },
    tempId: string
  }
}
```

### index.drop

```typescript
{
  type: 'index.drop',
  payload: {
    indexName: string,
    ifExists: boolean
  }
}
```

### index.rename

```typescript
{
  type: 'index.rename',
  payload: {
    indexName: string,
    newName: string
  }
}
```

## Out of Scope (v1)

- Expression indexes (indexing computed values)
- Index storage parameters (fillfactor, etc.)
- Concurrent index creation
- Index statistics refresh
- Batch operations on indexes
