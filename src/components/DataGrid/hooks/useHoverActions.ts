import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Item, Rectangle } from "@glideapps/glide-data-grid";

export interface HoverActionDescriptor {
  id: string;
  label: string;
  /** Optional React element or icon identifier controlled by consumer */
  icon?: ReactNode;
  onTrigger?: (cell: Item) => void;
  shortcut?: string;
  disabled?: boolean;
}

export interface HoverOverlayPosition {
  top: number;
  left: number;
  side: "left" | "right";
}

export interface HoverOverlayState {
  cell: Item;
  bounds: Rectangle;
  actions: HoverActionDescriptor[];
  position: HoverOverlayPosition;
}

export interface UseHoverActionsOptions {
  /**
   * Container reference used to translate grid-space coordinates to viewport-space positions.
   * If omitted, viewport calculations fall back to the window dimensions.
   */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Pixel offsets contributed by pinned columns/rows. */
  pinnedOffsets?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  /** Delay (ms) before showing hover actions after the pointer settles. */
  showDelay?: number;
  /** Delay (ms) before hiding hover actions after pointer leave. */
  hideDelay?: number;
  /** Default alignment when heuristics cannot determine a side. */
  defaultSide?: "left" | "right";
}

export interface UseHoverActionsResult {
  hoverState: HoverOverlayState | null;
  showHover: (
    cell: Item,
    bounds: Rectangle,
    actions: HoverActionDescriptor[],
    overrides?: Partial<HoverOverlayPosition>,
  ) => void;
  hideHover: (immediate?: boolean) => void;
  triggerAction: (actionId: string) => void;
}

const DEFAULT_SHOW_DELAY = 80;
const DEFAULT_HIDE_DELAY = 120;

export function useHoverActions(
  options: UseHoverActionsOptions = {},
): UseHoverActionsResult {
  const {
    containerRef,
    pinnedOffsets,
    showDelay = DEFAULT_SHOW_DELAY,
    hideDelay = DEFAULT_HIDE_DELAY,
    defaultSide = "right",
  } = options;

  const [hoverState, setHoverState] = useState<HoverOverlayState | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const resolveContainerMetrics = useCallback(() => {
    const containerRect = containerRef?.current?.getBoundingClientRect() ?? null;
    const viewportWidth = containerRect?.width ?? window.innerWidth;
    const viewportHeight = containerRect?.height ?? window.innerHeight;
    const originLeft = containerRect?.left ?? 0;
    const originTop = containerRect?.top ?? 0;

    const leftInset = pinnedOffsets?.left ?? 0;
    const rightInset = pinnedOffsets?.right ?? 0;
    const topInset = pinnedOffsets?.top ?? 0;
    const bottomInset = pinnedOffsets?.bottom ?? 0;

    return {
      originLeft,
      originTop,
      viewportWidth,
      viewportHeight,
      leftInset,
      rightInset,
      topInset,
      bottomInset,
    };
  }, [containerRef, pinnedOffsets?.left, pinnedOffsets?.right, pinnedOffsets?.top, pinnedOffsets?.bottom]);

  const computePosition = useCallback(
    (
      bounds: Rectangle,
      overrides?: Partial<HoverOverlayPosition>,
    ): HoverOverlayPosition => {
      const metrics = resolveContainerMetrics();
      const rawLeft = metrics.originLeft + bounds.x;
      const rawRight = rawLeft + bounds.width;

      const leftBoundary = metrics.originLeft + metrics.leftInset;
      const rightBoundary =
        metrics.originLeft + metrics.viewportWidth - metrics.rightInset;

      const constrainedLeft = Math.max(rawLeft, leftBoundary);
      const constrainedRight = Math.min(rawRight, rightBoundary);
      const effectiveLeft = Math.min(constrainedLeft, constrainedRight - bounds.width);
      const effectiveRight = effectiveLeft + bounds.width;

      const cellMidpoint = effectiveLeft + bounds.width / 2;
      const viewportMidpoint = metrics.originLeft + metrics.viewportWidth / 2;

      const resolvedSide = overrides?.side ??
        (cellMidpoint >= viewportMidpoint ? "left" : "right");

      const verticalOrigin = metrics.originTop + bounds.y;
      const pinnedTop = metrics.originTop + metrics.topInset;
      const pinnedBottom =
        metrics.originTop + metrics.viewportHeight - metrics.bottomInset;

      const clampedVertical = Math.min(
        Math.max(verticalOrigin, pinnedTop),
        pinnedBottom - bounds.height,
      );

      const baseTop = clampedVertical + bounds.height / 2;
      const offset = 8;

      const positionLeft =
        resolvedSide === "right"
          ? effectiveRight + offset
          : effectiveLeft - offset;

      return {
        top: baseTop,
        left: positionLeft,
        side: overrides?.side ?? resolvedSide ?? defaultSide,
      };
    },
    [defaultSide, resolveContainerMetrics],
  );

  const showHover = useCallback<UseHoverActionsResult["showHover"]>(
    (cell, bounds, actions, overrides) => {
      if (actions.length === 0) {
        setHoverState(null);
        return;
      }

      clearTimers();

      const schedule = () => {
        const position = computePosition(bounds, overrides);
        setHoverState({
          cell,
          bounds,
          actions,
          position,
        });
      };

      if (showDelay <= 0) {
        schedule();
        return;
      }

      showTimer.current = window.setTimeout(() => {
        if (rafId.current) {
          window.cancelAnimationFrame(rafId.current);
        }
        rafId.current = window.requestAnimationFrame(schedule);
      }, showDelay);
    },
    [clearTimers, computePosition, showDelay],
  );

  const hideHover = useCallback<UseHoverActionsResult["hideHover"]>(
    (immediate = false) => {
      const cancel = () => {
        if (rafId.current !== null) {
          window.cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
        setHoverState(null);
      };

      clearTimers();

      if (immediate || hideDelay <= 0) {
        cancel();
        return;
      }

      hideTimer.current = window.setTimeout(cancel, hideDelay);
    },
    [clearTimers, hideDelay],
  );

  const triggerAction = useCallback<UseHoverActionsResult["triggerAction"]>(
    (actionId) => {
      if (!hoverState) return;
      const action = hoverState.actions.find((a) => a.id === actionId);
      if (!action || action.disabled) return;
      action.onTrigger?.(hoverState.cell);
    },
    [hoverState],
  );

  useEffect(() => () => {
    clearTimers();
    if (rafId.current !== null) {
      window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, [clearTimers]);

  return useMemo(
    () => ({ hoverState, showHover, hideHover, triggerAction }),
    [hoverState, showHover, hideHover, triggerAction],
  );
}
