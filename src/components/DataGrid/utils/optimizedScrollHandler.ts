import { ScrollVelocityTracker } from './scrollVelocityTracker';

/**
 * RAF-based scroll handler with debouncing for 60fps performance
 * Inspired by VSCode's smooth scrolling implementation
 */
export class OptimizedScrollHandler {
  private rafId: number | null = null;
  private idleCallbackId: number | null = null;
  private lastScrollTop = 0;
  private scrollVelocity = new ScrollVelocityTracker();
  private isScrolling = false;
  private scrollEndTimer: NodeJS.Timeout | null = null;
  
  /**
   * Handle scroll event with RAF optimization
   */
  handleScroll = (
    container: HTMLElement,
    callback: (scrollTop: number, overscan: number, isScrolling: boolean) => void
  ): void => {
    // Cancel any pending frame
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    
    // Mark as scrolling
    this.isScrolling = true;
    
    // Clear scroll end timer
    if (this.scrollEndTimer) {
      clearTimeout(this.scrollEndTimer);
    }
    
    // Use RAF for smooth 60fps updates
    this.rafId = requestAnimationFrame(() => {
      const scrollTop = container.scrollTop;
      
      // Update velocity tracker
      this.scrollVelocity.update(scrollTop);
      
      // Get dynamic overscan based on velocity
      const overscan = this.scrollVelocity.getOverscan();
      
      // Execute callback immediately for visible content
      callback(scrollTop, overscan, true);
      
      // Use idle callback for non-critical updates
      if (this.idleCallbackId) {
        cancelIdleCallback(this.idleCallbackId);
      }
      
      // Batch heavy operations in idle time
      this.idleCallbackId = requestIdleCallback(
        () => {
          // Additional processing during idle time
          this.lastScrollTop = scrollTop;
          this.idleCallbackId = null;
        },
        { timeout: 16 } // 60fps budget
      );
      
      // Detect scroll end
      this.scrollEndTimer = setTimeout(() => {
        this.isScrolling = false;
        this.scrollVelocity.reset();
        callback(scrollTop, this.scrollVelocity.getOverscan(), false);
      }, 150);
      
      this.rafId = null;
    });
  };
  
  /**
   * Handle wheel events for smoother scrolling
   */
  handleWheel = (
    event: WheelEvent,
    container: HTMLElement,
    callback: (scrollTop: number, overscan: number) => void
  ): void => {
    // Predict scroll destination
    const predictedScrollTop = container.scrollTop + event.deltaY;
    
    // Pre-emptively update velocity
    this.scrollVelocity.update(predictedScrollTop);
    
    // Get predicted overscan
    const overscan = this.scrollVelocity.getOverscan();
    
    // Notify callback for pre-loading
    callback(predictedScrollTop, overscan);
  };
  
  /**
   * Get current scroll velocity
   */
  getVelocity(): number {
    return this.scrollVelocity.getVelocity();
  }
  
  /**
   * Get current scroll direction
   */
  getDirection(): 'up' | 'down' | 'none' {
    return this.scrollVelocity.getDirection();
  }
  
  /**
   * Check if currently scrolling
   */
  getIsScrolling(): boolean {
    return this.isScrolling;
  }
  
  /**
   * Get last scroll position
   */
  getLastScrollTop(): number {
    return this.lastScrollTop;
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    
    if (this.idleCallbackId) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
    
    if (this.scrollEndTimer) {
      clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = null;
    }
    
    this.scrollVelocity.reset();
  }
}

/**
 * Hook for using optimized scroll handler
 */
import { useRef, useEffect, useCallback } from 'react';

export function useOptimizedScroll(
  containerRef: React.RefObject<HTMLElement>,
  onScroll: (scrollTop: number, overscan: number, isScrolling: boolean) => void
) {
  const scrollHandler = useRef(new OptimizedScrollHandler());
  
  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      scrollHandler.current.handleScroll(containerRef.current, onScroll);
    }
  }, [containerRef, onScroll]);
  
  const handleWheel = useCallback((event: WheelEvent) => {
    if (containerRef.current) {
      scrollHandler.current.handleWheel(
        event,
        containerRef.current,
        (scrollTop, overscan) => { onScroll(scrollTop, overscan, true); }
      );
    }
  }, [containerRef, onScroll]);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // Add passive listeners for better performance
    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel as any, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel as any);
      scrollHandler.current.destroy();
    };
  }, [handleScroll, handleWheel, containerRef]);
  
  return scrollHandler.current;
}