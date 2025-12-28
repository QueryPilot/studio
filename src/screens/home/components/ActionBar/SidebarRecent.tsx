import { useState } from "react";
import {
  IconClock,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";

export function SidebarRecent() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const getRecentConnections = useConnectionStore(
    (s) => s.getRecentConnections,
  );

  const recentConnections = getRecentConnections(4);

  if (recentConnections.length === 0) {
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
        <IconClock className="h-3 w-3" />
        <span>Recent</span>
      </button>

      {!isCollapsed && (
        <div className="mt-1 space-y-0.5">
          {recentConnections.map((conn) => (
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
              <span className="truncate flex-1 text-left">
                {conn.profile.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
