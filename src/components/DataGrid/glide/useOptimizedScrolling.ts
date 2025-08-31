import { useEffect, useRef, useCallback } from 'react';

interface ScrollOptimizationOptions {
  enableVirtualization?: boolean;
  overscan?: number;
  scrollDebounce?: number;
  enableMomentumScrolling?: boolean;
}

export function useOptimizedScrolling(options: ScrollOptimizationOptions = {}) {
  const {
    enableVirtualization = true,
    overscan = 3,
    scrollDebounce = 16, // ~60fps
    enableMomentumScrolling = true,
  } = options;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastScrollTime = useRef<number>(0);
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastPositionRef = useRef({ x: 0, y: 0 });

  // Optimize scroll events with RAF
  const handleScroll = useCallback((callback: (e: Event) => void) => {
    return (e: Event) => {
      const now = performance.now();
      
      // Cancel any pending animation frame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      // Calculate velocity for momentum scrolling
      if (enableMomentumScrolling && scrollRef.current) {
        const currentX = scrollRef.current.scrollLeft;
        const currentY = scrollRef.current.scrollTop;
        const timeDelta = now - lastScrollTime.current;
        
        if (timeDelta > 0) {
          velocityRef.current = {
            x: (currentX - lastPositionRef.current.x) / timeDelta,
            y: (currentY - lastPositionRef.current.y) / timeDelta,
          };
          
          lastPositionRef.current = { x: currentX, y: currentY };
        }
      }

      lastScrollTime.current = now;

      // Debounce with RAF
      if (now - lastScrollTime.current >= scrollDebounce) {
        rafRef.current = requestAnimationFrame(() => {
          callback(e);
        });
      }
    };
  }, [scrollDebounce, enableMomentumScrolling]);

  // Apply CSS optimizations
  useEffect(() => {
    if (scrollRef.current) {
      const element = scrollRef.current;
      
      // Enable GPU acceleration
      element.style.transform = 'translateZ(0)';
      element.style.willChange = 'transform';
      
      // Optimize scrolling behavior
      element.style.scrollBehavior = enableMomentumScrolling ? 'smooth' : 'auto';
      element.style.overscrollBehavior = 'contain';
      
      // Enable passive scrolling for better performance
      const passiveOptions = { passive: true };
      
      const optimizedScrollHandler = handleScroll(() => {
        // Custom scroll logic here if needed
      });
      
      element.addEventListener('scroll', optimizedScrollHandler, passiveOptions);
      
      return () => {
        element.removeEventListener('scroll', optimizedScrollHandler);
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
      };
    }
  }, [handleScroll, enableMomentumScrolling]);

  return {
    scrollRef,
    velocity: velocityRef.current,
    overscan,
    enableVirtualization,
  };
}