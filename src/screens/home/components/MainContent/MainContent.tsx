import { useState, useCallback } from 'react';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import { WelcomeSection } from './WelcomeSection';
import { RecentConnections } from './RecentConnections';
import { ConnectionsSection } from './ConnectionsSection';
import { ERDWorkspacesSection } from './ERDWorkspacesSection';
import { ConnectionForm } from './ConnectionForm';
import { SearchBar } from './SearchBar';
import { ConnectionCard } from '../shared/ConnectionCard';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import type { StoredConnection } from '@/types/connection';

export function MainContent() {
  const contentMode = useHomeScreenStore((s) => s.contentMode);
  const connections = useConnectionStore((s) => s.connections);
  const [searchResults, setSearchResults] = useState<StoredConnection[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleResultsChange = useCallback((results: StoredConnection[] | null) => {
    setSearchResults(results);
  }, []);

  const handleSelectedIndexChange = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  if (contentMode === 'form') {
    return (
      <div className="h-full overflow-y-auto">
        <ConnectionForm />
      </div>
    );
  }

  const isSearching = searchResults !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sticky Search Bar */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
        <SearchBar
          onResultsChange={handleResultsChange}
          onSelectedIndexChange={handleSelectedIndexChange}
          selectedIndex={selectedIndex}
        />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Search Results */}
          {isSearching ? (
            <div>
            <div className="text-xs text-muted-foreground mb-3">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {searchResults.map((connection, index) => (
                <div
                  key={connection.profile.id}
                  className={index === selectedIndex ? 'ring-2 ring-amber-500 rounded-lg' : ''}
                >
                  <ConnectionCard
                    connection={connection}
                    variant="compact"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : connections.length === 0 ? (
          <WelcomeSection />
        ) : (
          <>
            {/* Recent Connections */}
            <RecentConnections />

            {/* All Connections grouped by tag */}
            <ConnectionsSection />

            {/* ERD Workspaces */}
            <ERDWorkspacesSection />
          </>
        )}
        </div>
      </div>
    </div>
  );
}
