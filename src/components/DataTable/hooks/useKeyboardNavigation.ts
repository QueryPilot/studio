/**
 * Hook for keyboard navigation and shortcuts in DataTable
 */
import { useEffect, useCallback } from 'react';

interface UseKeyboardNavigationProps {
  enabled: boolean;
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  onCopy: (format?: 'json' | 'csv' | 'insert') => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onTogglePreview: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useKeyboardNavigation({
  enabled,
  onNavigate,
  onSelectAll,
  onClearSelection,
  onDelete,
  onCopy,
  onStartEdit,
  onCancelEdit,
  onTogglePreview,
  containerRef,
}: UseKeyboardNavigationProps) {
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    
    // Check if the target is an input or textarea (don't handle shortcuts when typing)
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      // Only handle Escape to cancel editing
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelEdit();
      }
      return;
    }
    
    // Navigation keys
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        if (event.shiftKey) {
          // Extend selection up
          // TODO: Implement selection extension
        } else {
          onNavigate('up');
        }
        break;
        
      case 'ArrowDown':
        event.preventDefault();
        if (event.shiftKey) {
          // Extend selection down
          // TODO: Implement selection extension
        } else {
          onNavigate('down');
        }
        break;
        
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) {
          // Extend selection left
          // TODO: Implement selection extension
        } else {
          onNavigate('left');
        }
        break;
        
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) {
          // Extend selection right
          // TODO: Implement selection extension
        } else {
          onNavigate('right');
        }
        break;
        
      case 'Enter':
        event.preventDefault();
        onStartEdit();
        break;
        
      case 'Escape':
        event.preventDefault();
        if (event.shiftKey) {
          onClearSelection();
        } else {
          onCancelEdit();
        }
        break;
        
      case 'Delete':
      case 'Backspace':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onDelete();
        }
        break;
        
      case ' ': // Space
        event.preventDefault();
        // Toggle selection of current row
        // TODO: Implement toggle selection
        break;
        
      case 'a':
      case 'A':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onSelectAll();
        }
        break;
        
      case 'c':
      case 'C':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          if (event.shiftKey) {
            onCopy('csv');
          } else {
            onCopy();
          }
        }
        break;
        
      case 'j':
      case 'J':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onCopy('json');
        }
        break;
        
      case 'i':
      case 'I':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onCopy('insert');
        }
        break;
        
      case 'p':
      case 'P':
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onTogglePreview();
        }
        break;
        
      case 'Tab':
        // Navigate to next/previous cell
        event.preventDefault();
        if (event.shiftKey) {
          onNavigate('left');
        } else {
          onNavigate('right');
        }
        break;
        
      case 'Home':
        event.preventDefault();
        if (event.ctrlKey) {
          // Go to first cell
          // TODO: Implement jump to first cell
        } else {
          // Go to first column in row
          // TODO: Implement jump to first column
        }
        break;
        
      case 'End':
        event.preventDefault();
        if (event.ctrlKey) {
          // Go to last cell
          // TODO: Implement jump to last cell
        } else {
          // Go to last column in row
          // TODO: Implement jump to last column
        }
        break;
        
      case 'PageUp':
        event.preventDefault();
        // Navigate up by page
        // TODO: Implement page navigation
        break;
        
      case 'PageDown':
        event.preventDefault();
        // Navigate down by page
        // TODO: Implement page navigation
        break;
    }
  }, [
    enabled,
    onNavigate,
    onSelectAll,
    onClearSelection,
    onDelete,
    onCopy,
    onStartEdit,
    onCancelEdit,
    onTogglePreview,
  ]);
  
  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    
    const container = containerRef.current;
    
    // Add keyboard event listener to container
    container.addEventListener('keydown', handleKeyDown);
    
    // Make container focusable if it isn't already
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '0');
    }
    
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, containerRef, handleKeyDown]);
  
  // Focus container when enabled
  useEffect(() => {
    if (enabled && containerRef.current) {
      containerRef.current.focus();
    }
  }, [enabled, containerRef]);
}