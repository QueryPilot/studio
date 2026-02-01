import { useMemo } from "react";
import { IconDatabase, IconLayout2 } from "@tabler/icons-react";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { DbType } from "@/types/connection";

interface StatItemProps {
  icon: React.ReactNode;
  value: number;
  label: string;
}

function StatItem({ icon, value, label }: StatItemProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
      {icon}
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

interface DbStatProps {
  dbType: DbType;
  count: number;
}

function DbStat({ dbType, count }: DbStatProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
      <img src={getDatabaseLogo(dbType)} alt="" className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">{count}</span>
    </div>
  );
}

export function StatsHeader() {
  const connections = useConnectionStore((s) => s.connections);
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);

  const stats = useMemo(() => {
    const byType: Record<DbType, number> = {
      [DbType.PostgreSQL]: 0,
      [DbType.MySQL]: 0,
      [DbType.MariaDB]: 0,
      [DbType.SQLite]: 0,
      [DbType.SQLServer]: 0,
      [DbType.MongoDB]: 0,
      [DbType.Redis]: 0,
    };

    for (const conn of connections) {
      byType[conn.profile.db_type]++;
    }

    return {
      total: connections.length,
      workspaces: savedWorkspaces.length,
      byType,
    };
  }, [connections, savedWorkspaces]);

  // Sort database types by count (descending)
  const sortedDbTypes = useMemo(() => {
    return Object.entries(stats.byType)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([dbType]) => dbType as DbType);
  }, [stats.byType]);

  if (stats.total === 0) return null;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Total connections */}
      <StatItem
        icon={<IconDatabase className="h-4 w-4 text-muted-foreground" />}
        value={stats.total}
        label={stats.total === 1 ? "Connection" : "Connections"}
      />

      {/* Total workspaces */}
      {stats.workspaces > 0 && (
        <StatItem
          icon={<IconLayout2 className="h-4 w-4 text-muted-foreground" />}
          value={stats.workspaces}
          label={stats.workspaces === 1 ? "Workspace" : "Workspaces"}
        />
      )}

      {/* Divider */}
      {sortedDbTypes.length > 0 && (
        <div className="h-4 w-px bg-border" />
      )}

      {/* By database type */}
      <div className="flex items-center gap-1.5">
        {sortedDbTypes.map((dbType) => (
          <DbStat
            key={dbType}
            dbType={dbType}
            count={stats.byType[dbType]}
          />
        ))}
      </div>
    </div>
  );
}
