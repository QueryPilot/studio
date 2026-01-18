/**
 * SqlDataGrid - SQL table browser with FK-specific features
 *
 * This is a thin wrapper around BaseDataGrid that adds SQL-specific features:
 * - Embedded FK values (customGetCellContent)
 *
 * All general features (QuickFilter, clipboard, fill, column management,
 * hover icons, FK preview) are handled by BaseDataGrid.
 */

import { logger } from '@/lib/logger';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Item, GridCell } from '@glideapps/glide-data-grid';
import { BaseDataGrid } from '../base/BaseDataGrid';
import type { GridColumnV2 } from '../types';
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
import { DbType } from '@/types';
import { useEmbeddedFKPreferencesStore } from '../stores/embeddedFKPreferencesStore';
import type { EmbeddedFKConfig } from '@/adapters/types';

export interface SqlDataGridProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table: string;
  dbType: DbType;
  readOnly?: boolean;
  onRefresh?: () => void;
}

export const SqlDataGrid = memo(function SqlDataGrid(props: SqlDataGridProps) {
  const { connectionId, database, schema, table, dbType, readOnly = false, onRefresh } = props;

  const gridId = `${connectionId}:${database}:${schema}:${table}`;

  // --- Data Fetching ---
  const tableDataQuery = useTableDataQuery({
    connectionId,
    database: database ?? '',
    schema,
    entityName: table,
    entityType: 'table',
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

  const tableStructureQuery = useTableFullStructure({
    connectionId,
    database: database ?? '',
    schema: schema ?? '',
    table,
  });

  const tableStructure = tableStructureQuery.data?.structure;

  // Convert ColumnMeta[] to GridColumnV2[]
  const columns = useMemo<GridColumnV2[]>(
    () =>
      columnMeta
        .filter((meta) => !meta.name.startsWith('__qp_fk__'))
        .map((meta, idx) => {
          const uniqueField = `col_${idx}`;
          return {
            id: meta.name,
            field: uniqueField,
            title: meta.name,
            name: meta.name,
            width: computeBaseWidth(meta.name, meta.db_type),
            type: meta.db_type,
            meta,
          } as GridColumnV2;
        }),
    [columnMeta]
  );

  // --- FK Metadata ---
  // Map: FK column name -> { schema, table, column } of referenced table
  const fkReferenceByColumn = useMemo(() => {
    const map = new Map<
      string,
      { schema: string; table: string; column: string }
    >();
    if (tableStructure?.foreignKeys) {
      for (const fk of tableStructure.foreignKeys) {
        for (let i = 0; i < fk.columns.length; i++) {
          const colName = fk.columns[i];
          const refCol = fk.referenced_columns[i];
          if (colName && refCol) {
            map.set(colName, {
              schema: fk.referenced_schema,
              table: fk.referenced_table,
              column: refCol,
            });
          }
        }
      }
    }
    return map;
  }, [tableStructure?.foreignKeys]);

  // --- Embedded FK Configuration ---
  // Store structure: preferences[gridId].embeddedColumns[fkColumn] = string[]
  const embeddedFKPrefs = useEmbeddedFKPreferencesStore((s) => s.preferences[gridId]);

  const embeddedFKs = useMemo<EmbeddedFKConfig[]>(() => {
    if (!embeddedFKPrefs?.embeddedColumns || !tableStructure?.foreignKeys) return [];

    const configs: EmbeddedFKConfig[] = [];
    for (const fk of tableStructure.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const colName = fk.columns[i];
        const refCol = fk.referenced_columns[i];
        if (!colName || !refCol) continue;

        // Check if we have embedded columns configured for this FK column
        const refDisplayColumns = embeddedFKPrefs.embeddedColumns[colName];
        if (refDisplayColumns && refDisplayColumns.length > 0) {
          configs.push({
            fkColumn: colName,
            refSchema: fk.referenced_schema,
            refTable: fk.referenced_table,
            refPkColumn: refCol,
            refDisplayColumns,
          });
        }
      }
    }
    return configs;
  }, [embeddedFKPrefs, tableStructure?.foreignKeys]);

  // Build embedded FK field map (columnName -> embeddedFieldName)
  const embeddedFKFieldMapRef = useRef(new Map<string, string>());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const cfg of embeddedFKs) {
      const embeddedFieldName = `_fk_${cfg.fkColumn}_display`;
      map.set(cfg.fkColumn, embeddedFieldName);
    }
    embeddedFKFieldMapRef.current = map;
  }, [embeddedFKs]);

  // Build staged FK embedded values map (for updates)
  const stagedFKEmbeddedValuesRef = useRef<Map<string, string | null>>(new Map());

  // --- Referenced Table Columns (for context menu) ---
  // NOTE: This is currently unused but kept for future FK embed menu feature
  const _referencedTableColumns = useReferencedTableColumns({
    connectionId,
    database: database ?? '',
    fkReferences: fkReferenceByColumn,
    enabled: fkReferenceByColumn.size > 0,
  });

  // NOTE: FK Hover Icons & Preview are now handled by BaseDataGrid internally
  // SqlDataGrid only needs to provide customGetCellContent for embedded FK display

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
            // Display "FK_VALUE (embedded_value)"
            const fkCellValue = row[column.field];
            const fkValue =
              fkCellValue && typeof fkCellValue === 'object' && 'value' in fkCellValue
                ? fkCellValue.value
                : fkCellValue;
            const displayText = fkValue ? `${fkValue} (${embeddedValue})` : String(embeddedValue);

            // Return a properly typed GridCell
            return {
              ...baseCell,
              displayData: truncateTextToWidth(displayText, 300),
              themeOverride: {
                ...baseCell.themeOverride,
                textDark: '#0066cc', // Blue for FK with embedded value
              },
            } as GridCell;
          }
        }
      }

      return baseCell;
    },
    [columns, rows]
  );

  // --- CRUD Handlers ---
  const handleCellEditCommit = useCallback(
    (event: any) => {
      logger.info('[SqlDataGrid] Cell edit commit', { event });
      // TODO: Implement CRUD staging
    },
    []
  );

  const handleRowInsert = useCallback(
    (event: any) => {
      logger.info('[SqlDataGrid] Row insert', { event });
      // TODO: Implement CRUD staging
    },
    []
  );

  const handleRowDelete = useCallback(
    (event: any) => {
      logger.info('[SqlDataGrid] Row delete', { event });
      // TODO: Implement CRUD staging
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
        message={error instanceof Error ? error.message : 'Failed to load table data'}
        onRetry={refetch}
      />
    );
  }

  if (rows.length === 0) {
    return <DataGridEmptyState message="No data in table" />;
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
        onRefresh={onRefresh}
      />

      {/* BaseDataGrid with all general features + FK-specific features */}
      <BaseDataGrid
        gridId={gridId}
        rows={rows}
        columns={columns}
        connectionId={connectionId}
        database={database}
        schema={schema}
        tableName={table}
        paradigm="sql"
        dialect={dbType}
        estimatedTotal={estimatedTotal}
        isEstimatedCount={isEstimatedCount}
        hasMore={hasNextPage}
        onLoadMore={fetchNextPage}
        readOnly={readOnly}
        enableFiltering={true}
        enableSorting={true}
        enableExport={true}
        enableRowPinning={true}
        enableColumnManagement={true}
        enableClipboard={true}
        enableFillOperations={true}
        enableStagedChanges={true}
        onCellEditCommit={handleCellEditCommit}
        onRowInsert={handleRowInsert}
        onRowDelete={handleRowDelete}
        // FK embedded value display (BaseDataGrid handles hover icons and FK preview internally)
        customGetCellContent={customGetCellContent}
        className="flex-1"
      />
    </div>
  );
});
