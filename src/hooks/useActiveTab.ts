import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSecureConnectionStore } from "@/stores/secureConnectionStore";
import { useConnectionHealthStore } from "@/stores/connectionHealthStore";
import { TabState } from "@/types/workspace";

export interface ActiveTabInfo {
  tab: TabState | null;
  workspace: {
    id: string;
    name: string;
  } | null;
  connection: {
    id: string;
    name: string;
    status: "connected" | "connecting" | "disconnected" | "error";
    config: any;
  } | null;
  health: {
    status: "ready" | "degraded" | "reconnecting" | "error";
    rttMs?: number;
    reason?: string;
    lastPing?: Date;
  } | null;
}

/**
 * Hook to get comprehensive information about the currently active tab
 * including its connection details and health status
 */
export function useActiveTab(): ActiveTabInfo {
  const workspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const tab = useWorkspaceStore((s) => s.getActiveTab());
  const connection = useSecureConnectionStore((s) =>
    tab?.connectionId ? s.connections.get(tab.connectionId) : undefined,
  );
  const health = useConnectionHealthStore((s) =>
    tab?.connectionId ? s.getHealth(tab.connectionId) : undefined,
  );

  return {
    tab,
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
        }
      : null,
    connection: connection
      ? {
          id: connection.config.id || "",
          name: connection.config.name,
          status: connection.status,
          config: connection.config,
        }
      : null,
    health: health
      ? {
          status: health.status,
          rttMs: health.rttMs,
          reason: health.reason,
          lastPing: health.lastPing,
        }
      : null,
  };
}

/**
 * Hook to get tab information by tab ID
 */
export function useTabInfo(workspaceId: string, tabId: string) {
  const workspace = useWorkspaceStore((s) => s.getWorkspace(workspaceId));
  const tab = workspace?.tabs.get(tabId);
  const connection = useSecureConnectionStore((s) =>
    tab?.connectionId ? s.connections.get(tab.connectionId) : undefined,
  );
  const health = useConnectionHealthStore((s) =>
    tab?.connectionId ? s.getHealth(tab.connectionId) : undefined,
  );

  return {
    tab: tab || null,
    connection: connection
      ? {
          id: connection.config.id || "",
          name: connection.config.name,
          status: connection.status,
          config: connection.config,
        }
      : null,
    health: health
      ? {
          status: health.status,
          rttMs: health.rttMs,
          reason: health.reason,
          lastPing: health.lastPing,
        }
      : null,
  };
}
