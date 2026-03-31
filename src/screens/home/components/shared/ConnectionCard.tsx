import {
  IconDotsVertical,
  IconStar,
  IconTrash,
  IconPencil,
  IconCopy,
  IconLink,
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
import { DbType, type StoredConnection } from "@/types/connection";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { windowManager } from "@/services/windowManager";
import { toast } from "sonner";
import { buildConnectionUri } from "@/utils/connectionParser";

interface ConnectionCardProps {
  connection: StoredConnection;
  variant?: "compact" | "list";
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function ConnectionCard({
  connection,
  variant = "compact",
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: ConnectionCardProps) {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);
  const toggleFavorite = useConnectionStore((s) => s.toggleFavorite);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);

  const { profile, metadata } = connection;
  const isFileBasedConnection =
    profile.db_type === DbType.SQLite || profile.db_type === DbType.DuckDB;
  const isDuckDbScratchpad = profile.db_type === DbType.DuckDB;

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

  const handleCopyUri = async () => {
    try {
      const uri = buildConnectionUri(profile, true);
      await navigator.clipboard.writeText(uri);
      toast.success("URI copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy URI", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const menuItems = (
    <>
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
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={handleDelete}
        className="text-xs text-destructive"
      >
        <IconTrash className="h-3 w-3 mr-2" />
        Delete
        <span className="ml-auto text-[10px] text-muted-foreground/70">⌘⌫</span>
      </ContextMenuItem>
    </>
  );

  const handleClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(profile.id);
    } else {
      handleConnect();
    }
  };

  if (variant === "compact") {
    return (
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              tabIndex={0}
              className={cn(
                "group relative rounded-md border bg-card overflow-hidden",
                "transition-all duration-150 cursor-pointer outline-none",
                "hover:bg-accent/50 focus:bg-accent focus:ring-2 focus:ring-primary/50 active:bg-accent/80 active:scale-[0.97]",
                selectionMode && isSelected && "ring-2 ring-primary bg-primary/5",
              )}
              onClick={handleClick}
              onDoubleClick={selectionMode ? undefined : handleConnect}
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
              <div className="px-3 py-2">
                {/* Header: Icon + Name */}
                <div className="flex items-center gap-2">
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
                  <img
                    src={getDatabaseLogo(profile.db_type)}
                    alt=""
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="text-xs font-medium truncate flex-1">
                    {profile.name}
                  </span>
                  {isDuckDbScratchpad && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                      Scratchpad
                    </span>
                  )}
                  {metadata.is_favorite && (
                    <IconStar className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                  )}
                </div>

                {/* Connection details - single line */}
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {isFileBasedConnection ? (
                    <span className="truncate font-medium text-foreground/60">
                      {profile.database}
                    </span>
                  ) : (
                    <>
                      <span className="truncate">
                        {profile.host}:{profile.port}
                      </span>
                      {profile.database && (
                        <>
                          <span className="text-muted-foreground/50">·</span>
                          <span className="truncate font-medium text-foreground/60">
                            {profile.database}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Bottom row: group tag (hide if it just repeats host:port) */}
                {profile.group && profile.group !== `${profile.host}:${profile.port}` && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {profile.group}
                    </span>
                  </div>
                )}
              </div>
            </div>
          }
        />
        <ContextMenuContent className="w-40">{menuItems}</ContextMenuContent>
      </ContextMenu>
    );
  }

  // List variant
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            tabIndex={0}
            className={cn(
              "group flex items-center gap-3 rounded px-2 py-1.5 cursor-pointer outline-none",
              "transition-colors duration-100",
              "hover:bg-accent/50 focus:bg-accent focus:ring-1 focus:ring-primary",
            )}
            onClick={handleConnect}
            onDoubleClick={handleConnect}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConnect();
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
            <img
              src={getDatabaseLogo(profile.db_type)}
              alt=""
              className="h-4 w-4 shrink-0"
            />

            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-xs font-medium truncate min-w-0">
                {profile.name}
              </span>
              {isDuckDbScratchpad && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  Scratchpad
                </span>
              )}
            </div>

            {metadata.is_favorite && (
              <IconStar className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
            )}

            {profile.group && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                {profile.group}
              </span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <IconDotsVertical className="h-3 w-3" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={handleEdit} className="text-xs">
                  <IconPencil className="h-3 w-3 mr-2" />
                  Edit
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    E
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleToggleFavorite}
                  className="text-xs"
                >
                  <IconStar className="h-3 w-3 mr-2" />
                  {metadata.is_favorite ? "Unfavorite" : "Favorite"}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    F
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClone} className="text-xs">
                  <IconCopy className="h-3 w-3 mr-2" />
                  Clone
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    ⌘D
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-xs text-destructive"
                >
                  <IconTrash className="h-3 w-3 mr-2" />
                  Delete
                  <span className="ml-auto text-[10px] text-muted-foreground/70">
                    ⌘⌫
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <ContextMenuContent className="w-40">{menuItems}</ContextMenuContent>
    </ContextMenu>
  );
}
