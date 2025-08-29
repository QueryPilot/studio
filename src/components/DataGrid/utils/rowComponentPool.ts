/**
 * DOM Recycling Pool for row components
 * Reduces GC pressure by reusing DOM elements
 */
export class RowComponentPool {
  private availableRows: HTMLDivElement[] = [];
  private inUseRows: Map<string, HTMLDivElement> = new Map();
  private maxPoolSize = 200; // Maximum cached rows
  private rowTemplate: HTMLDivElement | null = null;
  
  constructor(maxSize = 200) {
    this.maxPoolSize = maxSize;
    this.createRowTemplate();
    this.preallocate(50); // Pre-create some rows
  }
  
  /**
   * Create row template for cloning
   */
  private createRowTemplate(): void {
    const template = document.createElement('div');
    template.className = 'data-grid-row-pooled';
    template.style.position = 'absolute';
    template.style.width = '100%';
    template.style.height = '28px';
    template.style.contain = 'layout style paint';
    template.setAttribute('role', 'row');
    this.rowTemplate = template;
  }
  
  /**
   * Preallocate rows to avoid creation during scroll
   */
  private preallocate(count: number): void {
    for (let i = 0; i < count; i++) {
      const row = this.createRow();
      this.availableRows.push(row);
    }
  }
  
  /**
   * Create a new row element
   */
  private createRow(): HTMLDivElement {
    if (this.rowTemplate) {
      return this.rowTemplate.cloneNode(true) as HTMLDivElement;
    }
    
    const row = document.createElement('div');
    row.className = 'data-grid-row-pooled';
    row.style.position = 'absolute';
    row.style.width = '100%';
    row.style.height = '28px';
    row.style.contain = 'layout style paint';
    return row;
  }
  
  /**
   * Acquire a row from the pool
   */
  acquire(key: string): HTMLDivElement {
    // Check if already in use
    if (this.inUseRows.has(key)) {
      return this.inUseRows.get(key)!;
    }
    
    // Get from available pool or create new
    let row = this.availableRows.pop();
    if (!row) {
      row = this.createRow();
    }
    
    // Mark as in use
    this.inUseRows.set(key, row);
    row.setAttribute('data-row-key', key);
    
    return row;
  }
  
  /**
   * Release a row back to the pool
   */
  release(key: string): void {
    const row = this.inUseRows.get(key);
    if (!row) return;
    
    // Clear content for reuse
    this.clearRow(row);
    
    // Remove from in-use
    this.inUseRows.delete(key);
    
    // Add back to available pool if under limit
    if (this.availableRows.length < this.maxPoolSize) {
      this.availableRows.push(row);
    }
  }
  
  /**
   * Release multiple rows at once
   */
  releaseBatch(keys: string[]): void {
    keys.forEach(key => { this.release(key); });
  }
  
  /**
   * Clear row content for reuse
   */
  private clearRow(row: HTMLDivElement): void {
    // Clear content but keep structure
    row.innerHTML = '';
    row.removeAttribute('data-row-key');
    row.removeAttribute('data-index');
    row.className = 'data-grid-row-pooled';
    row.style.transform = '';
  }
  
  /**
   * Update row position without recreating
   */
  updatePosition(key: string, top: number): void {
    const row = this.inUseRows.get(key);
    if (row) {
      // Use transform for GPU acceleration
      row.style.transform = `translateY(${top}px)`;
    }
  }
  
  /**
   * Batch update positions
   */
  updatePositions(positions: Map<string, number>): void {
    requestAnimationFrame(() => {
      positions.forEach((top, key) => {
        const row = this.inUseRows.get(key);
        if (row) {
          row.style.transform = `translateY(${top}px)`;
        }
      });
    });
  }
  
  /**
   * Get statistics about pool usage
   */
  getStats(): {
    available: number;
    inUse: number;
    total: number;
    hitRate: number;
  } {
    const available = this.availableRows.length;
    const inUse = this.inUseRows.size;
    const total = available + inUse;
    const hitRate = total > 0 ? available / total : 0;
    
    return { available, inUse, total, hitRate };
  }
  
  /**
   * Clear all rows from pool
   */
  clear(): void {
    this.inUseRows.forEach(row => { this.clearRow(row); });
    this.inUseRows.clear();
    this.availableRows = [];
  }
  
  /**
   * Destroy pool and clean up
   */
  destroy(): void {
    this.clear();
    this.rowTemplate = null;
  }
}

/**
 * React hook for row pool
 */
import { useRef, useEffect } from 'react';

export function useRowPool(maxSize = 200) {
  const poolRef = useRef<RowComponentPool | null>(null);
  
  if (!poolRef.current) {
    poolRef.current = new RowComponentPool(maxSize);
  }
  
  useEffect(() => {
    return () => {
      poolRef.current?.destroy();
    };
  }, []);
  
  return poolRef.current;
}