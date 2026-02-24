/**
 * Query History List
 *
 * Virtualized list of query history entries.
 * Supports context menu actions for opening, saving, and copying queries.
 */

import { useRef, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useFilteredHistory,
  useQueryHistoryStore,
} from "@/stores/queryHistoryStore";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  IconCheck,
  IconX,
  IconClock,
  IconDatabase,
  IconPlayerPlay,
  IconBookmarkPlus,
  IconCopy,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import type { QueryHistoryEntry } from "@/lib/db/queryHistory";
import { toast } from "sonner";
import useWorkbenchStore from "@/stores/workbenchStore";
import { usePanelFocusStore } from "@/stores/panelFocusStore";
import { useWorkspaceSelectionStore } from "@/stores/workspaceSelectionStore";
import { SaveQueryDialog } from "./SaveQueryDialog";
import {
  DraggableSidebarItem,
  type SidebarItemDragData,
} from "@/screens/workspace/components/DatabaseSidebarItem";

export function QueryHistoryList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const history = useFilteredHistory();
  const loadHistory = useQueryHistoryStore((s) => s.loadHistory);
  const isLoading = useQueryHistoryStore((s) => s.isLoading);
  const [saveDialogEntry, setSaveDialogEntry] = useState<QueryHistoryEntry | null>(null);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  if (isLoading && history.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Loading...</div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No query history yet
      </div>
    );
  }

  return (
    <>
      <div ref={parentRef} className="h-full overflow-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = history[virtualItem.index];
            if (!entry) return null;
            return (
              <HistoryItem
                key={entry.id}
                entry={entry}
                onSave={() => {
                  setSaveDialogEntry(entry);
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Save Query Dialog */}
      <SaveQueryDialog
        open={saveDialogEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSaveDialogEntry(null);
        }}
        query={saveDialogEntry?.query ?? ""}
        profileId={saveDialogEntry?.profileId}
        database={saveDialogEntry?.database}
        schema={saveDialogEntry?.schema}
      />
    </>
  );
}

function HistoryItem({
  entry,
  style,
  onSave,
}: {
  entry: QueryHistoryEntry;
  style: React.CSSProperties;
  onSave: () => void;
}) {
  const truncatedQuery = entry.query.slice(0, 80).replace(/\s+/g, " ");
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
      title: "Query from History",
      connectionId: entry.connectionId,
      database: entry.database,
      schema: entry.schema || workspaceSelection.schema || "",
      sql: entry.query,
    });
    workbench.setActiveTab(focusedPanelId, tabId);
    workbench.focusPanel(focusedPanelId);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.query);
    toast.success("Query copied to clipboard");
  };

  const workspaceSelection = useWorkspaceSelectionStore.getState();
  const dragData: SidebarItemDragData = {
    type: "sidebar-item",
    objectType: "history",
    name: truncatedQuery,
    connectionId: entry.connectionId,
    database: entry.database,
    schema: entry.schema || workspaceSelection.schema || "",
    historyQuery: entry.query,
  };

  return (
    <DraggableSidebarItem
      dragId={`sidebar-history-${entry.id}`}
      dragData={dragData}
    >
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              style={style}
              className={cn(
                "px-2 py-1.5 border-b cursor-pointer hover:bg-accent",
                "flex flex-col gap-0.5"
              )}
              onClick={handleOpenInTab}
            >
              {/* Query preview */}
              <code className="text-xs font-mono truncate">
                {truncatedQuery}
                {entry.query.length > 80 && "..."}
              </code>

              {/* Metadata row */}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {entry.success ? (
                  <IconCheck className="h-3 w-3 text-green-500" />
                ) : (
                  <IconX className="h-3 w-3 text-red-500" />
                )}

                <span className="flex items-center gap-0.5">
                  <IconClock className="h-2.5 w-2.5" />
                  {formatDistanceToNow(entry.executedAt, { addSuffix: true })}
                </span>

                {entry.executionTimeMs !== undefined && (
                  <span>{entry.executionTimeMs}ms</span>
                )}

                {entry.rowCount !== undefined && (
                  <span>{entry.rowCount} rows</span>
                )}

                <span className="flex items-center gap-0.5 ml-auto">
                  <IconDatabase className="h-2.5 w-2.5" />
                  {entry.database}
                </span>
              </div>
            </div>
          }
        />

        <ContextMenuContent>
          <ContextMenuItem onClick={handleOpenInTab}>
            <IconPlayerPlay className="h-3 w-3 mr-2" />
            Open in New Tab
          </ContextMenuItem>
          <ContextMenuItem onClick={onSave}>
            <IconBookmarkPlus className="h-3 w-3 mr-2" />
            Save Query
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopy}>
            <IconCopy className="h-3 w-3 mr-2" />
            Copy SQL
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </DraggableSidebarItem>
  );
}
