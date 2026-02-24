# Table Designer — Index Support

## Problem

The Table Designer (create new table flow) has no way to define indexes. Users must create the table first, then switch to the table structure view to add indexes separately. This breaks the workflow for anyone designing a table with performance-critical columns.

## Decision

Add a tabbed layout to the Table Designer with "Columns" and "Indexes" tabs. Build a new `IndexDesigner` component that reuses existing cell renderers and types from `TableIndexes`, but with a simpler state model (all indexes are pending `index.create` commands — no drops, renames, or recreate logic).

## Layout

```
┌──────────────────────────────────────────────────┐
│  [Table name input________________________]      │
├──────────────────────────────────────────────────┤
│  [Columns]  [Indexes (2)]                        │
├──────────────────────────────────────────────────┤
│                                                  │
│  Active tab content                              │
│                                                  │
├──────────────────────────────────────────────────┤
│                         [Cancel]  [Create Table]  │
└──────────────────────────────────────────────────┘
```

- Tabs: shadcn `Tabs` / `TabsList` / `TabsTrigger`
- Indexes tab shows count badge when indexes > 0
- Footer shared across both tabs

## IndexDesigner Component

### Props

```typescript
interface IndexDesignerProps {
  panelId: string;
  tabId: string;
  connectionId: string;
  database: string;
  schema?: string;
  availableColumns: string[];       // From Columns tab
  tableName: string;                // Current table name draft
  foreignKeyColumns: string[];      // FK columns for auto-suggest
}
```

### Grid Columns

Reused from `TableIndexes/columns.ts`, minus the "Usage Stats" column:

| # | Name | Columns | Type | Unique | Condition | Actions |
|---|------|---------|------|--------|-----------|---------|

### State Model

- All indexes are pending `index.create` commands — no database loading
- Edit = update existing staged command (no recreate pairs)
- Delete = unstage the command
- Uses designer tag system: `table-designer-idx:{panelId}:{tabId}:{tempId}`

### Command Flow

```
Add    → createIndexCreateCommand() → stageBatchWithSingleHistoryEntry()
Edit   → update existing command    → stageBatchWithSingleHistoryEntry()
Delete → unstageCommands([id])
```

### Auto-Suggest

1. **Auto-generated names**: `idx_{tableName}_{col1}_{col2}` when columns are selected and name is empty/auto-generated
2. **FK suggestions**: Info banner when FK columns lack indexes — "Columns `user_id`, `category_id` have foreign keys but no indexes. [Add indexes]"

### Reused Components

From `TableIndexes` / `TableStructure`:
- Cell renderers: IndexNameCellRenderer, IndexColumnsCellRenderer, IndexTypeCellRenderer, IndexUniqueCellRenderer, ConditionCellRenderer
- `IndexGridRow` type from `TableIndexes/types.ts`
- `useSupportedIndexTypes` hook
- `createIndexCreateCommand` from command factory

## Column ↔ Index Sync

When columns change on the Columns tab:

1. **Column renamed** → update index commands referencing old name
2. **Column deleted** → remove column from index commands; remove index if no columns remain
3. **Column added** → no action

Sync runs in `TableDesigner/index.tsx` via a `useEffect` that patches affected index commands.

## SQL Generation

Extend `generateSQL()` to append `CREATE INDEX` statements after the `CREATE TABLE`:

```sql
CREATE TABLE "public"."posts" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
);
CREATE INDEX "idx_posts_user_id" ON "public"."posts" USING btree ("user_id");
CREATE UNIQUE INDEX "idx_posts_slug" ON "public"."posts" ("slug") WHERE deleted_at IS NULL;
```

## Validation

On "Create Table", validate existing checks plus:
- Each index has a name and at least one column
- Index columns exist in the column list
- No duplicate index names

## File Structure

```
src/components/TableDesigner/
├── index.tsx              ← Modified: add tabs, pass data to IndexDesigner
├── IndexDesigner.tsx      ← NEW: index grid for designer context
├── commandFactory.ts      ← Extended: index command helpers
├── utils.ts               ← Extended: index utilities
└── utils.test.ts          ← Extended: tests
```

## Out of Scope

- Index templates
- Performance prediction
- Drag-to-reorder indexes
- INCLUDE columns fancy editor (plain text input for SQL Server)
