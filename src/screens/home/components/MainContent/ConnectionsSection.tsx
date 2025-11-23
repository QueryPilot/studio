import { useMemo } from 'react';
import { Database, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { useHomeScreenStore } from '../../store/homeScreenStore';
import { ConnectionCard } from '../shared/ConnectionCard';
import type { StoredConnection } from '@/types/connection';

const ENV_TAGS = ['local', 'dev', 'staging', 'uat', 'prod', 'test'];

export function ConnectionsSection() {
  const connections = useConnectionStore((s) => s.connections);
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);
  const collapsedGroups = useHomeScreenStore((s) => s.collapsedGroups);
  const toggleGroup = useHomeScreenStore((s) => s.toggleGroup);

  // Filter connections by active env filters
  const filteredConnections = useMemo(() => {
    if (activeEnvFilters.includes('all')) {
      return connections;
    }

    return connections.filter((conn) =>
      conn.metadata.tags.some((tag) => activeEnvFilters.includes(tag))
    );
  }, [connections, activeEnvFilters]);

  // Group connections by custom tags (non-env tags)
  const groupedConnections = useMemo(() => {
    const groups: Record<string, StoredConnection[]> = {};
    const ungrouped: StoredConnection[] = [];

    filteredConnections.forEach((conn) => {
      const customTags = conn.metadata.tags.filter(
        (tag) => !ENV_TAGS.includes(tag)
      );

      if (customTags.length === 0) {
        ungrouped.push(conn);
      } else {
        // Add to first custom tag group
        const groupTag = customTags[0];
        if (!groups[groupTag]) {
          groups[groupTag] = [];
        }
        groups[groupTag].push(conn);
      }
    });

    // Sort groups alphabetically
    const sortedGroups = Object.entries(groups).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    // Add ungrouped at the end if exists
    if (ungrouped.length > 0) {
      sortedGroups.push(['Ungrouped', ungrouped]);
    }

    return sortedGroups;
  }, [filteredConnections]);

  if (filteredConnections.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-xs font-medium text-muted-foreground">
          Connections
        </h2>
        <span className="text-xs text-muted-foreground">
          ({filteredConnections.length})
        </span>
      </div>

      <div className="space-y-3">
        {groupedConnections.map(([groupName, groupConnections]) => {
          const isCollapsed = collapsedGroups.includes(groupName);

          return (
            <div key={groupName}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 h-7 px-2 mb-1"
                onClick={() => toggleGroup(groupName)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                <span className="text-xs font-medium">{groupName}</span>
                <span className="text-xs text-muted-foreground">
                  ({groupConnections.length})
                </span>
              </Button>

              {!isCollapsed && (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pl-5">
                  {groupConnections.map((connection) => (
                    <ConnectionCard
                      key={connection.profile.id}
                      connection={connection}
                      variant="compact"
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
