/**
 * Fast render strategy optimized for fixed row height
 * Enables instant position calculations without DOM measurements
 */
export class FastRenderStrategy {
  static readonly ROW_HEIGHT = 28;
  static readonly HEADER_HEIGHT = 32;
  
  /**
   * Calculate visible range instantly without DOM queries
   * Account for header height to match getRowTop() positioning
   */
  static getVisibleRange(
    scrollTop: number, 
    containerHeight: number
  ): { start: number; end: number } {
    // Adjust scrollTop to account for header height
    const adjustedScrollTop = Math.max(0, scrollTop - this.HEADER_HEIGHT);
    const start = Math.floor(adjustedScrollTop / this.ROW_HEIGHT);
    const visibleCount = Math.ceil(containerHeight / this.ROW_HEIGHT);
    const end = start + visibleCount;
    return { start, end };
  }
  
  /**
   * Get exact row position without measurement
   */
  static getRowTop(index: number): number {
    return index * this.ROW_HEIGHT + this.HEADER_HEIGHT;
  }
  
  /**
   * Calculate total scrollable height
   */
  static getTotalHeight(rowCount: number): number {
    return rowCount * this.ROW_HEIGHT + this.HEADER_HEIGHT;
  }
  
  /**
   * Binary search for row at position
   */
  static getRowAtPosition(y: number): number {
    if (y <= this.HEADER_HEIGHT) return 0;
    return Math.floor((y - this.HEADER_HEIGHT) / this.ROW_HEIGHT);
  }
  
  /**
   * Get rows in viewport with overscan
   */
  static getRowsInViewport(
    scrollTop: number,
    containerHeight: number,
    totalRows: number,
    overscan: number,
    scrollDirection: 'up' | 'down' | 'none' = 'none'
  ): { start: number; end: number; visible: number } {
    const { start, end } = this.getVisibleRange(scrollTop, containerHeight);
    
    // Asymmetric overscan based on scroll direction
    // Render more rows in the direction of scroll
    let overscanBefore = overscan;
    let overscanAfter = overscan;
    
    if (scrollDirection === 'down') {
      // Scrolling down - render more rows below
      overscanBefore = Math.floor(overscan * 0.3);
      overscanAfter = Math.floor(overscan * 1.7);
    } else if (scrollDirection === 'up') {
      // Scrolling up - render more rows above
      overscanBefore = Math.floor(overscan * 1.7);
      overscanAfter = Math.floor(overscan * 0.3);
    }
    
    const overscanStart = Math.max(0, start - overscanBefore);
    const overscanEnd = Math.min(totalRows - 1, end + overscanAfter);
    
    return {
      start: overscanStart,
      end: overscanEnd,
      visible: end - start
    };
  }
  
  /**
   * Check if row is in viewport
   */
  static isRowInViewport(
    rowIndex: number,
    scrollTop: number,
    containerHeight: number
  ): boolean {
    const rowTop = rowIndex * this.ROW_HEIGHT + this.HEADER_HEIGHT;
    const rowBottom = rowTop + this.ROW_HEIGHT;
    const viewportBottom = scrollTop + containerHeight;
    
    return rowBottom > scrollTop && rowTop < viewportBottom;
  }
  
  /**
   * Pre-calculate all row positions for instant access
   */
  static preCalculatePositions(rowCount: number): Float32Array {
    const positions = new Float32Array(rowCount);
    for (let i = 0; i < rowCount; i++) {
      positions[i] = i * this.ROW_HEIGHT;
    }
    return positions;
  }
}