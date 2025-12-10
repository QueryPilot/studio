import { useMemo } from "react";
import {
  IconDotsVertical,
  IconStar,
  IconTrash,
  IconPencil,
  IconCopy,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { type StoredConnection } from "@/types/connection";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";

interface ConnectionCardProps {
  connection: StoredConnection;
  variant?: "compact" | "list";
}

const ENV_COLORS: Record<string, { bg: string; text: string }> = {
  local: { bg: "bg-gray-500", text: "text-gray-50" },
  dev: { bg: "bg-blue-500", text: "text-blue-50" },
  staging: { bg: "bg-yellow-700", text: "text-yellow-50" },
  uat: { bg: "bg-amber-700", text: "text-amber-50" },
  prod: { bg: "bg-red-500", text: "text-red-50" },
  test: { bg: "bg-green-500", text: "text-green-50" },
};

const ENV_TAGS = ["local", "dev", "staging", "uat", "prod", "test"];

export function ConnectionCard({
  connection,
  variant = "list",
}: ConnectionCardProps) {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);
  const toggleFavorite = useConnectionStore((s) => s.toggleFavorite);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);

  const { profile, metadata } = connection;

  const envTag = useMemo(() => {
    return metadata.tags.find((tag) => ENV_TAGS.includes(tag));
  }, [metadata.tags]);

  const envColor = envTag ? ENV_COLORS[envTag] : null;

  const lastUsedText = useMemo(() => {
    if (!metadata.last_used) return "Never used";
    const date = new Date(metadata.last_used);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }, [metadata.last_used]);

  const handleConnect = async () => {
    try {
      await windowManager.openWorkspace(profile.id, profile.name, {
        database: profile.database,
      });
    } catch (error) {
      toast.error("Failed to open workspace", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleEdit = () => {
    openConnectionForm("edit", profile.id);
  };

  const handleToggleFavorite = async () => {
    try {
      await toggleFavorite(profile.id);
    } catch (error) {
      toast.error("Failed to toggle favorite", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteConnection(profile.id);
      toast.success("Connection deleted");
    } catch (error) {
      toast.error("Failed to delete connection", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (variant === "compact") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "rounded-lg border border-border bg-card p-3",
              "hover:border-amber-500/50 transition-colors cursor-pointer",
            )}
            onClick={handleConnect}
            onDoubleClick={handleConnect}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <img
                src={getDatabaseLogo(profile.db_type)}
                alt=""
                className="h-4 w-4"
              />
              <span className="text-xs font-medium truncate flex-1">
                {profile.name}
              </span>
              {metadata.is_favorite && (
                <IconStar className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
              )}
              {envTag && envColor && (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
                    envColor.bg,
                    envColor.text,
                  )}
                >
                  {envTag}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="truncate">
                {profile.host}:{profile.port}
              </span>
              <span className="flex-shrink-0 ml-2">{lastUsedText}</span>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onClick={handleEdit} className="text-xs">
            <IconPencil className="h-3 w-3 mr-2" />
            Edit
          </ContextMenuItem>
          <ContextMenuItem onClick={handleToggleFavorite} className="text-xs">
            <IconStar className="h-3 w-3 mr-2" />
            {metadata.is_favorite ? "Unfavorite" : "Favorite"}
          </ContextMenuItem>
          <ContextMenuItem className="text-xs">
            <IconCopy className="h-3 w-3 mr-2" />
            Clone
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={handleDelete}
            className="text-xs text-destructive"
          >
            <IconTrash className="h-3 w-3 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border border-border bg-card p-3",
            "hover:border-amber-500/50 transition-colors cursor-pointer group",
          )}
          onClick={handleConnect}
          onDoubleClick={handleConnect}
        >
          <img
            src={getDatabaseLogo(profile.db_type)}
            alt=""
            className="h-5 w-5 flex-shrink-0"
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium truncate">
                {profile.name}
              </span>
              {metadata.is_favorite && (
                <IconStar className="h-3 w-3 text-amber-500 fill-amber-500 flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground truncate">
                {profile.host}:{profile.port}
              </span>
              {profile.database && (
                <>
                  <span className="text-[10px] text-muted-foreground">/</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {profile.database}
                  </span>
                </>
              )}
            </div>
          </div>

          {envTag && envColor && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
                envColor.bg,
                envColor.text,
              )}
            >
              {envTag}
            </span>
          )}

          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {lastUsedText}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <IconDotsVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={handleEdit} className="text-xs">
                <IconPencil className="h-3 w-3 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleToggleFavorite}
                className="text-xs"
              >
                <IconStar className="h-3 w-3 mr-2" />
                {metadata.is_favorite ? "Unfavorite" : "Favorite"}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs">
                <IconCopy className="h-3 w-3 mr-2" />
                Clone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-xs text-destructive"
              >
                <IconTrash className="h-3 w-3 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onClick={handleEdit} className="text-xs">
          <IconPencil className="h-3 w-3 mr-2" />
          Edit
        </ContextMenuItem>
        <ContextMenuItem onClick={handleToggleFavorite} className="text-xs">
          <IconStar className="h-3 w-3 mr-2" />
          {metadata.is_favorite ? "Unfavorite" : "Favorite"}
        </ContextMenuItem>
        <ContextMenuItem className="text-xs">
          <IconCopy className="h-3 w-3 mr-2" />
          Clone
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleDelete}
          className="text-xs text-destructive"
        >
          <IconTrash className="h-3 w-3 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
