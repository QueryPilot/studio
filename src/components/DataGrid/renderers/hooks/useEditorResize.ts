import { useEffect, useRef, type RefObject } from "react";

interface UseEditorResizeOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

/**
 * Handles editor overlay resizing via direct DOM manipulation to avoid
 * React re-renders on every mousemove frame.
 */
export function useEditorResize({
  containerRef,
  minWidth = 400,
  maxWidth = 800,
  minHeight = 300,
  maxHeight = 600,
}: UseEditorResizeOptions) {
  const rafId = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("resize-handle")) return;
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = container.offsetWidth;
      startHeight = container.offsetHeight;
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (e.clientX - startX)));
        const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + (e.clientY - startY)));
        container.style.width = `${newWidth}px`;
        container.style.height = `${newHeight}px`;
      });
    };

    const handleMouseUp = () => {
      isResizing = false;
    };

    container.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      cancelAnimationFrame(rafId.current);
      container.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef, minWidth, maxWidth, minHeight, maxHeight]);
}
