/**
 * SqlDataGrid - SQL table browser with FK-specific features
 *
 * This is a thin wrapper around BaseDataGrid that provides:
 * - Data fetching via useTableDataQuery
 * - Command factory for SQL-specific CRUD commands
 * - FK embedded value display (customGetCellContent)
 *
 * All CRUD operations, optimistic updates, and general grid features
 * are handled by BaseDataGrid.
 */

import { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Item, GridCell } from '@glideapps/glide-data-grid';
import { cn } from '@/lib/utils';
import { BaseDataGrid } from '../base/BaseDataGrid';
import type { GridColumnV2, GridRowModel, GridEditCommitEvent, CrudCommandFactory } from '../types';
import { useTableDataQuery } from '@/hooks/useTableDataQuery';
import { useTableFullStructure } from '@/hooks/useTableFullStructure';
import { useReferencedTableColumns } from '@/hooks/useReferencedTableColumns';
import { truncateTextToWidth } from '../utils/textUtils';
import { computeBaseWidth } from './columnUtils';
import {
  DataGridEmptyState,
  DataGridErrorState,
} from '../components/DataGridStates';
import { DataGridSkeleton } from '../components/DataGridSkeleton';
import { StagingActionsToolbar } from '../components/StagingActionsToolbar';
import { DbType, type GridCellValue } from '@/types';
import { useEmbeddedFKPreferencesStore } from '../stores/embeddedFKPreferencesStore';
import type { EmbeddedFKConfig } from '@/adapters/types';
import {
  createInsertCommand,
  createUpdateCommand,
  createDeleteCommand,
  createCrudTarget,
} from '../utils/crudHelpers';

export interface SqlDataGridProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
  dbType: DbType;
  readOnly?: boolean;
  /** Entity kind: Table, View, or MaterializedView */
  kind?: 'Table' | 'View' | 'MaterializedView';
  onRefresh?: () => void;
  /** CSS class name for styling */
  className?: string;
  /** Callback for toolbar actions (legacy, not currently used) */
  onActionsChange?: (actions: React.ReactNode) => void;
  /** Initial WHERE clause filter (e.g., from FK reference navigation) */
  initialFilter?: string;
  /** Panel ID for FK reference navigation */
  panelId?: string;
}

