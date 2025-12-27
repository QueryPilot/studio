import { useMemo, useState } from 'react';
import {
  IconDatabase,
  IconLayoutGrid,
  IconList,
} from '@tabler/icons-react';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import { ConnectionCard } from '../shared/ConnectionCard';
import { ConnectionRow } from '../shared/ConnectionRow';

const CARDS_COUNT = 6;

type ViewMode = 'hybrid' | 'grid' | 'list';

export function ConnectionsSection() {
  const connections = useConnectionStore((s) => s.connections);
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);

  const [viewMode, setViewMode] = useState<ViewMode>('hybrid');

  // Filter connections by active env filters
  const filteredConnections = useMemo(() => {
    if (
      !activeEnvFilters ||
      activeEnvFilters.length === 0 ||
      activeEnvFilters.includes('all')
    ) {
      return connections;
    }

    return connections.filter((conn) => {
      const tags = conn.metadata?.tags ?? [];
      return tags.some((tag) => activeEnvFilters.includes(tag));
    });
  }, [connections, activeEnvFilters]);

  // Sort connections: favorites first, then by last used
  const sortedConnections = useMemo(() => {
    return [...filteredConnections].sort((a, b) => {
      if (a.metadata.is_favorite && !b.metadata.is_favorite) return -1;
      if (!a.metadata.is_favorite && b.metadata.is_favorite) return 1;

      const aTime = a.metadata.last_used
        ? new Date(a.metadata.last_used).getTime()
        : 0;
      const bTime = b.metadata.last_used
        ? new Date(b.metadata.last_used).getTime()
        : 0;
      return bTime - aTime;
    });
  }, [filteredConnections]);

  // Split connections for hybrid view
  const { cardConnections, listConnections } = useMemo(() => {
    if (viewMode === 'grid') {
      return { cardConnections: sortedConnections, listConnections: [] };
    }
    if (viewMode === 'list') {
      return { cardConnections: [], listConnections: sortedConnections };
    }
    return {
      cardConnections: sortedConnections.slice(0, CARDS_COUNT),
      listConnections: sortedConnections.slice(CARDS_COUNT),
    };
  }, [sortedConnections, viewMode]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconDatabase className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Connections</h2>
          <span className="text-xs text-muted-foreground">
            ({filteredConnections.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 rounded-r-none ${viewMode === 'grid' ? 'bg-muted' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <IconLayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 rounded-l-none ${viewMode === 'list' ? 'bg-muted' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <IconList className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="flex items-center gap-3 mb-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> connect
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>⌘D</Kbd> clone
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd> search
        </span>
      </div>

      {/* Empty state */}
      {filteredConnections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No connections match the selected filter
        </div>
      ) : (
        <div className="space-y-6">
          {/* Cards Section */}
          {cardConnections.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {cardConnections.map((connection) => (
                <ConnectionCard
                  key={connection.profile.id}
                  connection={connection}
                  variant="compact"
                />
              ))}
            </div>
          )}

          {/* List Section */}
          {listConnections.length > 0 && (
            <div>
              {viewMode === 'hybrid' && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px bg-border flex-1" />
                  <span className="text-xs text-muted-foreground px-2">
                    More connections ({listConnections.length})
                  </span>
                  <div className="h-px bg-border flex-1" />
                </div>
              )}
              <div className="space-y-0.5">
                {listConnections.map((connection) => (
                  <ConnectionRow
                    key={connection.profile.id}
                    connection={connection}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
