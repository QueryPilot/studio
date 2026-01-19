/**
 * DocumentDataGrid - MongoDB document browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Drill-down navigation for nested objects/arrays
 * - Dynamic column generation from document keys
 * - Breadcrumb navigation in topToolbar
 * - CRUD operations via the staging pipeline
 * - Server-side (query) and client-side (search) filtering
 */

import { memo, useCallback, useMemo, useState, useRef } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { useDocumentData } from '../hooks/useDocumentData';
import { useCrudStore } from '@/stores/crudStore';
import type { GridEditCommitEvent } from '../types';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import {
  type DocumentFilter,
  parseDocumentFilter,
} from '@/utils/documentFilterParser';
import { useQuickFilter } from '../hooks/useQuickFilter';
import type { FilterColumnInfo } from '@/utils/filterParser';
import { QuickFilter, type QuickFilterRef } from '../components/QuickFilter';
import type { FilterMode } from '@/utils/filterParser';

// ============================================================================
// Types
// ============================================================================

export interface DocumentDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Page size for pagination */
  pageSize?: number;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const DocumentDataGrid = memo(function DocumentDataGrid({
  gridId,
  connectionId,
  database,
  collection,
  pageSize = 50,
  className,
}: DocumentDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const quickFilterRef = useRef<QuickFilterRef>(null);

  // Filter state
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter | undefined>(undefined);
  const [filterError, setFilterError] = useState<string | null>(null);

  // Get document data with filter
  const data = useDocumentData({
    connectionId,
    database,
    collection,
    pageSize,
    enabled: true,
    filter: documentFilter,
  });

  // Build filter columns from data columns
  const filterColumns = useMemo<FilterColumnInfo[]>(() => {
    return data.columns.map(col => ({
      name: col.field,
      dataType: col.type || 'string',
    }));
  }, [data.columns]);

  // Quick filter hook for managing filter input state
  const quickFilter = useQuickFilter({
    columns: filterColumns,
    clientSideFiltering: false, // We handle both server and client filtering ourselves
  });

  // Handle filter submission
  const handleFilterSubmit = useCallback(async () => {
    const value = quickFilter.value.trim();

    if (!value) {
      setDocumentFilter(undefined);
      setFilterError(null);
      return;
    }

    const result = parseDocumentFilter(value);

    if (result.success && result.filter) {
      setDocumentFilter(result.filter);
      setFilterError(null);
      logger.info('document-grid', 'Filter applied', {
        mode: result.filter.mode,
        description: result.filter.description,
      });
    } else if (result.success && !result.filter) {
      // Empty filter
      setDocumentFilter(undefined);
      setFilterError(null);
    } else {
      setFilterError(result.error || 'Invalid filter');
    }
  }, [quickFilter.value]);

  // Handle mode change - convert between document filter modes and standard modes
  const handleModeChange = useCallback((mode: FilterMode) => {
    quickFilter.setMode(mode);
    // Clear filter when mode changes
    setDocumentFilter(undefined);
    setFilterError(null);
  }, [quickFilter]);

  // Handle cell activation for drill-down
  const handleCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell;
      if (data.canStepInto(row, col)) {
        data.stepInto(row, col);
        logger.info('document-grid', `Drilled into cell [${row}, ${col}]`, {
          path: data.currentPath,
        });
        return true;
      }
      return false;
    },
    [data]
  );

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      const cmd = data.createEditCommand(event);
      if (cmd) {
        stageCommand(cmd);
        logger.info('document-grid', 'Staged edit command');
      }
      return undefined;
    },
    [data, stageCommand]
  );

  // Breadcrumb navigation toolbar with optional filter
  const topToolbar = useMemo(
    () => (
      <div className="flex flex-col">
        <BreadcrumbNav
          path={data.currentPath}
          collectionName={collection}
          onNavigate={data.navigateToPath}
          onNavigateToRoot={() => { data.navigateToPath(-1); }}
        />
        {/* Show filter at root level only */}
        {data.currentPath.length === 0 && filterColumns.length > 0 && (
          <div className="px-2 py-1 border-t">
            <QuickFilter
              ref={quickFilterRef}
              columns={filterColumns}
              value={quickFilter.value}
              mode={quickFilter.mode}
              onValueChange={quickFilter.setValue}
              onModeChange={handleModeChange}
              onSubmit={handleFilterSubmit}
              error={filterError}
              searchModeOnly={false}
            />
          </div>
        )}
      </div>
    ),
    [data.currentPath, collection, data.navigateToPath, filterColumns, quickFilter.value, quickFilter.mode, quickFilter.setValue, handleModeChange, handleFilterSubmit, filterError]
  );

  // Determine read-only state (nested paths are read-only)
  const readOnly = data.currentPath.length > 0;

  // Loading and error states
  const isLoading = data.isLoading && data.rows.length === 0;
  const errorMessage = data.error ? data.error.message : null;

  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      isLoading={isLoading}
      error={errorMessage}
      hasMore={data.hasMore}
      onLoadMore={data.fetchNextPage}
      estimatedTotal={data.totalCount}
      isEstimatedCount={false}
      executionTime={data.executionTime}
      onCellActivated={handleCellActivated}
      onCellEditCommit={handleCellEditCommit}
      // Command factory for CRUD operations (insert/delete documents)
      // Returns undefined when in nested path (read-only mode)
      commandFactory={data.commandFactory}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={database}
      tableName={collection}
      paradigm="document"
      enableFiltering={false}
      enableSorting={false}
      enableExport={true}
      enableRowPinning={false}
      readOnly={readOnly}
      onRefetch={data.refetch}
      className={cn('document-datagrid', className)}
    />
  );
});

export default DocumentDataGrid;
