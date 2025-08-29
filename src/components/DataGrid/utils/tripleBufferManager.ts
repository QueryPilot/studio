import type { TableDataRow } from '@/services/tableDataTypes';

/**
 * Triple Buffer Manager for seamless scrolling
 * Pre-loads data in background buffers while displaying from active buffer
 */
export class TripleBufferManager {
  private static readonly ROW_HEIGHT = 28;
  
  // Triple buffers for seamless swapping
  private buffers = {
    active: new Map<number, TableDataRow>(),
    ready: new Map<number, TableDataRow>(),
    preparing: new Map<number, TableDataRow>()
  };
  
  // Current viewport state
  private visibleRange = { start: 0, end: 0 };
  private totalRows = 0;
  
  // Data fetcher callback
  private fetchRow: ((index: number) => TableDataRow | null) | null = null;
  
  // Performance tracking
  private stats = {
    hits: 0,
    misses: 0,
    swaps: 0
  };
  
  constructor(fetchRowCallback?: (index: number) => TableDataRow | null) {
    this.fetchRow = fetchRowCallback || null;
  }
  
  /**
   * Set data fetcher callback
   */
  setFetchCallback(callback: (index: number) => TableDataRow | null): void {
    this.fetchRow = callback;
  }
  
  /**
   * Update total row count
   */
  setTotalRows(count: number): void {
    this.totalRows = count;
  }
  
  /**
   * Update viewport using scroll position and container height
   */
  updateViewport(
    scrollTop: number,
    containerHeight: number,
    overscan: number
  ): void {
    // Calculate visible range using fixed height
    const start = Math.floor(scrollTop / TripleBufferManager.ROW_HEIGHT);
    const end = Math.ceil((scrollTop + containerHeight) / TripleBufferManager.ROW_HEIGHT);
    
    // Check if viewport changed significantly
    const viewportChanged = 
      Math.abs(start - this.visibleRange.start) > 5 ||
      Math.abs(end - this.visibleRange.end) > 5;
    
    this.visibleRange = { start, end };
    
    // Prepare buffers if viewport changed
    if (viewportChanged) {
      this.prepareBuffer(start - overscan, end + overscan);
    }
  }
  
