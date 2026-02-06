/**
 * KeyValueDataGrid - Redis key browser using the unified BaseDataGrid architecture
 *
 * Features:
 * - BaseDataGrid foundation with all unified features
 * - Type-aware column mapping for all Redis types
 * - Pattern filtering for key browser mode
 * - Key metadata header when viewing specific key
 * - Client-side filtering in key view mode (search, pattern, score range for ZSet)
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
import {
  type KeyValueFilter,
  parseKeyValueFilter,
} from '@/utils/keyvalueFilterParser';
import { RedisAdapter } from '@/adapters/redis/RedisAdapter';

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
  /** Whether this grid's panel is focused (for auto-focus) */
  focused?: boolean;
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
  focused,
}: KeyValueDataGridProps) {
  const stageCommand = useCrudStore((s) => s.stageCommand);

  // Filter state for key view mode
  const [kvFilter, setKvFilter] = useState<KeyValueFilter | undefined>(undefined);
  const [filterValue, setFilterValue] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Get key-value data with filter
  const data = useKeyValueData({
    connectionId,
    database,
    initialKey,
    enabled: true,
    filter: kvFilter,
  });

  // Handle filter submission for key view mode
  const handleFilterSubmit = useCallback(() => {
    const value = filterValue.trim();

    if (!value) {
      setKvFilter(undefined);
      setFilterError(null);
      return;
    }

    const result = parseKeyValueFilter(value);

    if (result.success && result.filter) {
      setKvFilter(result.filter);
      setFilterError(null);
      logger.info('keyvalue-grid', 'Filter applied', {
        mode: result.filter.mode,
        description: result.filter.description,
      });
    } else if (result.success && !result.filter) {
      setKvFilter(undefined);
      setFilterError(null);
    } else {
      setFilterError(result.error || 'Invalid filter');
    }
  }, [filterValue]);

  // Clear filter when key changes - use JSON.stringify to detect object changes properly
  const currentKeyId = data.currentKey ? `${data.currentKey.key}:${data.currentKey.type}` : null;
  useEffect(() => {
    setKvFilter(undefined);
    setFilterValue('');
    setFilterError(null);
  }, [currentKeyId]);

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

  // Handle refresh
  const handleRefresh = useCallback(() => {
    data.refetch();
    logger.info('keyvalue-grid', 'Refreshing key data');
  }, [data]);

  // Browser mode shows all keys, individual key mode shows key contents
  const isBrowserMode = data.isBrowserMode;

  // Get placeholder text based on key type
  const filterPlaceholder = useMemo(() => {
    const keyType = data.currentKey?.type;
    switch (keyType) {
      case 'hash':
        return 'Search fields/values, or use wildcards: field*';
      case 'zset':
        return 'Search members/scores, or use wildcards: member*';
      case 'list':
        return 'Search values...';
      case 'set':
        return 'Search members, or use wildcards: mem*';
      default:
        return 'Search...';
    }
  }, [data.currentKey?.type]);

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
    // Key view mode: show key metadata header with optional filter
    return (
      <div className="flex flex-col">
        {data.currentKey && <KeyHeader metadata={data.currentKey} onRefresh={handleRefresh} />}
        {/* Show filter for types that have multiple rows */}
        {data.currentKey && ['hash', 'list', 'set', 'zset'].includes(data.currentKey.type) && (
          <div className="flex items-center gap-2 px-2 py-1 border-t bg-background">
            <div className="relative flex-1 max-w-md">
              <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={filterInputRef}
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleFilterSubmit();
                  } else if (e.key === 'Escape') {
                    setFilterValue('');
                    setKvFilter(undefined);
                    setFilterError(null);
                  }
                }}
                placeholder={filterPlaceholder}
                className={cn('h-7 pl-7 pr-7 text-xs', filterError && 'border-destructive')}
              />
              {filterValue && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5"
                  onClick={() => {
                    setFilterValue('');
                    setKvFilter(undefined);
                    setFilterError(null);
                  }}
                >
                  <IconX className="h-3 w-3" />
                </Button>
              )}
            </div>
            {filterError && (
              <span className="text-xs text-destructive">{filterError}</span>
            )}
            {kvFilter && !filterError && (
              <span className="text-xs text-muted-foreground">
                {data.rows.length} results
              </span>
            )}
          </div>
        )}
      </div>
    );
  }, [isBrowserMode, data.currentKey, data.pattern, data.setPattern, data.totalKeyCount, data.rows.length, data.isLoading, handleRefresh, filterValue, filterPlaceholder, filterError, kvFilter, handleFilterSubmit]);

  // Determine read-only state and reason
  const readOnly = isBrowserMode || data.currentKey?.type === 'stream';
  const readOnlyReason = isBrowserMode
    ? "Read-only: Key browser mode"
    : data.currentKey?.type === 'stream'
      ? "Read-only: Stream type"
      : undefined;

  // Loading and error states
  // Show loading skeleton only on initial load (no rows yet)
  // When fetching more pages, the grid stays visible with existing data
  const isInitialLoading = data.isLoading && data.rows.length === 0;
  const isFetchingMore = data.isLoading && data.rows.length > 0;
  const errorMessage = data.error ? data.error.message : null;

  // Reconnection handler
  const handleReconnect = useCallback(async () => {
    try {
      // Test connection by pinging Redis
      const adapter = new RedisAdapter(connectionId);
      await adapter.selectDatabase(database);
      data.refetch();
    } catch (err) {
      console.error('Reconnection failed:', err);
      data.refetch(); // Still try to refetch
    }
  }, [connectionId, database, data]);

  return (
    <BaseDataGrid
      gridId={gridId}
      rows={data.rows}
      columns={data.columns}
      getCellContent={data.getCellContent}
      isLoading={isInitialLoading}
      isLoadingMore={isFetchingMore}
      error={errorMessage}
      hasMore={data.hasMore}
      onLoadMore={data.fetchNextPage}
      estimatedTotal={isBrowserMode ? (data.totalKeyCount ?? data.rows.length) : data.rows.length}
      isEstimatedCount={isBrowserMode}
      executionTime={data.executionTime}
      onCellEditCommit={isBrowserMode ? undefined : handleCellEditCommit}
      // Command factory for CRUD operations (add/delete rows in hash, list, set, zset)
      // Returns undefined in browser mode or for unsupported types (string, stream)
      commandFactory={data.commandFactory}
      topToolbar={topToolbar}
      connectionId={connectionId}
      database={String(database)}
      tableName={isBrowserMode ? `db${database}:keys` : (data.currentKey?.key || 'redis')}
      paradigm="keyvalue"
      enableFiltering={false} // Keep false - has custom pattern filter
      enableSorting={true} // ✅ ENABLE - Hash fields, zset scores, list indices can all be sorted
      enableExport={true}
      enableRowPinning={true} // ✅ ENABLE - Keep important hash fields or zset members visible
      enableColumnManagement={true} // ✅ ENABLE - Useful for hash/zset 2-column views
      enableClipboard={true} // ✅ ENABLE - Copy Redis data for external use
      enableFillOperations={!readOnly} // ✅ ENABLE - Bulk updates (disabled for streams/browser mode)
      enableStagedChanges={!readOnly} // ✅ ENABLE - Show staged changes and allow commit
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      onRefetch={data.refetch}
      onReconnect={handleReconnect}
      focused={focused}
      className={cn('keyvalue-datagrid', className)}
    />
  );
});

export default KeyValueDataGrid;
