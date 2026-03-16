import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useMemo,
  useState,
  useLayoutEffect,
  useEffect,
} from "react";
import { createPortal } from "react-dom";

interface PanelRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PanelPortalContextValue {
  /** Register a container element for a panel */
  registerContainer: (panelId: string, element: HTMLElement | null) => void;
  /** Get the rect for a panel container */
  getPanelRect: (panelId: string) => PanelRect | null;
  /** Subscribe to rect changes for a panel */
  subscribeToRect: (panelId: string, callback: () => void) => () => void;
  /** Get the root container element */
  getRootContainer: () => HTMLElement | null;
}

const PanelPortalContext = createContext<PanelPortalContextValue | null>(null);

export function PanelPortalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const containersRef = useRef<Map<string, HTMLElement | null>>(new Map());
  const rectsRef = useRef<Map<string, PanelRect>>(new Map());
  const subscribersRef = useRef<Map<string, Set<() => void>>>(new Map());
  const observersRef = useRef<Map<string, ResizeObserver>>(new Map());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [, setRootReady] = useState(false);

  const notifySubscribers = useCallback((panelId: string) => {
    const subs = subscribersRef.current.get(panelId);
    if (subs) {
      subs.forEach((cb) => {
        cb();
      });
    }
  }, []);

  const updateRect = useCallback(
    (panelId: string, element: HTMLElement | null) => {
      if (!element || !rootRef.current) {
        rectsRef.current.delete(panelId);
        notifySubscribers(panelId);
        return;
      }

      const rootRect = rootRef.current.getBoundingClientRect();
      const elemRect = element.getBoundingClientRect();

      const newRect: PanelRect = {
        top: elemRect.top - rootRect.top,
        left: elemRect.left - rootRect.left,
        width: elemRect.width,
        height: elemRect.height,
      };

      const current = rectsRef.current.get(panelId);
      if (
        !current ||
        current.top !== newRect.top ||
        current.left !== newRect.left ||
        current.width !== newRect.width ||
        current.height !== newRect.height
      ) {
        rectsRef.current.set(panelId, newRect);
        notifySubscribers(panelId);
      }
    },
    [notifySubscribers],
  );

  const registerContainer = useCallback(
    (panelId: string, element: HTMLElement | null) => {
      // Clean up old observer if exists
      const oldObserver = observersRef.current.get(panelId);
      if (oldObserver) {
        oldObserver.disconnect();
        observersRef.current.delete(panelId);
      }

      containersRef.current.set(panelId, element);
      updateRect(panelId, element);

      // Set up ResizeObserver to track size changes for this container.
      // RAF-batched to avoid layout thrashing during panel resize drag.
      if (element) {
        let resizeRaf: number | null = null;
        const observer = new ResizeObserver(() => {
          if (resizeRaf === null) {
            resizeRaf = requestAnimationFrame(() => {
              resizeRaf = null;
              updateRect(panelId, element);
            });
          }
        });
        observer.observe(element);
        observersRef.current.set(panelId, observer);
      }
    },
    [updateRect],
  );

  const getPanelRect = useCallback((panelId: string) => {
    return rectsRef.current.get(panelId) ?? null;
  }, []);

  const subscribeToRect = useCallback(
    (panelId: string, callback: () => void) => {
      if (!subscribersRef.current.has(panelId)) {
        subscribersRef.current.set(panelId, new Set());
      }
      subscribersRef.current.get(panelId)!.add(callback);
      return () => {
        subscribersRef.current.get(panelId)?.delete(callback);
      };
    },
    [],
  );

  const getRootContainer = useCallback(() => {
    return rootRef.current;
  }, []);

  // Trigger re-render after root is mounted so portals can access it
  useLayoutEffect(() => {
    if (rootRef.current) {
      setRootReady(true);
    }
  }, []);

  // Update all rects on window resize
  useEffect(() => {
    const updateAllRects = () => {
      containersRef.current.forEach((element, panelId) => {
        updateRect(panelId, element);
      });
    };

    const handleResize = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(updateAllRects);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      // Clean up all container observers
      observersRef.current.forEach((observer) => {
        observer.disconnect();
      });
      observersRef.current.clear();
    };
  }, [updateRect]);

  // Memoize context value to prevent unnecessary re-renders of all consumers
  const contextValue = useMemo(
    () => ({
      registerContainer,
      getPanelRect,
      subscribeToRect,
      getRootContainer,
    }),
    [registerContainer, getPanelRect, subscribeToRect, getRootContainer],
  );

  return (
    <PanelPortalContext.Provider value={contextValue}>
      <div ref={rootRef} className="relative h-full w-full">
        {children}
      </div>
    </PanelPortalContext.Provider>
  );
}

