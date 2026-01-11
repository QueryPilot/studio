# Table Structure: MySQL/MariaDB Column Metadata Columns

## Summary
Add Character Set, Collation, and Extra columns to the Table Structure grid, shown only for supported databases (MySQL/MariaDB). This requires extending MySQL introspection results, mapping the new fields into canonical column metadata, and rendering dynamic grid columns based on connection db type.

## Goals
- Display Character Set, Collation, and Extra in the Table Structure grid for MySQL/MariaDB.
- Keep other databases unchanged (no empty columns).
- Preserve backward compatibility with existing introspection flows.

## Non-Goals
- Redesign of Table Structure layout or editor UX.
- Adding similar fields for PostgreSQL/MSSQL/SQLite.

## Data Flow
1. Update `MySQLAdapter.getColumnsQuery` to return `CHARACTER_SET_NAME`, `COLLATION_NAME`, and `EXTRA` from `information_schema.COLUMNS`.
2. Map the extra result columns in `IntrospectionService.getColumns` into new optional fields on `QueryColumnMeta` and `ColumnMeta`.
3. Keep other adapters unchanged; these fields remain `undefined` for non-MySQL DBs.
4. `databaseService.getTableColumns` passes through the extra metadata as-is.

## UI Changes
- Replace the static `structureColumns` array with a builder that adds the new columns only for MySQL/MariaDB.
- Extend `transformStructureToRows` to map `column.character_set`, `column.collation`, and `column.extra` into row fields with empty-string fallbacks.
- Render new columns in the grid as read-only text fields (same style as other metadata columns).

## Error Handling
- Missing values render as blank cells.
- Unsupported DBs never see these columns.

## Testing
- Unit test: `transformStructureToRows` maps the three fields when present, and leaves blank when absent.
- Adapter/introspection test: MySQL columns query includes the three fields.

## Rollout/Validation
- Refresh Table Structure on a MySQL/MariaDB table and confirm the new columns show expected values.
- Verify that PostgreSQL/SQLite/MSSQL Table Structure views are unchanged.
