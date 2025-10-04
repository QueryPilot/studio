# Fix: Foreign Key on Array Columns

## Issue

User attempted to add foreign key on `related_todo_ids` column with type `_int4` (PostgreSQL internal notation for `INTEGER[]`) and received error:

```
Failed to add foreign key: SQL syntax error: 42804:
foreign key constraint "todos_related_todo_ids_fkey" cannot be implemented
```

## Root Cause

- Column type `_int4` = `INTEGER[]` (array of integers)
- PostgreSQL does NOT support foreign key constraints on array columns
- This is a fundamental PostgreSQL limitation, not a bug

## Solution Implemented

### 1. Backend Validation (Rust)

**File:** `src-tauri/src/adapters/postgres/adapter.rs`

Added pre-flight validation in `alter_table_add_foreign_key`:

```rust
// Check if the column is an array type (cannot have FK)
let type_check_sql = format!(
    "SELECT format_type(a.atttypid, a.atttypmod) as data_type
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1
       AND c.relname = $2
       AND a.attname = $3
       AND NOT a.attisdropped"
);

let rows = client.query(&type_check_sql, &[&schema, &table, &fk.column_name]).await?;

if let Some(row) = rows.first() {
    let data_type: String = row.get(0);

    // Log the column type for debugging
    eprintln!("DEBUG: Attempting to add FK on column '{}' with type '{}'", fk.column_name, data_type);

    // Check if it's an array type
    if data_type.ends_with("[]") || data_type.starts_with("ARRAY") {
        return Err(AppError::InvalidInput(format!(
            "Cannot create foreign key on array column '{}' (type: {}). PostgreSQL does not support foreign key constraints on array columns. Consider using a junction table instead.",
            fk.column_name,
            data_type
        )));
    }
}

// Log the SQL for debugging
eprintln!("DEBUG: Executing FK SQL: {}", sql);
```

**Benefits:**

- ✅ Clear, user-friendly error message
- ✅ Explains the limitation
- ✅ Suggests the solution (junction table)
- ✅ Debug logging shows column type and SQL query
- ✅ Prevents database error entirely

### 2. Frontend Prevention (TypeScript)

**File:** `src/components/TableStructure/ColumnRow.tsx`

Added UI validation to disable FK editor for array columns:

```tsx
<ForeignKeyEditorPopover
  value={column.foreign_key_ref}
  onChange={(val) => onUpdate?.({ foreign_key_ref: val })}
  disabled={
    !canEdit ||
    isPrimary ||
    column.db_type?.includes("[]") || // Standard array notation
    column.db_type?.startsWith("_") // PostgreSQL internal array notation (_int4, _text, etc.)
  }
/>;

{
  /* Warning message for array columns */
}
{
  (column.db_type?.includes("[]") || column.db_type?.startsWith("_")) && (
    <span
      className="text-[10px] text-amber-600 dark:text-amber-400 px-2"
      title="PostgreSQL does not support foreign keys on array columns. Use a junction table instead."
    >
      ⚠️ Array type - FK not supported
    </span>
  );
}
```

**Benefits:**

- ✅ Disables FK editor before user tries
- ✅ Shows clear warning message
- ✅ Tooltip explains the limitation
- ✅ Prevents wasted time and confusion

## PostgreSQL Array Type Notations

PostgreSQL uses two notations for array types:

| Standard Notation | Internal Notation | Description           |
| ----------------- | ----------------- | --------------------- |
| `INTEGER[]`       | `_int4`           | Array of integers     |
| `TEXT[]`          | `_text`           | Array of text         |
| `BIGINT[]`        | `_int8`           | Array of big integers |
| `VARCHAR[]`       | `_varchar`        | Array of varchar      |
| `BOOLEAN[]`       | `_bool`           | Array of booleans     |
| `UUID[]`          | `_uuid`           | Array of UUIDs        |

**Both notations indicate array types that CANNOT have foreign keys.**

## Debug Output

When attempting to add FK on array column, you'll now see in terminal:

```
DEBUG: Attempting to add FK on column 'related_todo_ids' with type 'integer[]'
```

If FK proceeds (non-array column), you'll see:

```
DEBUG: Attempting to add FK on column 'user_id' with type 'integer'
DEBUG: Executing FK SQL: ALTER TABLE "public"."todos" ADD CONSTRAINT "fk_todos_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
```

## Error Messages

### Before Fix

```
Failed to add foreign key: SQL syntax error: 42804:
foreign key constraint "todos_related_todo_ids_fkey" cannot be implemented
```

❌ Cryptic database error
❌ No explanation
❌ User confused

### After Fix (Backend)

```
Failed to add foreign key: Cannot create foreign key on array column 'related_todo_ids' (type: integer[]).
PostgreSQL does not support foreign key constraints on array columns.
Consider using a junction table instead.
```

✅ Clear explanation
✅ Shows the column type
✅ Suggests solution

### After Fix (Frontend)

FK editor is **disabled** with warning message:

```
⚠️ Array type - FK not supported
```

✅ Prevents error before it happens
✅ Immediate visual feedback

## Testing

### Test Case 1: Array Column

```sql
-- Column definition
related_todo_ids INTEGER[]  -- or _int4 in internal notation
```

**Expected:**

- Frontend: FK editor disabled, warning shown
- Backend: Clear error if somehow bypassed

### Test Case 2: Regular Column

```sql
-- Column definition
user_id INTEGER  -- or int4 in internal notation
```

**Expected:**

- Frontend: FK editor enabled
- Backend: Foreign key created successfully
- Terminal: Debug logs show SQL execution

## Affected Columns in Sample Schema

These columns will show the warning:

| Column             | Type        | Internal Type |
| ------------------ | ----------- | ------------- |
| `related_todo_ids` | `INTEGER[]` | `_int4`       |
| `collaborator_ids` | `INTEGER[]` | `_int4`       |
| `blocked_by_ids`   | `INTEGER[]` | `_int4`       |

## Recommended Solution

Use junction tables instead:

```sql
-- Instead of: related_todo_ids INTEGER[]
-- Create:
CREATE TABLE todo_relations (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    related_todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, related_todo_id),
    CHECK (todo_id != related_todo_id)
);
```

**Benefits:**

- ✅ Full foreign key support
- ✅ Referential integrity
- ✅ Cascade deletes
- ✅ Better performance with indexes
- ✅ Standard SQL pattern

## Files Changed

1. ✅ `src-tauri/src/adapters/postgres/adapter.rs` - Added array type validation + debug logging
2. ✅ `src/components/TableStructure/ColumnRow.tsx` - Added UI prevention + warning message

## Build Status

✅ Rust backend compiles successfully
✅ No new warnings introduced
✅ Frontend renders warning correctly

---

**Summary:** Array columns now have clear prevention at both UI and backend levels, with helpful error messages guiding users toward the proper solution (junction tables).
