import { useMemo, useEffect, useRef } from "react";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { WelcomeSection } from "./WelcomeSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { StatsHeader } from "./StatsHeader";
import { ConnectionForm } from "./ConnectionForm";
import { WorkspaceForm } from "./WorkspaceForm";
import { ConnectionRow } from "../shared/ConnectionRow";
import { WorkspacesSection } from "./WorkspacesSection";
import { WorkspaceDetailView } from "./WorkspaceDetailView";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { toast } from "sonner";
import { parseSearchFilters } from "../ActionBar/SidebarSearch";

export function MainContent() {
  const contentMode = useHomeScreenStore((s) => s.contentMode);
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const connections = useConnectionStore((s) => s.connections);
  const loadSavedWorkspaces = useWorkspaceBundleStore(
    (s) => s.loadSavedWorkspaces,
  );

  // Refresh workspaces when returning to browse from a form
  const prevContentMode = useRef(contentMode);
  useEffect(() => {
    const prev = prevContentMode.current;
    prevContentMode.current = contentMode;
    if (
      contentMode === "browse" &&
      (prev === "form" || prev === "workspace-form")
    ) {
      void loadSavedWorkspaces();
    }
  }, [contentMode, loadSavedWorkspaces]);

  // Global keyboard handler for navigation and shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input/textarea
      const activeElement = document.activeElement;
      const isInInput =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA";
      if (isInInput) return;

      // Cmd+D to clone focused connection
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        const focusedItem = document.activeElement?.closest(
          "[data-connection-item]",
        );
        if (focusedItem) {
          e.preventDefault();
          const connectionId = focusedItem.getAttribute("data-connection-id");
          if (connectionId) {
            const conn = connections.find((c) => c.profile.id === connectionId);
            if (conn) {
              const { saveConnection } = useConnectionStore.getState();
              const clonedProfile = {
                ...conn.profile,
                id: crypto.randomUUID(),
                name: `${conn.profile.name} (Copy)`,
              };
              void saveConnection(clonedProfile, conn.metadata.tags);
              toast.success("Connection cloned");
            }
          }
        }
        return;
      }

      // Tab or Arrow keys to focus first item if none focused
      if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        const isConnectionFocused = activeElement?.hasAttribute(
          "data-connection-item",
        );
        if (!isConnectionFocused) {
          const firstItem = document.querySelector<HTMLElement>(
            "[data-connection-item]",
          );
          if (firstItem) {
            e.preventDefault();
            firstItem.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [connections]);

  // Filter connections based on search query with filter chip support
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return null;
    }

    const { text, filters } = parseSearchFilters(searchQuery);
    const lowerQuery = text.toLowerCase();

    return connections.filter((conn) => {
      const { profile, metadata } = conn;

      // Apply filter chips first
      for (const filter of filters) {
        if (filter.key === "type" || filter.key === "db") {
          const dbType = profile.db_type.toLowerCase();
          if (!dbType.includes(filter.value)) {
            return false;
          }
        } else if (filter.key === "tag" || filter.key === "env") {
          const hasTag = metadata.tags.some(
            (tag) => tag.toLowerCase() === filter.value,
          );
          if (!hasTag) {
            return false;
          }
        }
      }

      // If there's no text query, just use filters
      if (!lowerQuery) {
        return true;
      }

      // Text search
      return (
        profile.name.toLowerCase().includes(lowerQuery) ||
        profile.host.toLowerCase().includes(lowerQuery) ||
        profile.database.toLowerCase().includes(lowerQuery) ||
        metadata.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    });
  }, [connections, searchQuery]);

  if (contentMode === "form") {
    return (
      <div className="h-full overflow-y-auto">
        <ConnectionForm />
      </div>
    );
  }

  if (contentMode === "workspace-form") {
    return (
      <div className="h-full overflow-y-auto">
        <WorkspaceForm />
      </div>
    );
  }

  if (contentMode === "workspace-list") {
    return (
      <div className="h-full overflow-y-auto">
        <WorkspacesSection />
      </div>
    );
  }

  if (contentMode === "workspace-detail") {
    return (
      <div className="h-full overflow-y-auto">
        <WorkspaceDetailView />
      </div>
    );
  }

  const isSearching = searchResults !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search bar - always visible */}
      {connections.length > 0 && (
        <div className="px-6 pt-6 pb-3 bg-background">
          <StatsHeader />
        </div>
      )}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 pt-0 space-y-6">
          {isSearching ? (
            <div>
              <div className="text-xs text-muted-foreground mb-3">
                {searchResults.length} result
                {searchResults.length !== 1 ? "s" : ""} found
              </div>
              {searchResults.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No connections match your search
                </div>
              ) : (
                <div className="space-y-0.5">
                  {searchResults.map((connection) => (
                    <ConnectionRow
                      key={connection.profile.id}
                      connection={connection}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : connections.length === 0 ? (
            <WelcomeSection />
          ) : (
            <ConnectionsSection />
          )}
        </div>
      </div>
    </div>
  );
}
