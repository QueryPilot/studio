import React, { useMemo, useCallback } from "react";
import {
  IconCheck,
  IconLock,
  IconLockOpen,
  IconShieldLock,
  IconPencil,
} from "@tabler/icons-react";
import { matchSorter, rankings } from "match-sorter";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import type { SafeMode, DbType, DatabaseParadigm } from "@/types/connection";
import { getParadigm } from "@/types/connection";

interface SafeModeItem {
  value: SafeMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const SAFE_MODE_ICONS: Record<SafeMode, React.ReactNode> = {
  read_only: <IconLock className="size-4! text-red-500" />,
  read_write: <IconShieldLock className="size-4! text-orange-500" />,
  read_write_update: <IconPencil className="size-4! text-yellow-500" />,
  full_access: <IconLockOpen className="size-4! text-green-500" />,
};

const SAFE_MODE_LABELS: Record<SafeMode, string> = {
  read_only: "Read Only",
  read_write: "Read + Write",
  read_write_update: "Read + Write + Update",
  full_access: "Full Access",
};

const PARADIGM_DESCRIPTIONS: Record<DatabaseParadigm, Record<SafeMode, string>> = {
  sql: {
    read_only: "SELECT, EXPLAIN, SHOW only",
    read_write: "Above + INSERT",
    read_write_update: "Above + UPDATE",
    full_access: "All operations including DELETE, DDL",
  },
  document: {
    read_only: "Find, Aggregate only",
    read_write: "Above + Insert",
    read_write_update: "Above + Update",
    full_access: "All operations including Delete, RunCommand",
  },
  keyvalue: {
    read_only: "GET, SCAN, INFO, DBSIZE only",
    read_write: "Above + SET, PUSH, ADD",
    read_write_update: "Above + EXPIRE, RENAME",
    full_access: "All operations including DEL, raw commands",
  },
};

function getSafeModeItems(paradigm: DatabaseParadigm): SafeModeItem[] {
  const descriptions = PARADIGM_DESCRIPTIONS[paradigm];
  return (Object.keys(SAFE_MODE_LABELS) as SafeMode[]).map((mode) => ({
    value: mode,
    label: SAFE_MODE_LABELS[mode],
    description: descriptions[mode],
    icon: SAFE_MODE_ICONS[mode],
  }));
}

const MODE_BADGE_COLORS: Record<SafeMode, string> = {
  read_only: "text-red-500",
  read_write: "text-orange-500",
  read_write_update: "text-yellow-500",
  full_access: "text-green-500",
};

interface ConnectionGroup {
  connectionId: string;
  name: string;
  host: string;
  port: number;
  database: string;
  dbType: DbType;
  currentMode: SafeMode;
}

interface NestedSafeModeListProps {
  listRef?: React.RefObject<HTMLDivElement | null>;
  query: string;
  onClose?: () => void;
}

export function NestedSafeModeList({
  listRef,
  query,
  onClose,
}: NestedSafeModeListProps): React.ReactElement {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  const connections = useConnectionStore((state) => state.connections);
  const updateConnection = useConnectionStore(
    (state) => state.updateConnection,
  );

  // Build connection groups from workspace connections
  const connectionGroups = useMemo<ConnectionGroup[]>(() => {
    if (!activeWorkspace) return [];
    const groups: ConnectionGroup[] = [];
    for (const [connId, openConn] of activeWorkspace.connections) {
      const stored = connections.find((c) => c.profile.id === connId);
      const profile = stored?.profile ?? openConn.profile;
      groups.push({
        connectionId: connId,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        database: profile.database || openConn.database || "",
        dbType: profile.db_type,
        currentMode: profile.safe_mode ?? "full_access",
      });
    }
    return groups;
  }, [activeWorkspace, connections]);

  // Filter: connection name match shows all modes, mode label match shows under all connections
  const filteredGroups = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return connectionGroups.map((g) => ({
        ...g,
        modes: getSafeModeItems(getParadigm(g.dbType)),
      }));
    }

    const matchingConnections = matchSorter(connectionGroups, trimmedQuery, {
      keys: ["name", "database"],
      threshold: rankings.CONTAINS,
    });
    const matchingConnIds = new Set(
      matchingConnections.map((c) => c.connectionId),
    );

    const result: Array<ConnectionGroup & { modes: SafeModeItem[] }> = [];
    for (const group of connectionGroups) {
      const items = getSafeModeItems(getParadigm(group.dbType));
      if (matchingConnIds.has(group.connectionId)) {
        result.push({ ...group, modes: items });
      } else {
        const matchingModes = matchSorter(items, trimmedQuery, {
          keys: ["label", "description"],
          threshold: rankings.CONTAINS,
        });
        if (matchingModes.length > 0) {
          result.push({ ...group, modes: matchingModes });
        }
      }
    }
    return result;
  }, [connectionGroups, query]);

  const handleSelect = useCallback(
    async (connectionId: string, newMode: SafeMode) => {
      const stored = connections.find((c) => c.profile.id === connectionId);
      if (!stored) return;

      const currentMode = stored.profile.safe_mode ?? "full_access";
      if (newMode === currentMode) {
        onClose?.();
        return;
      }

      try {
        const updatedProfile = { ...stored.profile, safe_mode: newMode };
        await updateConnection(connectionId, updatedProfile);

        // Sync to workspaceBundleStore so sidebar icon updates reactively
        useWorkspaceBundleStore.setState((s) => {
          if (!s.activeWorkspace) return s;
          const conn = s.activeWorkspace.connections.get(connectionId);
          if (!conn) return s;
          const newConnections = new Map(s.activeWorkspace.connections);
          newConnections.set(connectionId, {
            ...conn,
            profile: updatedProfile,
          });
          return {
            activeWorkspace: {
              ...s.activeWorkspace,
              connections: newConnections,
            },
          };
        });

        await invoke("update_safe_mode", {
          connId: connectionId,
          safeMode: newMode,
        });

        const label = SAFE_MODE_LABELS[newMode];
        toast.success(`${stored.profile.name}: safe mode set to ${label}`);
      } catch (err) {
        toast.error(
          `Failed to update safe mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      onClose?.();
    },
    [connections, updateConnection, onClose],
  );

  const getModeLabel = (mode: SafeMode): string =>
    SAFE_MODE_LABELS[mode] ?? mode;

  return (
    <CommandList ref={listRef} className="h-[500px]">
      <CommandEmpty>No matching connections or safe modes.</CommandEmpty>
      {filteredGroups.map((group) => (
        <CommandGroup
          key={group.connectionId}
          heading={
            <div className="flex items-center gap-2 sticky top-0 z-10">
              <img
                src={getDatabaseLogo(group.dbType)}
                alt={group.dbType}
                className="size-3.5!"
              />
              <span className="truncate">{group.name}</span>
              <span className="ml-auto text-[10px] font-normal">
                <span className={MODE_BADGE_COLORS[group.currentMode]}>
                  {getModeLabel(group.currentMode)}
                </span>
              </span>
            </div>
          }
        >
          {group.modes.map((item) => (
            <CommandItem
              key={`${group.connectionId}:${item.value}`}
              value={`${group.connectionId}:${item.value}`}
              onSelect={() => {
                void handleSelect(group.connectionId, item.value);
              }}
            >
              <div className="flex items-center gap-3 w-full">
                {item.icon}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs font-medium">{item.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {item.description}
                  </span>
                </div>
                {item.value === group.currentMode && (
                  <IconCheck className="size-4! text-primary shrink-0" />
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
