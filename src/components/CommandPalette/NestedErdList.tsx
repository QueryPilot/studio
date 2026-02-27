import React, { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { matchSorter, rankings } from "match-sorter";
import { IconLayout2 } from "@tabler/icons-react";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { databaseService } from "@/services/databaseService";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { DbType, getParadigm } from "@/types/connection";

// --- Types ---

export interface ErdTarget {
  connectionId: string;
  connectionName: string;
  database: string;
  schema?: string;
  dbType: DbType;
}

interface ConnectionInfo {
  connectionId: string;
  name: string;
  dbType: DbType;
  database: string;
}

interface NestedErdListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onSelect: (target: ErdTarget) => void;
  onClose?: () => void;
}

// --- Helpers ---

function supportsSchemas(dbType: DbType): boolean {
  return dbType === DbType.PostgreSQL || dbType === DbType.SQLServer;
}

// --- Component ---

export function NestedErdList({
  listRef,
  query,
  onSelect,
}: NestedErdListProps): React.ReactElement {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const connections = useConnectionStore((state) => state.connections);

  // Build list of connected SQL connections
  const sqlConnections = useMemo<ConnectionInfo[]>(() => {
    if (!activeWorkspace) return [];
    const result: ConnectionInfo[] = [];
    for (const [connId, openConn] of activeWorkspace.connections) {
      if (openConn.status !== "connected") continue;
      const stored = connections.find((c) => c.profile.id === connId);
      const profile = stored?.profile ?? openConn.profile;
      if (getParadigm(profile.db_type) !== "sql") continue;
      result.push({
        connectionId: connId,
        name: profile.name,
        dbType: profile.db_type,
        database: openConn.database || profile.database || "",
      });
    }
    return result;
  }, [activeWorkspace, connections]);

  // Load databases for each SQL connection
  const databaseQueries = useQueries({
    queries: sqlConnections.map((conn) => ({
      queryKey: ["databases", conn.connectionId],
      queryFn: async () => {
        if (!databaseService.isConnectionActive(conn.connectionId)) {
          throw new Error("Connection is not active");
        }
        return databaseService.listDatabases(conn.connectionId);
      },
      enabled: databaseService.isConnectionActive(conn.connectionId),
      staleTime: 60_000,
      retry: 2,
    })),
  });

  // Load schemas for schema-supporting DBs (current database only)
  const schemaConnections = sqlConnections.filter(
    (conn) => supportsSchemas(conn.dbType) && conn.database,
  );

  const schemaQueries = useQueries({
    queries: schemaConnections.map((conn) => ({
      queryKey: ["schemas", conn.connectionId, conn.database],
      queryFn: async () => {
        if (!databaseService.isConnectionActive(conn.connectionId)) {
          throw new Error("Connection is not active");
        }
        return databaseService.listSchemas(conn.connectionId, conn.database);
      },
      enabled: databaseService.isConnectionActive(conn.connectionId),
      staleTime: 60_000,
      retry: 2,
    })),
  });

  // Assemble groups: connection -> targets
  const groups = useMemo(() => {
    const schemaMap = new Map<string, string[]>();
    schemaConnections.forEach((conn, i) => {
      const result = schemaQueries[i];
      if (result?.data) {
        schemaMap.set(conn.connectionId, result.data);
      }
    });

    return sqlConnections.map((conn, connIdx) => {
      const dbResult = databaseQueries[connIdx];
      const databases = dbResult?.data ?? [];
      const isLoading = dbResult?.isLoading ?? false;

      const targets: ErdTarget[] = [];

      if (supportsSchemas(conn.dbType)) {
        const schemas = schemaMap.get(conn.connectionId) ?? [];
        if (schemas.length > 0) {
          for (const schema of schemas) {
            targets.push({
              connectionId: conn.connectionId,
              connectionName: conn.name,
              database: conn.database,
              schema,
              dbType: conn.dbType,
            });
          }
        } else if (conn.database) {
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: conn.database,
            dbType: conn.dbType,
          });
        }
        for (const db of databases) {
          if (db === conn.database) continue;
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: db,
            dbType: conn.dbType,
          });
        }
      } else {
        if (databases.length > 0) {
          for (const db of databases) {
            targets.push({
              connectionId: conn.connectionId,
              connectionName: conn.name,
              database: db,
              dbType: conn.dbType,
            });
          }
        } else if (conn.database) {
          targets.push({
            connectionId: conn.connectionId,
            connectionName: conn.name,
            database: conn.database,
            dbType: conn.dbType,
          });
        }
      }

      return {
        connectionId: conn.connectionId,
        name: conn.name,
        dbType: conn.dbType,
        targets,
        isLoading,
      };
    });
  }, [sqlConnections, databaseQueries, schemaConnections, schemaQueries]);

  // Filter by search query
  const filteredGroups = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return groups;

    const matchingConnections = matchSorter(groups, trimmed, {
      keys: ["name"],
      threshold: rankings.CONTAINS,
    });
    const matchingConnIds = new Set(
      matchingConnections.map((g) => g.connectionId),
    );

    const result: typeof groups = [];
    for (const group of groups) {
      if (matchingConnIds.has(group.connectionId)) {
        result.push(group);
      } else {
        const matchingTargets = matchSorter(group.targets, trimmed, {
          keys: ["database", "schema"],
          threshold: rankings.CONTAINS,
        });
        if (matchingTargets.length > 0) {
          result.push({ ...group, targets: matchingTargets });
        }
      }
    }
    return result;
  }, [groups, query]);

  const getTargetLabel = (target: ErdTarget): string => {
    if (target.schema) {
      return `${target.database} / ${target.schema}`;
    }
    return target.database;
  };

  return (
    <CommandList ref={listRef} className="h-[500px]">
      <CommandEmpty>No ERD targets found.</CommandEmpty>
      {filteredGroups.map((group) => (
        <CommandGroup
          key={group.connectionId}
          heading={
            <div className="flex items-center gap-2">
              <img
                src={getDatabaseLogo(group.dbType)}
                alt={group.dbType}
                className="size-3.5!"
              />
              <span className="truncate">{group.name}</span>
              {group.isLoading && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Loading...
                </span>
              )}
            </div>
          }
        >
          {group.targets.map((target) => {
            const key = `${target.connectionId}:${target.database}:${target.schema ?? ""}`;
            return (
              <CommandItem
                key={key}
                value={key}
                onSelect={() => onSelect(target)}
              >
                <div className="flex items-center gap-3 w-full">
                  <IconLayout2 className="size-4! text-muted-foreground shrink-0" />
                  <span className="text-xs truncate">
                    {getTargetLabel(target)}
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
