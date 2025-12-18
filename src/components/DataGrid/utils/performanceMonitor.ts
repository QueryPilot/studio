import { logger } from "@/lib/logger";
/**
 * Performance monitoring utilities for DataGrid V2
 * 
 * Use these utilities to measure and track performance improvements:
 * - FPS during column resize operations
 * - Render times for cell content generation
 * - Memory usage tracking
 */

interface PerformanceMetrics {
  fps: number;
  avgFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  totalFrames: number;
  droppedFrames: number;
}

interface RenderMetrics {
  renderCount: number;
  avgRenderTime: number;
  maxRenderTime: number;
  totalRenderTime: number;
}

class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private droppedFrames: number = 0;
  private isMonitoring: boolean = false;
  private rafId: number | null = null;
  
  private renderTimes: number[] = [];
  private renderCount: number = 0;

  /**
   * Start monitoring FPS (useful during column resize operations)
   */
  startFPSMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.frameTimes = [];
    this.frameCount = 0;
    this.droppedFrames = 0;
    this.lastFrameTime = performance.now();
    
    const measureFrame = () => {
      if (!this.isMonitoring) return;
      
      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      this.lastFrameTime = now;
      
      this.frameTimes.push(frameTime);
      this.frameCount++;
      
      // Frame took longer than 16.67ms (60fps threshold)
      if (frameTime > 16.67) {
        this.droppedFrames++;
      }
      
      // Keep only last 100 frames to avoid memory bloat
      if (this.frameTimes.length > 100) {
        this.frameTimes.shift();
      }
      
      this.rafId = requestAnimationFrame(measureFrame);
    };
    
    this.rafId = requestAnimationFrame(measureFrame);
  }

  /**
   * Stop monitoring FPS and return metrics
   */
  stopFPSMonitoring(): PerformanceMetrics {
    this.isMonitoring = false;
    
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    const avgFrameTime = this.frameTimes.length > 0
      ? this.frameTimes.reduce((sum, t) => sum + t, 0) / this.frameTimes.length
      : 0;
    
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    
    return {
      fps: Math.round(fps * 10) / 10,
      avgFrameTime: Math.round(avgFrameTime * 100) / 100,
      minFrameTime: Math.min(...this.frameTimes, 0),
      maxFrameTime: Math.max(...this.frameTimes, 0),
      totalFrames: this.frameCount,
      droppedFrames: this.droppedFrames,
    };
  }

  /**
   * Measure render time for a function
   */
  measureRender<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const elapsed = performance.now() - start;
      this.renderTimes.push(elapsed);
      this.renderCount++;
      
      // Keep only last 100 renders
      if (this.renderTimes.length > 100) {
        this.renderTimes.shift();
      }
      
      // Log slow renders (> 16ms)
      if (elapsed > 16) {
        logger.warn(`[Performance] Slow render detected in ${name}: ${elapsed.toFixed(2)}ms`);
      }
    }
  }

  /**
   * Get render metrics
   */
  getRenderMetrics(): RenderMetrics {
    const avgRenderTime = this.renderTimes.length > 0
      ? this.renderTimes.reduce((sum, t) => sum + t, 0) / this.renderTimes.length
      : 0;
    
    return {
      renderCount: this.renderCount,
      avgRenderTime: Math.round(avgRenderTime * 100) / 100,
      maxRenderTime: Math.max(...this.renderTimes, 0),
      totalRenderTime: this.renderTimes.reduce((sum, t) => sum + t, 0),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.frameTimes = [];
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.droppedFrames = 0;
    this.renderTimes = [];
    this.renderCount = 0;
  }

  /**
   * Log current metrics to console
   */
  logMetrics(): void {
    if (this.frameCount > 0) {
      const fpsMetrics = this.isMonitoring 
        ? this.stopFPSMonitoring() 
        : this.stopFPSMonitoring(); // Get final metrics
      
      logger.group("data-grid-perf", "📊 DataGrid Performance Metrics");
      logger.info(
        "data-grid-perf",
        `FPS: ${fpsMetrics.fps} (avg frame time: ${fpsMetrics.avgFrameTime}ms)`,
      );
      logger.info(
        "data-grid-perf",
        `Frames: ${fpsMetrics.totalFrames} (dropped: ${fpsMetrics.droppedFrames})`,
      );
      logger.info(
        "data-grid-perf",
        `Frame time range: ${fpsMetrics.minFrameTime.toFixed(2)}ms - ${fpsMetrics.maxFrameTime.toFixed(2)}ms`,
      );
      logger.groupEnd();
    }
    
    if (this.renderCount > 0) {
      const renderMetrics = this.getRenderMetrics();
      logger.group("data-grid-perf", "🎨 DataGrid Render Metrics");
      logger.info("data-grid-perf", `Render count: ${renderMetrics.renderCount}`);
      logger.info(
        "data-grid-perf",
        `Avg render time: ${renderMetrics.avgRenderTime}ms`,
      );
      logger.info(
        "data-grid-perf",
        `Max render time: ${renderMetrics.maxRenderTime}ms`,
      );
      logger.info(
        "data-grid-perf",
        `Total render time: ${renderMetrics.totalRenderTime.toFixed(2)}ms`,
      );
      logger.groupEnd();
    }
  }
}

// Global instance for easy access
export const perfMonitor = new PerformanceMonitor();

// Development-only helper to enable monitoring via console
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__dataGridPerf = perfMonitor;
  logger.info('💡 DataGrid Performance Monitor available at window.__dataGridPerf');
  logger.info('   Usage:');
  logger.info('   - __dataGridPerf.startFPSMonitoring() - Start monitoring FPS');
  logger.info('   - __dataGridPerf.stopFPSMonitoring()  - Stop and get metrics');
  logger.info('   - __dataGridPerf.logMetrics()         - Log current metrics');
  logger.info('   - __dataGridPerf.reset()              - Reset all metrics');
}
