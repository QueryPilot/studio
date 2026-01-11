# Embedded FK Quick Lookup Feature Design

## Overview

Enable users to embed referenced column values inline with FK cells for easier debugging. When browsing a table like `todos`, users can configure FK columns (e.g., `user_id`) to display embedded values from the referenced table (e.g., `users.email`), rendering as `42 → john@email.com`.

## Requirements Summary

- **Display**: Inline in cell with arrow separator: `{fk_value} → {embedded_value}`
- **Data fetch**: Eager LEFT JOIN at query time
- **Storage**: Per-table global preferences (same embedded columns across all tabs)
- **Data structure**: Array-based for multi-column future support
- **UI entry points**: Context menu on FK columns + FKPreviewPopover
- **Column suggestions**: Smart suggestions (name, email, title, etc.) + full list

---

## 1. Data Model & Storage

### New Store: `embeddedFKPreferencesStore`

Location: `src/components/DataGrid/stores/embeddedFKPreferencesStore.ts`

```typescript
interface EmbeddedFKPreferences {
  // FK column name → array of referenced columns to embed
  embeddedColumns: Record<string, string[]>;
  // e.g., { "user_id": ["email"], "category_id": ["name"] }
}

interface EmbeddedFKPreferencesState {
  preferences: Record<string, EmbeddedFKPreferences>;

  setEmbeddedColumns: (
    key: string,
    fkColumn: string,
    refColumns: string[]
  ) => void;

  clearEmbeddedColumn: (key: string, fkColumn: string) => void;

  getEmbeddedColumns: (key: string, fkColumn: string) => string[];
}
```

### Storage Key Format

```
{connectionId}:{schema}.{table}
```

Example: `conn_abc123:public.todos`

### Persistence

- Zustand store with `persist` middleware
- IndexedDB storage (same pattern as `gridPreferencesStore`)

---

## 2. SQL Generation

### Column Alias Convention

```
__qp_fk__{fk_column}__{ref_column}
```

Example: `__qp_fk__user_id__email`

### New SqlAdapter Method

Location: `src/adapters/base/SqlAdapter.ts`

```typescript
interface EmbeddedFKConfig {
  fkColumn: string;
  refSchema: string;
  refTable: string;
  refPkColumn: string;
  refDisplayColumns: string[];
}

selectWithEmbeddedFK(
  target: TableRef,
  options: SelectOptions,
  embeddedFKs: EmbeddedFKConfig[]
): string
```

### Generated SQL Example

**Input:**
- Table: `public.todos`
- Embedded: `user_id → users.email`, `category_id → categories.name`

**Output:**
```sql
SELECT
  "public"."todos".*,
  "t1"."email" AS "__qp_fk__user_id__email",
  "t2"."name" AS "__qp_fk__category_id__name"
FROM "public"."todos"
LEFT JOIN "public"."users" AS "t1"
  ON "public"."todos"."user_id" = "t1"."id"
LEFT JOIN "public"."categories" AS "t2"
  ON "public"."todos"."category_id" = "t2"."id"
ORDER BY "public"."todos"."id"
LIMIT 300
```

### Table Alias Strategy

Use incremental aliases `t1`, `t2`, `t3`... for JOINed tables to avoid naming conflicts.

---

## 3. Data Flow Pipeline

```
1. TableDataGrid mounts
          ↓
2. Read embeddedFKPreferencesStore
   Key: {connectionId}:{schema}.{table}
          ↓
3. Build EmbeddedFKConfig[] from:
   - Preferences (which columns to embed)
   - tableStructure.foreignKeys (FK metadata)
          ↓
4. Pass embeddedFKs to useTableDataQuery
          ↓
5. tableStreamingService receives config
          ↓
6. SqlAdapter.selectWithEmbeddedFK() generates JOIN query
          ↓
7. Response includes __qp_fk__* columns in row data
          ↓
8. cellFactory extracts embedded values for ReferenceCellRenderer
          ↓
9. Renders: "42 → John Doe"
```

### Integration Points

| File | Change |
|------|--------|
| `TableDataGrid.tsx` | Read preferences, build EmbeddedFKConfig |
| `useTableDataQuery.ts` | Accept `embeddedFKs` param |
| `tableStreamingService.ts` | Pass config to adapter |
| `SqlAdapter.ts` | New `selectWithEmbeddedFK()` method |
| `cellFactory.ts` | Extract `__qp_fk__*` values for cells |
| `ReferenceCellRenderer.tsx` | Render inline display |

---

## 4. UI Components

### A. Context Menu Submenu

New component: `src/components/DataGrid/components/FKEmbedSubmenu.tsx`

Shows when right-clicking FK column header or cell:

