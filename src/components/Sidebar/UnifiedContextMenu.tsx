/**
 * Unified Context Menu
 *
 * Reusable context menu component for all sidebar adapters.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { IconChevronRight } from '@tabler/icons-react';
import type { MenuItem } from '@/types/sidebar';

interface UnifiedContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function UnifiedContextMenu({
  x,
  y,
  items,
  onClose,
}: UnifiedContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position if menu goes off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      if (rect.bottom > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  if (items.length === 0) return null;

  // Portal to body to escape overflow:hidden containers
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] bg-popover border border-border rounded-md shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          <button
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1 text-xs hover:bg-accent cursor-pointer transition-colors',
              item.destructive && 'text-red-600 dark:text-red-400',
              item.disabled && 'opacity-50 cursor-not-allowed'
            )}
            onClick={() => {
              if (!item.disabled) {
                void item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            <item.icon className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">{item.label}</span>
            <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0" />
          </button>
          {item.separator && index < items.length - 1 && (
            <div className="h-px bg-border my-1" />
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}
