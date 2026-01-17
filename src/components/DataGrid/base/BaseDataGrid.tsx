import React, { memo } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import type { GridRowModel, GridColumnV2, GridEditCommitEvent, GridRowInsertEvent, GridRowDeleteEvent } from '../types';
import { EditableDataGrid } from './EditableDataGrid';
import { DataGridStatusBar } from '../components/DataGridStatusBar';
import { useDataGridFeatures } from '../hooks/useDataGridFeatures';
import { cn } from '@/lib/utils';

export interface BaseDataGridProps {
  // Core data (from data hooks)
  gridId: string;
  rows: GridRowModel[];
  columns: GridColumnV2[];
  getCellContent: (cell: Item) => any;

  // Loading & errors
  isLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;

  // Pagination
  hasMore?: boolean;
  onLoadMore?: () => void;
  estimatedTotal?: number;
  isEstimatedCount?: boolean;

  // CRUD operations (from data hooks)
  onCellEditCommit?: (event: GridEditCommitEvent) => void;
  onRowInsert?: (event: GridRowInsertEvent) => void;
  onRowDelete?: (event: GridRowDeleteEvent) => void;

  // Optional capabilities (paradigm-specific)
  onCellActivated?: (cell: Item) => boolean; // MongoDB drill-down
  enableFKPreview?: boolean; // SQL only

  // Slots for paradigm UI
  topToolbar?: React.ReactNode; // BreadcrumbNav | KeyHeader | null
  bottomToolbar?: React.ReactNode; // Custom pagination/actions

  // Metadata (for context menu, filtering, etc.)
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  paradigm: 'sql' | 'document' | 'keyvalue';

  // Feature toggles
  enableFiltering?: boolean;
  enableSorting?: boolean;
  enableExport?: boolean;
  enableRowPinning?: boolean;
  readOnly?: boolean;

  // Styling
  className?: string;
}

export const BaseDataGrid = memo(function BaseDataGrid(props: BaseDataGridProps) {
  // Use unified features hook
  const features = useDataGridFeatures({
    gridId: props.gridId,
    rows: props.rows,
    columns: props.columns,
    paradigm: props.paradigm,
    enableSorting: props.enableSorting,
    enableRowPinning: props.enableRowPinning,
    enableFiltering: props.enableFiltering,
  });

  return (
    <div
      className={cn('flex flex-col h-full', props.className)}
      data-testid="base-datagrid"
    >
      {/* Top slot - paradigm-specific toolbar */}
      {props.topToolbar}

      {/* Quick filter (if enabled) */}
      {props.enableFiltering && features.filtering && 'component' in features.filtering && features.filtering.component}

      {/* Main grid */}
      <div className="flex-1 min-h-0">
        <EditableDataGrid
          tableKey={props.gridId}
          rows={features.grid.rows}
          columns={features.grid.columns}
          getCellContent={features.grid.getCellContent}
          onCellActivated={props.onCellActivated}
          onCellEditCommit={props.onCellEditCommit}
          onRowInsert={props.onRowInsert}
          onRowDelete={props.onRowDelete}
        />
      </div>

      {/* FK Preview popover (SQL only) */}
      {props.enableFKPreview && features.fkPreview && 'component' in features.fkPreview && features.fkPreview.component}

      {/* Bottom slot - paradigm-specific */}
      {props.bottomToolbar}

      {/* Status bar */}
      <DataGridStatusBar
        loadedRows={features.grid.rows.length}
        estimatedTotal={props.estimatedTotal}
        isEstimatedCount={props.isEstimatedCount}
        hasMore={props.hasMore}
        {...features.statusBar}
      />
    </div>
  );
});