export function usePanelPortal() {
  const context = useContext(PanelPortalContext);
  if (!context) {
    throw new Error("usePanelPortal must be used within PanelPortalProvider");
  }
  return context;
}

/**
 * Component that registers a container for a panel.
 * Place this where you want the panel to appear in the layout.
 * The actual Panel renders elsewhere but is positioned to overlay this container.
 */
export function PanelContainer({
  panelId,
  className,
}: {
  panelId: string;
  className?: string;
}) {
  const { registerContainer } = usePanelPortal();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    registerContainer(panelId, ref.current);
    return () => {
      registerContainer(panelId, null);
    };
  }, [panelId, registerContainer]);

  return <div ref={ref} className={className} data-panel-container={panelId} />;
}

/**
 * Renders children positioned absolutely to match the registered container for a panel.
 * Children are rendered into a stable portal target (the root container) to preserve React state.
 */
export function PanelPortal({
  panelId,
  children,
}: {
  panelId: string;
  children: React.ReactNode;
}) {
  const { getPanelRect, subscribeToRect, getRootContainer } = usePanelPortal();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Use React state ONLY for the initial rect resolution (null → valid rect).
  // Once we have a rect, all subsequent updates go through imperative DOM writes
  // to avoid React re-renders during resize drag (#R1 fix).
  const [rect, setRect] = useState<PanelRect | null>(() =>
    getPanelRect(panelId),
  );
  const hasInitialRect = useRef(rect !== null);

  useLayoutEffect(() => {
    // If we don't have an initial rect yet, get it now (container may have registered)
    if (!hasInitialRect.current) {
      const r = getPanelRect(panelId);
      if (r) {
        hasInitialRect.current = true;
        setRect(r);
      }
    }

    // Subscribe to updates
    return subscribeToRect(panelId, () => {
      const newRect = getPanelRect(panelId);
      const wrapper = wrapperRef.current;

      if (!hasInitialRect.current) {
        // First rect — use React setState so the component renders with valid dimensions
        if (newRect) {
          hasInitialRect.current = true;
          setRect(newRect);
        }
        return;
      }

      // Subsequent updates — imperative DOM writes, zero React re-renders
      if (!wrapper) return;
      if (newRect) {
        wrapper.style.top = `${newRect.top}px`;
        wrapper.style.left = `${newRect.left}px`;
        wrapper.style.width = `${newRect.width}px`;
        wrapper.style.height = `${newRect.height}px`;
        wrapper.style.visibility = "visible";
      } else {
        wrapper.style.visibility = "hidden";
      }
    });
  }, [panelId, getPanelRect, subscribeToRect]);

  const rootContainer = getRootContainer();
  if (!rootContainer) {
    return null;
  }

  // Always render into the same root container (stable portal target)
  // Position absolutely to match the PanelContainer location
  return createPortal(
    <div
      ref={wrapperRef}
      style={{
        position: "absolute",
        top: rect?.top ?? 0,
        left: rect?.left ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        visibility: rect ? "visible" : "hidden",
        overflow: "hidden",
      }}
      data-panel-portal={panelId}
    >
      {children}
    </div>,
    rootContainer,
  );
}
