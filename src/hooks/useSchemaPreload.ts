/**
 * Background Schema Preload Hook
 *
 * Prefetches schema data when connections become active so the
 * Command Palette has warm cache for instant search.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { schemaCache } from "@/services/schemaCache";
import { logger } from "@/lib/logger";
import type { OpenConnection } from "@/types/workspace";

/**
 * Prefetches schema data for newly connected connections.
 * This runs as a background side-effect and does not block rendering.
 */
export function useSchemaPreload(): void {
  const queryClient = useQueryClient();
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);

  // Track which connections we've already prefetched to avoid redundant fetches
  const prefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeWorkspace) {
      // Clear tracking when workspace closes
      prefetchedRef.current.clear();
      return;
    }

    // Find connections that are connected and have database/schema set
    const connectedConnections: OpenConnection[] = [];
    for (const conn of activeWorkspace.connections.values()) {
      if (conn.status === "connected" && conn.database && conn.schema) {
        connectedConnections.push(conn);
      }
    }

    // Prefetch schema data for each newly connected connection
    for (const conn of connectedConnections) {
      const cacheKey = `${conn.id}:${conn.database}:${conn.schema}`;

      // Skip if already prefetched
      if (prefetchedRef.current.has(cacheKey)) {
        continue;
      }

      // Mark as prefetched immediately to prevent duplicate fetches
      prefetchedRef.current.add(cacheKey);

      logger.info(
        `[useSchemaPreload] Prefetching schema for ${conn.profile.name} (${conn.database}/${conn.schema})`,
      );

      // Low priority background prefetch for tables
      void queryClient.prefetchQuery({
        queryKey: ["schemaPreload", "tables", conn.id, conn.schema],
        queryFn: () => schemaCache.getTables(conn.id, conn.schema),
        staleTime: 5 * 60 * 1000, // 5 minutes
      });

      // Low priority background prefetch for functions
      void queryClient.prefetchQuery({
        queryKey: ["schemaPreload", "functions", conn.id, conn.schema],
        queryFn: () => schemaCache.getFunctions(conn.id, conn.schema),
        staleTime: 5 * 60 * 1000, // 5 minutes
      });
    }

    // Cleanup stale entries from prefetchedRef when connections are removed
    for (const key of prefetchedRef.current) {
      const connectionId = key.split(":")[0];
      if (connectionId && !activeWorkspace.connections.has(connectionId)) {
        prefetchedRef.current.delete(key);
      }
    }
  }, [activeWorkspace, queryClient]);
}
