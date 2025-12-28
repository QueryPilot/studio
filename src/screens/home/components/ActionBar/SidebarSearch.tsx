import { useRef, useEffect } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Kbd } from '@/components/ui/kbd';
import { useHomeScreenStore } from '../../store/homeScreenStore';

export function SidebarSearch() {
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global "/" shortcut to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isInInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => { window.removeEventListener('keydown', handleGlobalKeyDown); };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      inputRef.current?.blur();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab from search jumps to first connection item
      const firstItem = document.querySelector('[data-connection-item]') as HTMLElement;
      if (firstItem) {
        e.preventDefault();
        firstItem.focus();
      }
    } else if (e.key === 'ArrowDown') {
      // Arrow down also focuses first item
      const firstItem = document.querySelector('[data-connection-item]') as HTMLElement;
      if (firstItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
  };

  return (
    <div className="px-3 py-2">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg',
          'bg-sidebar-accent/50 border border-transparent',
          'transition-all duration-150',
          'focus-within:border-primary/50 focus-within:bg-background'
        )}
      >
        <IconSearch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className={cn(
            'flex-1 bg-transparent text-sm outline-none',
            'placeholder:text-muted-foreground'
          )}
        />
        {!searchQuery && <Kbd>/</Kbd>}
      </div>
    </div>
  );
}
