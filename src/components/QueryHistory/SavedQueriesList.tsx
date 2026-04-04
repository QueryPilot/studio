/**
 * Saved Queries List
 *
 * List of saved/bookmarked queries with starring and organization features.
 */

import { useEffect } from "react";
import {
  useFilteredSavedQueries,
  useQueryHistoryStore,
} from "@/stores/queryHistoryStore";
import { useTabStateStore } from "@/stores/tabStateStore";
import { cn } from "@/lib/utils";
import {
  IconStar,
  IconPlayerPlay,
  IconTrash,
  IconCopy,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { SavedQuery } from "@/lib/db/queryHistory";
import { toast } from "sonner";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";

export function SavedQueriesList() {
  const savedQueries = useFilteredSavedQueries();
  const loadSavedQueries = useQueryHistoryStore((s) => s.loadSavedQueries);
  const toggleStarred = useQueryHistoryStore((s) => s.toggleStarred);
  const deleteSaved = useQueryHistoryStore((s) => s.deleteSaved);
  const isLoading = useQueryHistoryStore((s) => s.isLoading);

  useEffect(() => {
    void loadSavedQueries();
  }, [loadSavedQueries]);

  // Sort: starred first, then by updatedAt
  const sorted = [...savedQueries].sort((a, b) => {
    if (a.starred !== b.starred) return b.starred ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

  if (isLoading && sorted.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Loading...</div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No saved queries yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {sorted.map((query) => (
        <SavedQueryItem
          key={query.id}
          query={query}
          onToggleStar={() => toggleStarred(query.id)}
          onDelete={() => deleteSaved(query.id)}
        />
      ))}
    </div>
  );
}

function SavedQueryItem({
  query,
  onToggleStar,
  onDelete,
}: {
  query: SavedQuery;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const handleOpenInTab = () => {
    const workbench = useWorkbenchStore.getState();
    const workspaceSelection = useWorkspaceSelectionStore.getState();
    const panels = workbench.panelContents;
    const focusedPanelId =
      usePanelFocusStore.getState().focusedPanelId ?? panels.keys().next().value;

    if (!focusedPanelId) {
      toast.error("No panel available");
      return;
    }

    const tabId = `query-${crypto.randomUUID()}`;
    workbench.addTab(focusedPanelId, tabId, {
      type: "query",
      title: query.name,
      connectionId: workspaceSelection.connectionId || "",
      database: query.database || workspaceSelection.database || "",
      schema: query.schema || workspaceSelection.schema || "",
      sql: query.query,
    });
    workbench.setActiveTab(focusedPanelId, tabId);
    workbench.focusPanel(focusedPanelId);

    if (query.queryVariables && Object.keys(query.queryVariables).length > 0) {
      useTabStateStore.getState().setQueryState(tabId, {
        queryVariables: query.queryVariables,
      });
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(query.query);
    toast.success("Query copied to clipboard");
  };

  const handleDelete = () => {
    onDelete();
    toast.success("Query deleted");
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className="px-2 py-1.5 border-b hover:bg-accent cursor-pointer"
            onClick={handleOpenInTab}
          >
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar();
                }}
                className="p-0.5 hover:bg-muted rounded"
              >
                <IconStar
                  className={cn(
                    "h-3 w-3",
                    query.starred
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  )}
                />
              </button>
              <span className="text-xs font-medium truncate">{query.name}</span>
            </div>

            <code className="text-[10px] text-muted-foreground font-mono truncate block mt-0.5">
              {query.query.slice(0, 60)}
              {query.query.length > 60 && "..."}
            </code>

            {query.tags.length > 0 && (
              <div className="flex gap-1 mt-0.5">
                {query.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-[9px] bg-muted px-1 rounded"
                  >
                    {tag}
                  </span>
                ))}
                {query.tags.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">
                    +{query.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        }
      />

      <ContextMenuContent>
        <ContextMenuItem onClick={handleOpenInTab}>
          <IconPlayerPlay className="h-3 w-3 mr-2" />
          Open in New Tab
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopy}>
          <IconCopy className="h-3 w-3 mr-2" />
          Copy SQL
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDelete} className="text-destructive">
          <IconTrash className="h-3 w-3 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
