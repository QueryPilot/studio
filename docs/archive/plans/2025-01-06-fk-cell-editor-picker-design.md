# FK Cell Editor Picker Design

## Overview

Replace the basic text input in `ReferenceCellEditor` with a combobox-style picker that allows users to search and select values from the referenced table.

## Component Structure

```
┌─────────────────────────────────────────┐
│ [user_id]                    int4    FK │  ← Header (existing)
├─────────────────────────────────────────┤
│ 🔍 [john____________] [×]               │  ← Search input
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │  42  │ john@example.com         ✓   │ │  ← Current value highlighted
│ │  15  │ jane@example.com             │ │
│ │  78  │ bob@company.org              │ │
│ │  ...                                │ │
│ │  ─────────────────────────────────  │ │
│ │  Type to search more... (20+ total) │ │  ← Footer hint
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Enter to select · Esc to cancel         │  ← Help text
└─────────────────────────────────────────┘
```

## Key Behaviors

- Opens immediately on cell activation
- Pre-loads first 20 values from referenced table
- Current value highlighted if present in list
- Arrow keys navigate, Enter selects, Esc cancels
- Clear button (×) sets NULL if column is nullable

## Display Column Resolution

Priority order for determining which column to show:

1. **Embedded FK preference** - Check `embeddedFKPreferencesStore` for user's configured display column
2. **Smart detection** - Match against: `name`, `title`, `label`, `email`, `username`, `display_name`, `code`, `description`
3. **Fallback to PK column** - Just show the ID value

Display format in dropdown:
```
│  {pk_value}  │  {display_value}  │
│     42       │  john@example.com │
```

## Search & Data Fetching

### Query Strategy

```sql
-- Initial load (no search term)
SELECT "{pk_col}" AS value, "{display_col}" AS display
FROM "{schema}"."{table}"
ORDER BY "{display_col}"
LIMIT 21

-- With search term (searches PK + display column)
SELECT "{pk_col}" AS value, "{display_col}" AS display
FROM "{schema}"."{table}"
WHERE CAST("{pk_col}" AS TEXT) ILIKE '%{term}%'
   OR CAST("{display_col}" AS TEXT) ILIKE '%{term}%'
ORDER BY "{display_col}"
LIMIT 21
```

### Caching & Performance

- Reuse existing `useFKAutocomplete` hook (5min cache)
- Debounce search input: 200ms
- Show loading spinner in dropdown during fetch
- `LIMIT 21` to detect "has more" (show 20, check if 21st exists)

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `↓` / `↑` | Move selection in list |
| `Enter` | Commit selected item (or typed value if no selection) |
| `Tab` | Commit and move to next cell |
| `Shift+Tab` | Commit and move to previous cell |
| `Esc` | Cancel edit, revert to original |
| `Backspace` (on empty) | Clear to NULL (if nullable) |

## Commit Logic

1. If item selected in dropdown → commit that item's PK value
2. If no selection but exact PK match in results → commit that
3. If no selection and input is valid number → commit as raw value
4. If empty and nullable → commit NULL
5. Otherwise → show validation error / prevent commit

## Implementation

### Files to Modify

| File | Changes |
|------|---------|
| `ReferenceCellEditor.tsx` | Complete rewrite → combobox UI with dropdown |
| `useFKAutocomplete.ts` | Update query to search PK + display column |
| `types.ts` | Add `connectionId`, `database` to cell data |

### New Utilities

- `resolveDisplayColumn(fkRef, embeddedPrefs, refTableColumns)` → determines which column to show
- Reuse `SUGGESTED_COLUMN_NAMES` from `FKEmbedSubmenu.tsx`

### Existing Dependencies (no changes needed)

- `useFKAutocomplete` - fetch values with search
- `useReferencedTableColumns` - get column metadata
- `embeddedFKPreferencesStore` - user's display column preference

### Not Needed

- No new stores
- No backend changes
- No new hooks