export const SqlDataGrid = memo(function SqlDataGrid(props: SqlDataGridProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    dbType,
    readOnly = false,
    kind = 'Table',
    className,
  } = props;

  const gridId = `${connectionId}:${database}:${schema}:${table}`;
  const tableName = table;

  // Determine entity type and read-only status based on kind
  const entityType: 'table' | 'view' | 'materialized_view' = kind === 'MaterializedView'
    ? 'materialized_view'
    : kind === 'View'
      ? 'view'
      : 'table';

  const isViewOrMatView = kind === 'View' || kind === 'MaterializedView';
  const isReadOnly = readOnly || isViewOrMatView;
  const readOnlyReason = kind === 'View'
    ? 'Read-only: View'
    : kind === 'MaterializedView'
      ? 'Read-only: Materialized View'
      : undefined;

  // --- Data Fetching ---
  const tableDataQuery = useTableDataQuery({
    connectionId,
    database: database ?? '',
    schema,
    entityName: table,
    entityType,
    enabled: true,
  });

  const {
    rows,
    columns: columnMeta,
    estimatedTotal,
    isEstimatedCount,
    status,
    error,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = tableDataQuery;

  const isLoading = status === 'loading';
  const isError = status === 'error';

  const { structure: tableStructure } = useTableFullStructure({
    connectionId,
    database: database ?? '',
    schema: schema ?? '',
    table,
  });

  // Convert ColumnMeta[] to GridColumnV2[]
  const columns = useMemo<GridColumnV2[]>(() => {
    const visibleColumns = columnMeta.filter((meta) => !meta.name.startsWith('__qp_fk__'));
    return visibleColumns.map((meta) => {
      const originalIndex = columnMeta.findIndex((c) => c.name === meta.name);
      const uniqueField = `col_${originalIndex}`;
      return {
        id: meta.name,
        field: uniqueField,
        title: meta.name,
        name: meta.name,
        width: computeBaseWidth(meta.name, meta.db_type),
        type: meta.db_type,
        meta,
      } as GridColumnV2;
    });
  }, [columnMeta]);

  // Build column name to field mapping
  const columnNameToFieldMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      map.set(col.name, col.field);
    }
    return map;
  }, [columns]);

  // Build field to column mapping
  const columnByFieldMap = useMemo(() => {
    const map = new Map<string, GridColumnV2>();
    for (const col of columns) {
      map.set(col.field, col);
    }
    return map;
  }, [columns]);

  // Primary key columns
  const primaryKeyColumns = useMemo(() => {
    return columns.filter((col) => col.meta?.is_pk).map((col) => col.name);
  }, [columns]);

  // Row key generation
  const rowKeyMapRef = useRef(new WeakMap<GridRowModel, string>());
  const draftRowCounterRef = useRef(0);
  const columnNameToFieldMapRef = useRef(columnNameToFieldMap);
  columnNameToFieldMapRef.current = columnNameToFieldMap;

  const getRowKey = useCallback(
    (row: GridRowModel | undefined, index: number): string => {
      if (!row) {
        return `${schema ?? 'public'}.${table}:row-${index}`;
      }
      const cached = rowKeyMapRef.current.get(row);
      if (cached) return cached;

      const parts = primaryKeyColumns.map((columnName) => {
        const field = columnNameToFieldMapRef.current.get(columnName) ?? columnName;
        const cell = row[field];
        const value = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
        if (value === null || value === undefined) return '__null__';
        if (typeof value !== 'object') return String(value);
        return String(value);
      });

      let computed = `${schema ?? 'public'}.${table}:row-${draftRowCounterRef.current++}`;
      if (primaryKeyColumns.length > 0 && parts.some((part) => part !== '__null__')) {
        computed = `${schema ?? 'public'}.${table}:pk:${parts.join('|')}`;
      }
      rowKeyMapRef.current.set(row, computed);
      return computed;
    },
    [primaryKeyColumns, schema, table]
  );

  // --- Command Factory ---
  // Creates SQL-specific CRUD commands for BaseDataGrid to use
  const commandFactory = useMemo<CrudCommandFactory | undefined>(() => {
    if (isReadOnly) return undefined;

    const target = createCrudTarget(connectionId, database ?? '', schema, table);

    return {
      connectionId,
      database,
      schema,
      table,
      primaryKeyColumns,
      columnNameToFieldMap,
      columnByFieldMap,
      getRowKey,

      createEditCommand: (event: GridEditCommitEvent) => {
        try {
          return createUpdateCommand(event, target, columns);
        } catch (err) {
          console.error('Failed to create update command:', err);
          return null;
        }
      },

      createInsertCommand: (data?: Record<string, unknown>) => {
        // Create a new row with default values
        const newRow: GridRowModel = {};
        columns.forEach((col) => {
          const providedValue = data?.[col.name];
          if (providedValue !== undefined) {
            newRow[col.field] = {
              value: providedValue,
              value_type: typeof providedValue === 'number' ? 'Integer' : 'Text',
              db_type: col.meta?.db_type ?? col.type ?? 'text',
              is_truncated: false,
            } as GridCellValue;
          } else if (col.meta?.default || col.meta?.nullable || col.meta?.is_pk) {
            newRow[col.field] = {
              value: null,
              value_type: 'Null',
              db_type: col.meta?.db_type ?? col.type ?? 'text',
              is_truncated: false,
            } as GridCellValue;
          } else {
            newRow[col.field] = {
              value: '',
              value_type: 'Text',
              db_type: col.meta?.db_type ?? col.type ?? 'text',
              is_truncated: false,
            } as GridCellValue;
          }
        });
        return createInsertCommand(newRow, target, columns);
      },

      createDeleteCommand: (row: GridRowModel, _rowKey: string) => {
        return createDeleteCommand(row, target, columns);
      },
    };
  }, [
    isReadOnly,
    connectionId,
    database,
    schema,
    table,
    columns,
    primaryKeyColumns,
    columnNameToFieldMap,
    columnByFieldMap,
    getRowKey,
  ]);

  // --- FK Metadata ---
  const fkReferenceByColumn = useMemo(() => {
    const map = new Map<string, { schema: string; table: string; column: string }>();
    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        for (let i = 0; i < fk.columns.length; i++) {
          const colName = fk.columns[i];
          const refCol = fk.foreignColumns[i];
          if (colName && refCol) {
            map.set(colName, {
              schema: fk.foreignSchema ?? 'public',
              table: fk.foreignTable,
              column: refCol,
            });
          }
        }
      }
    }
    return map;
  }, [tableStructure?.foreignKeys]);

  // --- Embedded FK Configuration ---
  const embeddedFKPrefs = useEmbeddedFKPreferencesStore((s) => s.preferences[gridId]);

  const embeddedFKs = useMemo<EmbeddedFKConfig[]>(() => {
    if (!embeddedFKPrefs?.embeddedColumns || !tableStructure?.foreignKeys) return [];

    const configs: EmbeddedFKConfig[] = [];
    for (const fk of tableStructure.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const colName = fk.columns[i];
        const refCol = fk.foreignColumns[i];
        if (!colName || !refCol) continue;

        const refDisplayColumns = embeddedFKPrefs.embeddedColumns[colName];
        if (refDisplayColumns && refDisplayColumns.length > 0) {
          configs.push({
            fkColumn: colName,
            refSchema: fk.foreignSchema ?? 'public',
            refTable: fk.foreignTable,
            refPkColumn: refCol,
            refDisplayColumns,
          });
        }
      }
    }
    return configs;
  }, [embeddedFKPrefs, tableStructure?.foreignKeys]);

  // Build embedded FK field map
  const embeddedFKFieldMapRef = useRef(new Map<string, string>());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const cfg of embeddedFKs) {
      const embeddedFieldName = `_fk_${cfg.fkColumn}_display`;
      map.set(cfg.fkColumn, embeddedFieldName);
    }
    embeddedFKFieldMapRef.current = map;
  }, [embeddedFKs]);

  // Staged FK embedded values for updates
  const stagedFKEmbeddedValuesRef = useRef<Map<string, string | null>>(new Map());

  // --- Referenced Table Columns (for context menu) ---
  const referencedTableColumns = useReferencedTableColumns({
    connectionId,
    database: database ?? '',
    fkReferences: fkReferenceByColumn,
    enabled: fkReferenceByColumn.size > 0,
  });

  // --- Custom getCellContent for Embedded FK ---
  const customGetCellContent = useCallback(
    (cell: Item, baseCell: GridCell): GridCell => {
      const [colIndex, rowIndex] = cell;
      const column = columns[colIndex];
      const row = rows[rowIndex];
      if (!column || !row) return baseCell;

      // Check if this column has embedded FK value
      if (column.meta?.is_fk && column.name) {
        const embeddedFieldName = embeddedFKFieldMapRef.current.get(column.name);
        if (embeddedFieldName) {
          const stagedKey = `${rowIndex}:${column.name}`;
          const embeddedCellValue = row[embeddedFieldName];
          const embeddedValue =
            stagedFKEmbeddedValuesRef.current.get(stagedKey) ??
            (embeddedCellValue && typeof embeddedCellValue === 'object' && 'value' in embeddedCellValue
              ? embeddedCellValue.value
              : embeddedCellValue);

          if (embeddedValue) {
            const fkCellValue = row[column.field];
            const fkValue =
              fkCellValue && typeof fkCellValue === 'object' && 'value' in fkCellValue
                ? fkCellValue.value
                : fkCellValue;
            const displayText = fkValue ? `${fkValue} (${embeddedValue})` : String(embeddedValue);

            return {
              ...baseCell,
              displayData: truncateTextToWidth(displayText, 300),
              themeOverride: {
                ...baseCell.themeOverride,
                textDark: '#0066cc',
              },
            } as GridCell;
          }
        }
      }

      return baseCell;
    },
    [columns, rows]
  );

  // --- Cell Edit Callback (for FK embedded value extraction) ---
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      // For FK columns, extract and store the embeddedValue from the committed cell
      if (event.column.meta?.is_fk && event.newValue && 'data' in event.newValue) {
        const data = event.newValue.data;
        if (typeof data === 'object' && data !== null && 'embeddedValue' in data) {
          const columnName = event.column.name ?? event.column.field;
          const key = `${event.rowIndex}:${columnName}`;
          const embeddedValue = (data as { embeddedValue?: string | null }).embeddedValue;
          stagedFKEmbeddedValuesRef.current.set(key, embeddedValue ?? null);
        }
      }
    },
    []
  );

  // --- Loading States ---
  if (isLoading) {
    return <DataGridSkeleton />;
  }

  if (isError) {
    return (
      <DataGridErrorState
        error={error instanceof Error ? error.message : 'Failed to load table data'}
        onRetry={refetch}
      />
    );
  }

  // Allow empty state for tables (user may want to add rows)
  // Views/MatViews show empty state since they can't be edited
  if (rows.length === 0 && isViewOrMatView) {
    return <DataGridEmptyState title="No data" description="No rows found in this view." />;
  }

  // --- Render ---
  return (
    <div className="flex h-full flex-col">
      {/* Top Toolbar (Staging Actions) */}
      <StagingActionsToolbar
        connectionId={connectionId}
        database={database}
        schema={schema ?? ''}
        table={table}
      />

      {/* BaseDataGrid handles all CRUD operations internally */}
      <BaseDataGrid
        gridId={gridId}
        rows={rows}
        columns={columns}
        connectionId={connectionId}
        database={database}
        schema={schema}
        tableName={tableName}
        paradigm="sql"
        dialect={dbType}
        estimatedTotal={estimatedTotal}
        isEstimatedCount={isEstimatedCount}
        hasMore={hasNextPage}
        onLoadMore={fetchNextPage}
        readOnly={isReadOnly}
        readOnlyReason={readOnlyReason}
        entityType={entityType}
        enableFiltering={true}
        enableSorting={true}
        enableExport={true}
        enableRowPinning={true}
        enableColumnManagement={true}
        enableClipboard={true}
        enableFillOperations={!isReadOnly}
        enableStagedChanges={!isReadOnly}
        // Command factory for CRUD operations
        commandFactory={commandFactory}
        // Callback for FK embedded value extraction
        onCellEditCommit={handleCellEditCommit}
        // FK data
        referencedTableColumns={referencedTableColumns}
        // FK embedded value display
        customGetCellContent={customGetCellContent}
        // Data invalidation refetch
        onRefetch={refetch}
        className={cn("flex-1", className)}
      />
    </div>
  );
});
