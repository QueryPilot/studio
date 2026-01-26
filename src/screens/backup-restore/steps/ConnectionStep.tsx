import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Skeleton } from "@/components/ui/skeleton";
import { vaultStorage } from "@/services/vaultStorage";
import { type StoredConnection } from "@/types/connection";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { IconCheck, IconDatabase } from "@tabler/icons-react";

interface ConnectionStepProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export const ConnectionStep = ({
  selectedId,
  onSelect,
}: ConnectionStepProps) => {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadConnections() {
      try {
        const conns = await vaultStorage.listConnections();
        if (mounted) {
          setConnections(conns);
        }
      } catch (error) {
        if (mounted) {
          logger.error("Failed to load connections:", error);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    loadConnections();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Select Connection</h2>
        <p className="text-muted-foreground">
          Choose which database you want to backup or restore.
        </p>
        <div className="grid gap-3 mt-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-4 rounded-lg border"
            >
              <Skeleton className="h-5 w-5 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Select Connection</h2>
        <p className="text-muted-foreground">
          Choose which database you want to backup or restore.
        </p>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <IconDatabase className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            No connections found
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Create a database connection first to use backup and restore.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Select Connection</h2>
      <p className="text-muted-foreground">
        Choose which database you want to backup or restore.
      </p>

      <div className="grid gap-3 mt-6">
        {connections.map((conn) => {
          const { profile } = conn;
          const isSelected = selectedId === profile.id;

          return (
            <div
              key={profile.id}
              role="button"
              tabIndex={0}
              className={cn(
                "flex items-center gap-3 p-4 rounded-lg border cursor-pointer",
                "transition-all duration-150 outline-none",
                "hover:bg-accent/50",
                "focus:ring-2 focus:ring-primary focus:ring-offset-2",
                isSelected && "ring-2 ring-primary bg-accent/30"
              )}
              onClick={() => onSelect(profile.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(profile.id);
                }
              }}
            >
              <img
                src={getDatabaseLogo(profile.db_type)}
                alt=""
                className="h-5 w-5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{profile.name}</div>
                <div className="text-sm text-muted-foreground truncate">
                  {profile.host}:{profile.port}
                  {profile.database && ` / ${profile.database}`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground uppercase">
                  {profile.db_type}
                </span>
                {isSelected && (
                  <IconCheck className="h-5 w-5 text-primary" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
