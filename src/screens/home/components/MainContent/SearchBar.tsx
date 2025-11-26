import { logger } from "@/lib/logger";
import { useState, useMemo, useRef, useEffect } from 'react';
import Fuse from 'fuse.js';
import { IconSearch } from '@tabler/icons-react';
import { Input } from '@/components/ui/input';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import type { StoredConnection } from '@/types/connection';

interface SearchBarProps {
  onResultsChange: (results: StoredConnection[] | null) => void;
  onSelectedIndexChange: (index: number) => void;
  selectedIndex: number;
}

export function SearchBar({
  onResultsChange,
  onSelectedIndexChange,
  selectedIndex,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const connections = useConnectionStore((s) => s.connections);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);

  // Create Fuse instance for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(connections, {
      keys: [
        { name: 'profile.name', weight: 2 },
        { name: 'profile.host', weight: 1 },
        { name: 'profile.database', weight: 1 },
        { name: 'metadata.tags', weight: 0.5 },
      ],
      threshold: 0.4,
      includeScore: true,
    });
  }, [connections]);

  // Perform search
  const searchResults = useMemo(() => {
    if (!query.trim()) {
      return null;
    }
    const results = fuse.search(query);
    return results.map((r) => r.item);
  }, [fuse, query]);

  // Update parent with results
  useEffect(() => {
    onResultsChange(searchResults);
    setSearchQuery(query);
    // Reset selection when results change
    if (searchResults && searchResults.length > 0) {
      onSelectedIndexChange(0);
    }
  }, [searchResults, onResultsChange, setSearchQuery, onSelectedIndexChange, query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!searchResults || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        onSelectedIndexChange(
          selectedIndex < searchResults.length - 1 ? selectedIndex + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        onSelectedIndexChange(
          selectedIndex > 0 ? selectedIndex - 1 : searchResults.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults[selectedIndex]) {
          // TODO: Connect to selected connection
          logger.info('Connect to', searchResults[selectedIndex].profile.id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setQuery('');
        onResultsChange(null);
        break;
    }
  };

  // Global keyboard shortcut for search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <div className="relative">
      <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search connections... (⌘K)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="pl-9 h-8 text-xs"
      />
    </div>
  );
}