  /**
   * Prepare next buffer in background
   */
  private prepareBuffer(start: number, end: number): void {
    // Clamp to valid range
    start = Math.max(0, start);
    end = Math.min(this.totalRows - 1, end);
    
    // Use idle callback for non-blocking preparation
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => { this.performBufferSwap(start, end); }, { timeout: 50 });
    } else {
      setTimeout(() => { this.performBufferSwap(start, end); }, 0);
    }
  }
  
  /**
   * Perform buffer swap and population
   */
  private performBufferSwap(start: number, end: number): void {
    // Rotate buffers: active -> ready -> preparing -> active
    const temp = this.buffers.active;
    this.buffers.active = this.buffers.ready;
    this.buffers.ready = this.buffers.preparing;
    this.buffers.preparing = temp;
    
    this.stats.swaps++;
    
    // Clear and populate preparing buffer
    this.buffers.preparing.clear();
    
    if (this.fetchRow) {
      for (let i = start; i <= end; i++) {
        const row = this.fetchRow(i);
        if (row) {
          this.buffers.preparing.set(i, row);
        }
      }
    }
  }
  
  /**
   * Get row from buffers
   */
  getRow(index: number): TableDataRow | null {
    // Try active buffer first
    if (this.buffers.active.has(index)) {
      this.stats.hits++;
      return this.buffers.active.get(index)!;
    }
    
    // Try ready buffer
    if (this.buffers.ready.has(index)) {
      this.stats.hits++;
      return this.buffers.ready.get(index)!;
    }
    
    // Try preparing buffer
    if (this.buffers.preparing.has(index)) {
      this.stats.hits++;
      return this.buffers.preparing.get(index)!;
    }
    
    // Miss - fetch directly
    this.stats.misses++;
    if (this.fetchRow) {
      const row = this.fetchRow(index);
      if (row) {
        // Add to active buffer for next access
        this.buffers.active.set(index, row);
        return row;
      }
    }
    
    return null;
  }
  
  /**
   * Get multiple rows efficiently
   */
  getRows(startIndex: number, endIndex: number): TableDataRow[] {
    const rows: TableDataRow[] = [];
    
    for (let i = startIndex; i <= endIndex; i++) {
      const row = this.getRow(i);
      if (row) {
        rows.push(row);
      }
    }
    
    return rows;
  }
  
  /**
   * Check if row is buffered
   */
  hasRow(index: number): boolean {
    return this.buffers.active.has(index) ||
           this.buffers.ready.has(index) ||
           this.buffers.preparing.has(index);
  }
  
  /**
   * Get buffer hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }
  
  /**
   * Get buffer statistics
   */
  getStats(): {
    hits: number;
    misses: number;
    swaps: number;
    hitRate: number;
    activeSize: number;
    readySize: number;
    preparingSize: number;
  } {
    return {
      ...this.stats,
      hitRate: this.getHitRate(),
      activeSize: this.buffers.active.size,
      readySize: this.buffers.ready.size,
      preparingSize: this.buffers.preparing.size
    };
  }
  
  /**
   * Calculate exact row position without measurement
   */
  getRowPosition(index: number): number {
    return index * TripleBufferManager.ROW_HEIGHT;
  }
  
  /**
   * Invalidate specific rows
   */
  invalidateRows(indices: number[]): void {
    indices.forEach(index => {
      this.buffers.active.delete(index);
      this.buffers.ready.delete(index);
      this.buffers.preparing.delete(index);
    });
  }
  
  /**
   * Clear all buffers
   */
  clear(): void {
    this.buffers.active.clear();
    this.buffers.ready.clear();
    this.buffers.preparing.clear();
    this.stats = { hits: 0, misses: 0, swaps: 0 };
  }
  
  /**
   * Prefetch rows for smooth scrolling
   */
  prefetch(startIndex: number, endIndex: number): void {
    if (!this.fetchRow) return;
    
    // Use idle time to prefetch
    requestIdleCallback(() => {
      for (let i = startIndex; i <= endIndex; i++) {
        if (!this.hasRow(i)) {
          const row = this.fetchRow!(i);
          if (row) {
            this.buffers.preparing.set(i, row);
          }
        }
      }
    }, { timeout: 100 });
  }
}

/**
 * React hook for triple buffer manager
 */
import { useRef, useEffect, useCallback } from 'react';

export function useTripleBuffer(
  rows: TableDataRow[],
  totalRows: number
) {
  const managerRef = useRef<TripleBufferManager | null>(null);
  
  if (!managerRef.current) {
    managerRef.current = new TripleBufferManager();
  }
  
  // Update fetch callback when rows change
  useEffect(() => {
    managerRef.current?.setFetchCallback((index) => rows[index] || null);
    managerRef.current?.setTotalRows(totalRows);
  }, [rows, totalRows]);
  
  const updateViewport = useCallback((
    scrollTop: number,
    containerHeight: number,
    overscan: number
  ) => {
    managerRef.current?.updateViewport(scrollTop, containerHeight, overscan);
  }, []);
  
  const getRow = useCallback((index: number) => {
    return managerRef.current?.getRow(index) || null;
  }, []);
  
  const getRows = useCallback((start: number, end: number) => {
    return managerRef.current?.getRows(start, end) || [];
  }, []);
  
  const prefetch = useCallback((start: number, end: number) => {
    managerRef.current?.prefetch(start, end);
  }, []);
  
  const getStats = useCallback(() => {
    return managerRef.current?.getStats();
  }, []);
  
  // Cleanup
  useEffect(() => {
    return () => {
      managerRef.current?.clear();
    };
  }, []);
  
  return {
    updateViewport,
    getRow,
    getRows,
    prefetch,
    getStats
  };
}