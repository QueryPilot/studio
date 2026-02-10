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
import type { SafeMode, DbType } from "@/types/connection";

interface SafeModeItem {
  value: SafeMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const SAFE_MODE_ITEMS: SafeModeItem[] = [
  {
    value: "read_only",
    label: "Read Only",
    description: "SELECT, EXPLAIN, SHOW only",
    icon: <IconLock className="size-4 text-red-500" />,
  },
  {
    value: "read_write",
    label: "Read + Write",
    description: "Above + INSERT",
    icon: <IconShieldLock className="size-4 text-orange-500" />,
  },
  {
    value: "read_write_update",
    label: "Read + Write + Update",
    description: "Above + UPDATE",
    icon: <IconPencil className="size-4 text-yellow-500" />,
  },
  {
    value: "full_access",
    label: "Full Access",
    description: "All operations including DELETE, DDL",
    icon: <IconLockOpen className="size-4 text-green-500" />,
  },
];

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
      return connectionGroups.map((g) => ({ ...g, modes: SAFE_MODE_ITEMS }));
    }

    const matchingConnections = matchSorter(connectionGroups, trimmedQuery, {
      keys: ["name", "database"],
      threshold: rankings.CONTAINS,
    });
    const matchingConnIds = new Set(
      matchingConnections.map((c) => c.connectionId),
    );

    const matchingModes = matchSorter(SAFE_MODE_ITEMS, trimmedQuery, {
      keys: ["label", "description"],
      threshold: rankings.CONTAINS,
    });

    const result: Array<ConnectionGroup & { modes: SafeModeItem[] }> = [];
    for (const group of connectionGroups) {
      if (matchingConnIds.has(group.connectionId)) {
        result.push({ ...group, modes: SAFE_MODE_ITEMS });
      } else if (matchingModes.length > 0) {
        result.push({ ...group, modes: matchingModes });
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

        await invoke("update_safe_mode", {
          connId: connectionId,
          safeMode: newMode,
        });

        const label = SAFE_MODE_ITEMS.find((i) => i.value === newMode)?.label;
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
    SAFE_MODE_ITEMS.find((i) => i.value === mode)?.label ?? mode;

  return (
    <CommandList ref={listRef} className="h-[300px]">
      <CommandEmpty>No matching connections or safe modes.</CommandEmpty>
      {filteredGroups.map((group) => (
        <CommandGroup
          key={group.connectionId}
          heading={
            <div className="flex items-center gap-2">
              <img
                src={getDatabaseLogo(group.dbType)}
                alt={group.dbType}
                className="size-3.5"
              />
              <span className="truncate">{group.name}</span>
              {group.database && (
                <span className="font-normal text-muted-foreground/60">
                  / {group.database}
                </span>
              )}
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
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </div>
                {item.value === group.currentMode && (
                  <IconCheck className="size-4 text-primary shrink-0" />
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </CommandList>
  );
}
