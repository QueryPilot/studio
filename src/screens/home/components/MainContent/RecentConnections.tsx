import { Clock } from 'lucide-react';
import { useConnectionStore } from '@/stores/connectionStoreNew';
import { ConnectionCard } from '../shared/ConnectionCard';

export function RecentConnections() {
  const getRecentConnections = useConnectionStore((s) => s.getRecentConnections);
  const recentConnections = getRecentConnections(8);

  if (recentConnections.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-xs font-medium text-muted-foreground">
          Recent Connections
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {recentConnections.map((connection) => (
          <ConnectionCard
            key={connection.profile.id}
            connection={connection}
            variant="compact"
          />
        ))}
      </div>
    </div>
  );
}
