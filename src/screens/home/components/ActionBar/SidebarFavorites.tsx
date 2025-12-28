import { useState } from "react";
import {
  IconStar,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";

export function SidebarFavorites() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const connections = useConnectionStore((s) => s.connections);

  const favorites = connections
    .filter((conn) => conn.metadata.is_favorite)
    .slice(0, 5);

  if (favorites.length === 0) {
    return null;
  }

  const handleConnect = async (
    profileId: string,
    name: string,
    database?: string,
  ) => {
    try {
      await windowManager.openWorkspace(profileId, name, { database });
    } catch (error) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        onClick={() => {
          setIsCollapsed(!isCollapsed);
        }}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md",
          "text-xs font-medium text-muted-foreground",
          "hover:text-foreground hover:bg-sidebar-accent/50",
          "transition-colors duration-150",
        )}
      >
        {isCollapsed ? (
          <IconChevronRight className="h-3 w-3" />
        ) : (
          <IconChevronDown className="h-3 w-3" />
        )}
        <IconStar className="h-3 w-3" />
        <span>Favorites</span>
        <span className="ml-auto text-[10px] opacity-60">
          {favorites.length}
        </span>
      </button>

      {!isCollapsed && (
        <div className="mt-1 space-y-0.5">
          {favorites.map((conn) => (
            <button
              key={conn.profile.id}
              type="button"
              onClick={() =>
                handleConnect(
                  conn.profile.id,
                  conn.profile.name,
                  conn.profile.database,
                )
              }
              className={cn(
                "flex items-center gap-2.5 h-8 w-full px-2.5 rounded-lg",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-foreground/6",
                "transition-all duration-150 ease-out",
              )}
            >
              <img
                src={getDatabaseLogo(conn.profile.db_type)}
                alt=""
                className="h-4 w-4 shrink-0"
              />
              <span className="truncate">{conn.profile.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
