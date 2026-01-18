/**
 * KeyValueDataGrid - Redis key browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Type-aware column mapping for all Redis types
 * - Pattern filtering for key browser mode
 * - Key metadata header when viewing specific key
 * - CRUD operations via the staging pipeline
 */

import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { BaseDataGrid } from '../base/BaseDataGrid';
import { KeyHeader } from '../components/KeyHeader';
import { useKeyValueData } from '../hooks/useKeyValueData';
import { useCrudStore } from '@/stores/crudStore';
import type { GridEditCommitEvent } from '../types';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { IconSearch, IconX, IconRefresh, IconDatabase } from '@tabler/icons-react';

// ============================================================================
// Types
// ============================================================================

export interface KeyValueDataGridProps {
  /** Unique grid ID for state management */
  gridId: string;
  /** Connection ID */
  connectionId: string;
  /** Redis database index */
  database: number;
  /** Initial key to display */
  initialKey?: string;
  /** CSS class name */
  className?: string;
}

// ============================================================================
// Key Browser Toolbar Component
// ============================================================================

interface KeyBrowserToolbarProps {
  pattern: string;
  onPatternChange: (pattern: string) => void;
  onRefresh: () => void;
  totalKeyCount?: number;
  displayedCount: number;
  isLoading?: boolean;
}

const KeyBrowserToolbar = memo(function KeyBrowserToolbar({
  pattern,
  onPatternChange,
  onRefresh,
  totalKeyCount,
  displayedCount,
  isLoading,
}: KeyBrowserToolbarProps) {
  const [inputValue, setInputValue] = useState(pattern === '*' ? '' : pattern);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync input when external pattern changes
  useEffect(() => {
    setInputValue(pattern === '*' ? '' : pattern);
  }, [pattern]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Debounce pattern change
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      // Convert empty to '*', add '*' suffix if not present for prefix search
      let newPattern = value.trim();
      if (!newPattern) {
        newPattern = '*';
      } else if (!newPattern.includes('*') && !newPattern.includes('?')) {
        // If no wildcards, treat as prefix search
        newPattern = `${newPattern}*`;
      }
      onPatternChange(newPattern);
    }, 500);
  }, [onPatternChange]);

  const handleClear = useCallback(() => {
    setInputValue('');
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    onPatternChange('*');
  }, [onPatternChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Immediate search on Enter
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      let newPattern = inputValue.trim();
      if (!newPattern) {
        newPattern = '*';
      } else if (!newPattern.includes('*') && !newPattern.includes('?')) {
        newPattern = `${newPattern}*`;
      }
      onPatternChange(newPattern);
    } else if (e.key === 'Escape') {
      handleClear();
    }
  }, [inputValue, onPatternChange, handleClear]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-background">
      {/* Pattern search input */}
      <div className="relative flex-1 max-w-md">
        <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Filter keys: user:*, *:session:*, cache:user:?"
          className="h-7 pl-7 pr-7 text-xs"
        />
        {inputValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5"
            onClick={handleClear}
          >
            <IconX className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Key count info */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconDatabase className="h-3.5 w-3.5" />
        <span>
          {displayedCount}
          {totalKeyCount !== undefined && totalKeyCount > displayedCount && (
            <span className="text-muted-foreground/70"> / {totalKeyCount}</span>
          )}
          {' keys'}
        </span>
      </div>

      {/* Refresh button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onRefresh}
        disabled={isLoading}
      >
        <IconRefresh className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
      </Button>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const KeyValueDataGrid = memo(function KeyValueDataGrid({
  gridId,
  connectionId,
  database,
  initialKey,
  className,
}: KeyValueDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);

  // Get key-value data
  const data = useKeyValueData({
    connectionId,
    database,
    initialKey,
    enabled: true,
  });

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(
    (event: GridEditCommitEvent) => {
      logger.info('keyvalue-grid', 'handleCellEditCommit called', {
        column: event.column?.field,
        rowIndex: event.rowIndex,
        hasRow: !!event.row,
        newValue: event.newValue,
        isBrowserMode: data.isBrowserMode,
        currentKey: data.currentKey,
      });
      const cmd = data.createEditCommand(event);
      logger.info('keyvalue-grid', 'createEditCommand result', { cmd: cmd ? 'created' : 'null' });
      if (cmd) {
        stageCommand(cmd);
        logger.info('keyvalue-grid', 'Staged edit command', cmd);
      } else {
        logger.warn('keyvalue-grid', 'No command created - edit not staged');
      }
      return undefined;
    },
    [data, stageCommand]
  );

  // Note: Row insert/delete now handled by BaseDataGrid via commandFactory
  // TODO: Implement CrudCommandFactory for keyvalue paradigm

  // Handle refresh
  const handleRefresh = useCallback(() => {
    data.refetch();
    logger.info('keyvalue-grid', 'Refreshing key data');
  }, [data]);

  // Browser mode shows all keys, individual key mode shows key contents
  const isBrowserMode = data.isBrowserMode;

  // Top toolbar based on mode
  const topToolbar = useMemo(() => {
    if (isBrowserMode) {
      // Browser mode: show pattern filter toolbar
      return (
        <KeyBrowserToolbar
          pattern={data.pattern}
          onPatternChange={data.setPattern}
          onRefresh={handleRefresh}
          totalKeyCount={data.totalKeyCount}
          displayedCount={data.rows.length}
          isLoading={data.isLoading}
        />
      );
    }
    // Key view mode: show key metadata header
    return data.currentKey && <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />;
  }, [isBrowserMode, data.currentKey, data.pattern, data.setPattern, data.totalKeyCount, data.rows.length, data.isLoading, handleRefresh]);

  // Determine read-only state (streams are read-only, browser mode is always read-only)
  const readOnly = isBrowserMode || data.currentKey?.type === 'stream';

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
      estimatedTotal={data.rows.length}
      isEstimatedCount={false}
      onCellEditCommit={isBrowserMode ? undefined : handleCellEditCommit}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={String(database)}
      tableName={isBrowserMode ? `db${database}:keys` : (data.currentKey?.key || 'redis')}
      paradigm="keyvalue"
      enableFiltering={false} // We have our own pattern filter
      enableSorting={isBrowserMode}
      enableExport={true}
      enableRowPinning={false}
      readOnly={readOnly}
      onRefetch={data.refetch}
      className={cn('keyvalue-datagrid', className)}
    />
  );
});

export default KeyValueDataGrid;
