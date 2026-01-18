/**
 * DocumentDataGrid - MongoDB document browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Drill-down navigation for nested objects/arrays
 * - Dynamic column generation from document keys
 * - Breadcrumb navigation in topToolbar
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useMemo } from 'react';
import type { Item } from '@glideapps/glide-data-grid';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { useDocumentData } from '../hooks/useDocumentData';
import { useCrudStore } from '@/stores/crudStore';
import type { GridEditCommitEvent } from '../types';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

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

  // Get document data
  const data = useDocumentData({
    connectionId,
    database,
    collection,
    pageSize,
    enabled: true,
  });

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

  // Note: Row insert/delete now handled by BaseDataGrid via commandFactory
  // TODO: Implement CrudCommandFactory for document paradigm

  // Breadcrumb navigation toolbar
  const topToolbar = useMemo(
    () => (
      <BreadcrumbNav
        path={data.currentPath}
        collectionName={collection}
        onNavigate={data.navigateToPath}
        onNavigateToRoot={() => { data.navigateToPath(-1); }}
      />
    ),
    [data, collection]
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
      onCellActivated={handleCellActivated}
      onCellEditCommit={handleCellEditCommit}
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
