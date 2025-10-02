# PostgreSQL Enum & Custom Type Support

## Summary

Added comprehensive support for PostgreSQL custom types (enums, domains, composites, etc.) when viewing and editing table column structures.

## Changes Made

### Backend (Rust)

#### 1. Updated `ColumnMeta` Type (`src-tauri/src/types.rs`)

Added fields to support custom type information:

```rust
pub struct ColumnMeta {
    // ... existing fields
    pub enum_values: Option<Vec<String>>,
    pub type_category: Option<String>,
}
```

#### 2. Enhanced PostgreSQL Introspection (`src-tauri/src/adapters/postgres/introspection.rs`)

Updated `get_table_columns` to fetch:

- Enum values for enum types
- Type category (enum, domain, composite, base, etc.)
- Base type for domain types

Query now includes:

```sql
t.typtype as type_category,
CASE
    WHEN t.typtype = 'e' THEN (
        SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_enum e
        WHERE e.enumtypid = t.oid
    )
    ELSE NULL
END as enum_values
```

#### 3. New Command: `get_type_info` (`src-tauri/src/commands.rs`)

Added command to fetch detailed information about any custom type:

- Type name and category
- Enum values (for enum types)
- Base type (for domain types)

Registered in `src-tauri/src/main.rs`.

### Frontend (TypeScript)

#### 1. Updated Type Definitions

- `src/types/database.ts`: Added `type_category` to `ColumnMeta`
- `src/services/backend.ts`: Added `enum_values` and `type_category` to `ColumnMeta`

#### 2. New Service Method (`src/services/databaseService.ts`)

Added `getTypeInfo()` method to fetch type information from backend.

#### 3. Enhanced UI Components

##### TypeSelector (`src/components/TableStructure/TypeSelector.tsx`)

- Added `enumValues` prop to display enum values
- Shows badge with count of enum values: `type_name [3]`
- Tooltip shows all possible values on hover

##### ColumnRow (`src/components/TableStructure/ColumnRow.tsx`)

- Added `enum_values` and `type_category` fields
- Passes enum values to TypeSelector component

##### TableStructure (`src/components/TableStructure/index.tsx`)

- Propagates `enum_values` and `type_category` from column metadata

## Usage Example

### Creating an Enum Type in PostgreSQL

```sql
-- Create an enum type
CREATE TYPE mood AS ENUM ('happy', 'sad', 'neutral');

-- Create table using the enum
CREATE TABLE person (
    id SERIAL PRIMARY KEY,
    name TEXT,
    current_mood mood
);
```

### What Users See

When viewing the `person` table structure:

1. The `current_mood` column shows type: `mood [3]`
2. Hovering shows tooltip: "Values: happy, sad, neutral"
3. Column metadata includes all enum values in backend

### For Domain Types

```sql
CREATE DOMAIN email AS TEXT
CHECK (VALUE ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email_address email
);
```

The `email_address` column will show:

- Type: `email`
- Type category: `domain`
- Base type: `text`

## Architecture

```
User Interface (TypeSelector)
    ↓
TableStructure Component
    ↓
useTableFullStructure Hook
    ↓
databaseService.getTableStructure()
    ↓
Backend: get_columns command
    ↓
PostgresIntrospector.get_table_columns()
    ↓
PostgreSQL system catalogs (pg_type, pg_enum)
```

## Benefits

1. **Better UX**: Users immediately see available enum values when viewing column structure
2. **Type Safety**: Frontend receives structured type information from backend
3. **Extensible**: Easy to add support for other custom types (ranges, composites, etc.)
4. **Performance**: Enum values loaded once per table, cached in frontend
5. **Database Agnostic Foundation**: Pattern can be extended to MySQL SET/ENUM types

## Future Enhancements

1. **Inline Enum Value Selector**: When editing default values for enum columns, show dropdown with available enum values
2. **Domain Constraint Display**: Show domain constraints in UI
3. **Composite Type Structure**: Display composite type field structure
4. **Range Type Bounds**: Show range type bounds and constraints
5. **MySQL Support**: Add similar support for MySQL ENUM and SET types
6. **Type Definition Editor**: Allow creating/modifying enum types from UI

## Testing

To test with the example:

```sql
-- Connect to your PostgreSQL database
CREATE TYPE status AS ENUM ('pending', 'active', 'inactive', 'archived');

CREATE TABLE test_table (
    id SERIAL PRIMARY KEY,
    name TEXT,
    status status,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Then in the app:

1. Navigate to the `test_table` in the Table Structure tab
2. Observe the `status` column shows: `status [4]`
3. Hover to see: "Values: pending, active, inactive, archived"

## Related PostgreSQL Documentation

- [CREATE TYPE](https://www.postgresql.org/docs/current/sql-createtype.html)
- [Enum Types](https://www.postgresql.org/docs/current/datatype-enum.html)
- [Domain Types](https://www.postgresql.org/docs/current/domains.html)
- [Composite Types](https://www.postgresql.org/docs/current/rowtypes.html)
