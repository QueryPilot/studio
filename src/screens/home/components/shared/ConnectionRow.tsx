import { IconStar, IconTrash, IconPencil, IconCopy, IconDatabaseExport, IconLink } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
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
import { buildConnectionUri } from "@/utils/connectionParser";

interface ConnectionRowProps {
  connection: StoredConnection;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  local: { bg: "bg-gray-500/20", text: "text-gray-600 dark:text-gray-400" },
  dev: { bg: "bg-blue-500/20", text: "text-blue-600 dark:text-blue-400" },
  staging: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-600 dark:text-yellow-400",
  },
  uat: { bg: "bg-amber-500/20", text: "text-amber-600 dark:text-amber-400" },
  prod: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400" },
  production: { bg: "bg-red-500/20", text: "text-red-600 dark:text-red-400" },
  test: { bg: "bg-green-500/20", text: "text-green-600 dark:text-green-400" },
};

function getTagColor(tag: string) {
  const lower = tag.toLowerCase();
  return TAG_COLORS[lower] || { bg: "bg-muted", text: "text-muted-foreground" };
}

export function ConnectionRow({
  connection,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: ConnectionRowProps) {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);
  const toggleFavorite = useConnectionStore((s) => s.toggleFavorite);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);

  const { profile, metadata } = connection;

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

  const handleClone = async () => {
    try {
      const saveConnection = useConnectionStore.getState().saveConnection;
      const clonedProfile = {
        ...profile,
        id: crypto.randomUUID(),
        name: `${profile.name} (Copy)`,
      };
      await saveConnection(clonedProfile, metadata.tags);
      toast.success("Connection cloned");
    } catch (error) {
      toast.error("Failed to clone connection", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleBackupRestore = async () => {
    try {
      await windowManager.openBackupRestore(profile.id);
    } catch (error) {
      toast.error("Failed to open backup/restore", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleCopyUri = async () => {
    try {
      const uri = buildConnectionUri(profile);
      await navigator.clipboard.writeText(uri);
      toast.success("URI copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy URI", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(profile.id);
    } else {
      handleConnect();
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            tabIndex={0}
            className={cn(
              "group flex items-center gap-3 px-2 py-2 rounded outline-none",
              "transition-colors duration-100 cursor-pointer",
              "hover:bg-accent/50 focus:bg-accent focus:ring-1 focus:ring-primary",
              selectionMode && isSelected && "ring-2 ring-primary bg-primary/5",
            )}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleClick();
              } else if (e.key === " " && selectionMode) {
                e.preventDefault();
                onToggleSelect?.(profile.id);
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const items = Array.from(
                  document.querySelectorAll("[data-connection-item]"),
                );
                const current = (e.target as HTMLElement).closest(
                  "[data-connection-item]",
                );
                const currentIndex = current ? items.indexOf(current) : -1;
                const nextIndex =
                  e.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;

                if (nextIndex >= 0 && nextIndex < items.length) {
                  (items[nextIndex] as HTMLElement).focus();
                }
              }
            }}
            data-connection-item
            data-connection-id={profile.id}
          >
            {/* Selection checkbox */}
            {selectionMode && (
              <div
                className={cn(
                  "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                  isSelected
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/30"
                )}
              >
                {isSelected && (
                  <svg
                    className="h-3 w-3 text-primary-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
            )}
            {/* DB Icon */}
            <img
              src={getDatabaseLogo(profile.db_type)}
              alt=""
              className="h-5 w-5 shrink-0"
            />

            {/* Name + Host */}
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium truncate">{profile.name}</span>
                {metadata.is_favorite && (
                  <IconStar className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                )}
              </div>
              <span className="text-[11px] text-muted-foreground truncate">
                {profile.host}:{profile.port}
                {profile.database && ` · ${profile.database}`}
              </span>
            </div>

            {/* Tags */}
            {metadata.tags.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                {metadata.tags.map((tag) => {
                  const colors = getTagColor(tag);
                  return (
                    <span
                      key={tag}
                      className={cn(
                        "text-[11px] px-1.5 py-0.5 rounded font-medium",
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        }
      />
      <ContextMenuContent className="w-40">
        <ContextMenuItem onClick={handleEdit} className="text-xs">
          <IconPencil className="h-3 w-3 mr-2" />
          Edit
          <span className="ml-auto text-[10px] text-muted-foreground">E</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleToggleFavorite} className="text-xs">
          <IconStar className="h-3 w-3 mr-2" />
          {metadata.is_favorite ? "Unfavorite" : "Favorite"}
          <span className="ml-auto text-[10px] text-muted-foreground">F</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleClone} className="text-xs">
          <IconCopy className="h-3 w-3 mr-2" />
          Clone
          <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleCopyUri()} className="text-xs">
          <IconLink className="h-3 w-3 mr-2" />
          Copy URI
        </ContextMenuItem>
        <ContextMenuItem onClick={handleBackupRestore} className="text-xs">
          <IconDatabaseExport className="h-3 w-3 mr-2" />
          Backup/Restore...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleDelete}
          className="text-xs text-destructive"
        >
          <IconTrash className="h-3 w-3 mr-2" />
          Delete
          <span className="ml-auto text-[10px] text-muted-foreground/70">
            ⌘⌫
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
