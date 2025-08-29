/**
 * Performance monitoring utility for DataGrid
 * Tracks FPS, render times, and memory usage
 */

// Set to true only when debugging performance issues
const DEBUG_PERFORMANCE = false;

export class PerformanceMonitor {
  private fps = 0;
  private frameCount = 0;
  private lastTime = performance.now();
  private renderTimes: number[] = [];
  private selectionTimes: number[] = [];
  private scrollMetrics = {
    totalScrolls: 0,
    laggyScrolls: 0,
    averageFPS: 0,
  };
  
  private rafId: number | null = null;
  private isMonitoring = false;
  
  /**
   * Start monitoring performance
   */
  start() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.measureFPS();
    this.logMetrics();
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    this.isMonitoring = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
  
  /**
   * Measure FPS
   */
  private measureFPS = () => {
    if (!this.isMonitoring) return;
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    
    this.frameCount++;
    
    if (deltaTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.frameCount = 0;
      this.lastTime = currentTime;
      
      // Track scroll performance
      if (this.fps < 30) {
        this.scrollMetrics.laggyScrolls++;
      }
      
      // Update average FPS
      this.scrollMetrics.averageFPS = 
        (this.scrollMetrics.averageFPS * this.scrollMetrics.totalScrolls + this.fps) / 
        (this.scrollMetrics.totalScrolls + 1);
      this.scrollMetrics.totalScrolls++;
    }
    
    this.rafId = requestAnimationFrame(this.measureFPS);
  };
  
  /**
   * Track render time
   */
  trackRender(startTime: number) {
    const renderTime = performance.now() - startTime;
    this.renderTimes.push(renderTime);
    
    // Keep only last 100 measurements
    if (this.renderTimes.length > 100) {
      this.renderTimes.shift();
    }
  }
  
  /**
   * Track selection time
   */
  trackSelection(startTime: number) {
    const selectionTime = performance.now() - startTime;
    this.selectionTimes.push(selectionTime);
    
    // Keep only last 100 measurements
    if (this.selectionTimes.length > 100) {
      this.selectionTimes.shift();
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics() {
    const avgRenderTime = this.renderTimes.length > 0
      ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length
      : 0;
      
    const avgSelectionTime = this.selectionTimes.length > 0
      ? this.selectionTimes.reduce((a, b) => a + b, 0) / this.selectionTimes.length
      : 0;
    
    const memory = (performance as any).memory ? {
      used: Math.round((performance as any).memory.usedJSHeapSize / 1048576),
      total: Math.round((performance as any).memory.totalJSHeapSize / 1048576),
      limit: Math.round((performance as any).memory.jsHeapSizeLimit / 1048576),
    } : null;
    
    return {
      fps: this.fps,
      avgRenderTime: Math.round(avgRenderTime * 100) / 100,
      avgSelectionTime: Math.round(avgSelectionTime * 100) / 100,
      scrollMetrics: this.scrollMetrics,
      memory,
      renderCount: this.renderTimes.length,
      selectionCount: this.selectionTimes.length,
    };
  }
  
  /**
   * Log metrics to console
   */
  private logMetrics() {
    if (!this.isMonitoring || !DEBUG_PERFORMANCE) return;
    
    const metrics = this.getMetrics();
    
    console.group('🎯 DataGrid Performance Metrics');
    console.log(`FPS: ${metrics.fps}`);
    console.log(`Avg Render Time: ${metrics.avgRenderTime}ms`);
    console.log(`Avg Selection Time: ${metrics.avgSelectionTime}ms`);
    console.log(`Scroll Performance: ${Math.round(metrics.scrollMetrics.averageFPS)}fps avg`);
    console.log(`Laggy Scrolls: ${metrics.scrollMetrics.laggyScrolls}/${metrics.scrollMetrics.totalScrolls}`);
    
    if (metrics.memory) {
      console.log(`Memory: ${metrics.memory.used}MB / ${metrics.memory.total}MB (${Math.round((metrics.memory.used / metrics.memory.total) * 100)}%)`);
    }
    console.groupEnd();
    
    // Log every 5 seconds only when debugging
    if (DEBUG_PERFORMANCE) {
      setTimeout(() => { this.logMetrics(); }, 5000);
    }
  }
  
  /**
   * Create performance mark
   */
  mark(name: string) {
    performance.mark(name);
  }
  
  /**
   * Measure between marks
   */
  measure(name: string, startMark: string, endMark?: string) {
    if (endMark) {
      performance.measure(name, startMark, endMark);
    } else {
      performance.measure(name, startMark);
    }
    
    const entries = performance.getEntriesByName(name, 'measure');
    const duration = entries[entries.length - 1]?.duration || 0;
    
    // Clean up marks
    performance.clearMarks(startMark);
    if (endMark) performance.clearMarks(endMark);
    performance.clearMeasures(name);
    
    return duration;
  }
}

// Singleton instance
export const gridPerformanceMonitor = new PerformanceMonitor();

/**
 * Hook for performance monitoring
 */
export function usePerformanceMonitor(enabled = false) {
  useEffect(() => {
    if (enabled) {
      gridPerformanceMonitor.start();
      return () => { gridPerformanceMonitor.stop(); };
    }
    return undefined;
  }, [enabled]);
  
  return gridPerformanceMonitor;
}

import { useEffect } from 'react';