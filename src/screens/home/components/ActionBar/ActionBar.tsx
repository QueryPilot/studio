import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import { ActionBarLogo } from './ActionBarLogo';
import { ActionBarActions } from './ActionBarActions';
import { EnvFilter } from './EnvFilter';
import { ActionBarFooter } from './ActionBarFooter';

export function ActionBar() {
  const actionBarExpanded = useHomeScreenStore((s) => s.actionBarExpanded);
  const sidebarWidth = useHomeScreenStore((s) => s.sidebarWidth);
  const setSidebarWidth = useHomeScreenStore((s) => s.setSidebarWidth);
  const resizeRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - startX;
        const newWidth = Math.min(Math.max(startWidth + delta, 160), 320);
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth, setSidebarWidth]
  );

  return (
    <div
      className={cn(
        'h-full flex flex-col border-r border-border bg-background transition-all duration-200 relative',
        !actionBarExpanded && 'w-14'
      )}
      style={actionBarExpanded ? { width: sidebarWidth } : undefined}
    >
      {/* Logo */}
      <ActionBarLogo />

      {/* Divider */}
      <div className="mx-2 border-t border-border" />

      {/* Actions */}
      <ActionBarActions />

      {/* Divider */}
      <div className="mx-2 border-t border-border" />

      {/* Environment Filters */}
      <EnvFilter />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Divider */}
      <div className="mx-2 border-t border-border" />

      {/* Footer */}
      <ActionBarFooter />

      {/* Resize handle */}
      {actionBarExpanded && (
        <div
          ref={resizeRef}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-amber-500/50 transition-colors"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
