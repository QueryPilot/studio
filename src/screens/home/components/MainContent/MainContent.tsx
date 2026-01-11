import { useMemo, useEffect } from "react";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { WelcomeSection } from "./WelcomeSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionRow } from "../shared/ConnectionRow";
import { ERDWorkspacesSection } from "./ERDWorkspacesSection";
import { WorkspacesSection } from "./WorkspacesSection";
import { WorkspaceForm } from "./WorkspaceForm";
import { WorkspaceDetailView } from "./WorkspaceDetailView";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { toast } from "sonner";

export function MainContent() {
  const contentMode = useHomeScreenStore((s) => s.contentMode);
  const searchQuery = useHomeScreenStore((s) => s.searchQuery);
  const connections = useConnectionStore((s) => s.connections);

  // Global keyboard handler for navigation and shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input/textarea
      const activeElement = document.activeElement;
      const isInInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      if (isInInput) return;

      // Cmd+D to clone focused connection
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        const focusedItem = document.activeElement?.closest('[data-connection-item]');
        if (focusedItem) {
          e.preventDefault();
          const connectionId = focusedItem.getAttribute('data-connection-id');
          if (connectionId) {
            const conn = connections.find(c => c.profile.id === connectionId);
            if (conn) {
              const { saveConnection } = useConnectionStore.getState();
              const clonedProfile = {
                ...conn.profile,
                id: crypto.randomUUID(),
                name: `${conn.profile.name} (Copy)`,
              };
              saveConnection(clonedProfile, conn.metadata.tags);
              toast.success('Connection cloned');
            }
          }
        }
        return;
      }

      // Tab or Arrow keys to focus first item if none focused
      if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const isConnectionFocused = activeElement?.hasAttribute('data-connection-item');
        if (!isConnectionFocused) {
          const firstItem = document.querySelector('[data-connection-item]') as HTMLElement;
          if (firstItem) {
            e.preventDefault();
            firstItem.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => { window.removeEventListener('keydown', handleGlobalKeyDown); };
  }, [connections]);

  // Filter connections based on search query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return null;
    }

    const lowerQuery = searchQuery.toLowerCase();
    return connections.filter((conn) => {
      const { profile, metadata } = conn;
      return (
        profile.name.toLowerCase().includes(lowerQuery) ||
        profile.host.toLowerCase().includes(lowerQuery) ||
        profile.database?.toLowerCase().includes(lowerQuery) ||
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

  if (contentMode === "workspace-list") {
    return (
      <div className="h-full overflow-y-auto">
        <WorkspacesSection />
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
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Search Results */}
          {isSearching ? (
            <div>
              <div className="text-xs text-muted-foreground mb-3">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                {searchQuery && (
                  <span className="ml-1">
                    for "<span className="font-medium text-foreground">{searchQuery}</span>"
                  </span>
                )}
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
            <>
              {/* All Connections grouped by tag */}
              <ConnectionsSection />

              {/* ERD Workspaces */}
              <ERDWorkspacesSection />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
