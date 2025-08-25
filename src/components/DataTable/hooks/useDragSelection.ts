/**
 * Hook for handling drag selection in DataTable
 */
import { useState, useCallback, useEffect, useRef } from 'react';

interface UseDragSelectionProps {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  onSelectionStart: (elementId: string, isCell: boolean) => void;
  onSelectionUpdate: (elementId: string) => void;
  onSelectionEnd: () => void;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startElement: HTMLElement | null;
}

export function useDragSelection({
  enabled,
  containerRef,
  onSelectionStart,
  onSelectionUpdate,
  onSelectionEnd,
}: UseDragSelectionProps) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startElement: null,
  });
  
  const dragTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMouseDownRef = useRef(false);
  
  // Get element ID from data attributes
  const getElementId = useCallback((element: HTMLElement): string => {
    return element.dataset.rowId || element.dataset.cellId || '';
  }, []);
  
  // Check if element is a cell or row
  const isCell = useCallback((element: HTMLElement): boolean => {
    return !!element.dataset.cellId;
  }, []);
  
  // Find the selectable element from a target
  const findSelectableElement = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!target) return null;
    
    let element = target as HTMLElement;
    
    // Traverse up to find a selectable element (with data-row-id or data-cell-id)
    while (element && element !== containerRef.current) {
      if (element.dataset?.rowId || element.dataset?.cellId) {
        return element;
      }
      element = element.parentElement as HTMLElement;
    }
    
    return null;
  }, [containerRef]);
  
  // Handle mouse down
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!enabled || event.button !== 0) return; // Only left click
    
    const selectableElement = findSelectableElement(event.target);
    if (!selectableElement) return;
    
    const elementId = getElementId(selectableElement);
    if (!elementId) return;
    
    // Don't start drag if clicking on interactive elements
    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    isMouseDownRef.current = true;
    
    // Set a small delay before starting drag to distinguish from click
    dragTimeoutRef.current = setTimeout(() => {
      if (isMouseDownRef.current) {
        setDragState({
          isDragging: true,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
          startElement: selectableElement,
        });
        
        onSelectionStart(elementId, isCell(selectableElement));
        
        // Prevent text selection during drag
        event.preventDefault();
        document.body.style.userSelect = 'none';
      }
    }, 100); // 100ms delay to start drag
  }, [enabled, findSelectableElement, getElementId, isCell, onSelectionStart]);
  
  // Handle mouse move
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!dragState.isDragging) return;
    
    setDragState(prev => ({
      ...prev,
      currentX: event.clientX,
      currentY: event.clientY,
    }));
    
    // Find element under cursor
    const elementUnderCursor = document.elementFromPoint(event.clientX, event.clientY);
    const selectableElement = findSelectableElement(elementUnderCursor);
    
    if (selectableElement) {
      const elementId = getElementId(selectableElement);
      if (elementId) {
        onSelectionUpdate(elementId);
      }
    }
  }, [dragState.isDragging, findSelectableElement, getElementId, onSelectionUpdate]);
  
  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    isMouseDownRef.current = false;
    
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }
    
    if (dragState.isDragging) {
      setDragState({
        isDragging: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        startElement: null,
      });
      
      onSelectionEnd();
      
      // Re-enable text selection
      document.body.style.userSelect = '';
    }
  }, [dragState.isDragging, onSelectionEnd]);
  
  // Add event listeners
  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    
    const container = containerRef.current;
    
    // Add mousedown listener to container
    container.addEventListener('mousedown', handleMouseDown);
    
    // Add global listeners for move and up (to handle dragging outside container)
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Handle mouse leave to cancel drag
    const handleMouseLeave = () => {
      if (dragState.isDragging) {
        handleMouseUp();
      }
    };
    
    document.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseLeave);
      
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, [enabled, containerRef, handleMouseDown, handleMouseMove, handleMouseUp, dragState.isDragging]);
  
  // Calculate selection box for visual feedback
  const selectionBox = dragState.isDragging ? {
    left: Math.min(dragState.startX, dragState.currentX),
    top: Math.min(dragState.startY, dragState.currentY),
    width: Math.abs(dragState.currentX - dragState.startX),
    height: Math.abs(dragState.currentY - dragState.startY),
  } : null;
  
  return {
    isDragging: dragState.isDragging,
    selectionBox,
  };
}