```
┌─────────────────────────────┐
│ Embed Reference Value    →  │
├─────────────────────────────┤
│ Suggested                   │
│ ☑ email        varchar     │
│ ☐ name         varchar     │
│ ☐ username     varchar     │
├─────────────────────────────┤
│ More columns...          →  │
├─────────────────────────────┤
│ ✕ Clear Embedded            │
└─────────────────────────────┘
```

### B. FKPreviewPopover Integration

Add embed action button to each column row in the popover:

```
┌─────────────────────────────────┐
│ users.123                    ✕  │
├─────────────────────────────────┤
│ id         integer    42    [+] │
│ email      varchar    john  [+] │  ← Click to embed
│ name       varchar    John  [+] │
└─────────────────────────────────┘
```

### C. Smart Column Suggestions

Priority order for suggestions:
1. `name`, `title`, `label`, `display_name`
2. `email`, `username`, `code`
3. `description`, `summary`
4. First non-PK text/varchar column (fallback)

---

## 5. Cell Rendering

### Updated ReferenceCellData

```typescript
interface ReferenceCellData {
  kind: "reference-cell";
  value: string | number | null;
  nullable?: boolean;
  fkReference?: {
    schema: string;
    table: string;
    column: string;
  };
  displayValue?: string;
  columnName?: string;
  isPrimaryKey?: boolean;
  dbType?: string;

  // NEW
  embeddedValue?: string | null;
}
```

### Rendering Logic

```
┌────────────────────────────────┐
│ 42 → john@email.com         →  │
│  ↑    ↑                     ↑  │
│  │    │                     │  │
│  │    muted color           hover arrow (existing)
│  │    truncate if needed
│  normal color
└────────────────────────────────┘
```

- FK value: normal text color
- Arrow separator: `→` in muted color
- Embedded value: muted/light color, truncated with ellipsis if needed
- Hover arrow: existing behavior preserved

### Truncation Priority

When cell width is limited:
1. Truncate embedded value first
2. FK value always fully visible
3. Show ellipsis: `42 → john@em...`

---

## 6. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Referenced row deleted | Show `42 → NULL` (LEFT JOIN returns NULL) |
| FK column is NULL | Show `NULL` only (existing behavior) |
| Referenced table not accessible | Log warning, fall back to no-embed query |
| Circular FKs | Only embed one level deep (no nested JOINs) |
| Very long embedded value | Truncate, full value in FKPreviewPopover |
| Invalid preference (deleted column) | Silently ignore, clean up on next save |
| Multiple embedded columns (future) | Display first in cell, all in popover |

---

## 7. Files to Create/Modify

### New Files

```
src/components/DataGrid/stores/embeddedFKPreferencesStore.ts
src/components/DataGrid/components/FKEmbedSubmenu.tsx
```

### Modified Files

```
src/adapters/base/SqlAdapter.ts           - Add selectWithEmbeddedFK()
src/adapters/types.ts                     - Add EmbeddedFKConfig type
src/components/DataGrid/adapters/TableDataGrid.tsx - Read preferences, pass config
src/hooks/useTableDataQuery.ts            - Accept embeddedFKs param
src/services/tableStreamingService.ts     - Pass to adapter
src/components/DataGrid/utils/cellFactory.ts - Extract embedded values
src/components/DataGrid/renderers/ReferenceCell/types.ts - Add embeddedValue
src/components/DataGrid/renderers/ReferenceCell/ReferenceCellRenderer.tsx - Render inline
src/components/DataGrid/components/FKPreviewPopover.tsx - Add embed buttons
src/components/DataGrid/components/ColumnHeaderContextMenuItems.tsx - Add submenu
src/components/DataGrid/components/UnifiedContextMenu.tsx - Wire up FK submenu
src/components/DataGrid/stores/index.ts   - Export new store
```

---

## 8. Implementation Order

1. **Store**: Create `embeddedFKPreferencesStore`
2. **Types**: Add `EmbeddedFKConfig` to adapter types
3. **SQL**: Implement `selectWithEmbeddedFK()` in SqlAdapter
4. **Query hook**: Update `useTableDataQuery` to accept embedded config
5. **Streaming service**: Pass config through to adapter
6. **TableDataGrid**: Read preferences, build config, pass to query
7. **Cell factory**: Extract `__qp_fk__*` values from row data
8. **Renderer**: Update `ReferenceCellRenderer` for inline display
9. **Context menu**: Add `FKEmbedSubmenu` component
10. **Popover**: Add embed buttons to `FKPreviewPopover`

---

## 9. Future Enhancements

- Multiple embedded columns per FK (show first in cell, expand in popover)
- Auto-suggest based on column usage patterns
- Keyboard shortcut to quickly toggle embedding
- Export embedded values in CSV/JSON exports
