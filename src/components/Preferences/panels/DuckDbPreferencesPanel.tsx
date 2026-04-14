import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BackendAPI, type DuckDbSetting } from "@/services/backend";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { DbType } from "@/types/connection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  IconSearch,
  IconRefresh,
  IconChevronDown,
  IconChevronRight,
  IconRotateClockwise,
  IconAlertCircle,
  IconDatabase,
  IconCpu,
  IconShieldLock,
  IconWorld,
  IconCode,
  IconAdjustments,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";

interface TextSettingDef {
  kind: "text";
  name: string;
  hint?: string;
}
interface ToggleSettingDef {
  kind: "toggle";
  name: string;
}
interface SelectSettingDef {
  kind: "select";
  name: string;
  options: string[];
}

type CuratedSettingDef = TextSettingDef | ToggleSettingDef | SelectSettingDef;

interface CuratedSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  settings: CuratedSettingDef[];
}

const CURATED_SECTIONS: CuratedSection[] = [
  {
    id: "resources",
    label: "Resources & Spilling",
    icon: IconCpu,
    settings: [
      { kind: "text", name: "memory_limit", hint: 'e.g. "4GB", "512MB"' },
      { kind: "text", name: "threads", hint: "Number of threads" },
      { kind: "text", name: "temp_directory", hint: "Path for temporary files" },
      { kind: "text", name: "max_temp_directory_size", hint: 'e.g. "10GB"' },
    ],
  },
  {
    id: "sql",
    label: "SQL Semantics",
    icon: IconCode,
    settings: [
      { kind: "select", name: "default_order", options: ["ASC", "DESC"] },
      { kind: "select", name: "default_null_order", options: ["NULLS FIRST", "NULLS LAST"] },
      { kind: "toggle", name: "preserve_insertion_order" },
    ],
  },
  {
    id: "remote",
    label: "Remote I/O",
    icon: IconWorld,
    settings: [
      { kind: "text", name: "http_timeout", hint: "Timeout in milliseconds" },
      { kind: "toggle", name: "enable_http_metadata_cache" },
    ],
  },
  {
    id: "security",
    label: "Security",
    icon: IconShieldLock,
    settings: [
      { kind: "toggle", name: "enable_external_access" },
      { kind: "toggle", name: "allow_community_extensions" },
    ],
  },
];

interface Preset {
  label: string;
  description: string;
  settings: Record<string, string>;
}

const PRESETS: Record<string, Preset> = {
  low_memory: {
    label: "Low Memory",
    description: "Reduce memory usage for constrained environments",
    settings: {
      memory_limit: "512MB",
      threads: "2",
      preserve_insertion_order: "false",
    },
  },
  high_performance: {
    label: "High Performance",
    description: "Maximize throughput for large datasets",
    settings: {
      memory_limit: "8GB",
      preserve_insertion_order: "false",
    },
  },
  safe_mode: {
    label: "Safe Mode",
    description: "Restrict external access and community extensions",
    settings: {
      enable_external_access: "false",
      allow_community_extensions: "false",
    },
  },
};

function isDuckDbConnection(dbType: DbType): boolean {
  return dbType === DbType.DuckDB || dbType === DbType.MotherDuck;
}

function useDuckDbConnectionId(): string | null {
  const activeWorkspace = useWorkspaceBundleStore((s) => s.activeWorkspace);
  if (!activeWorkspace) return null;

  const focused = activeWorkspace.focusedConnectionId;
  if (focused) {
    const conn = activeWorkspace.connections.get(focused);
    if (
      conn &&
      conn.status === "connected" &&
      isDuckDbConnection(conn.profile.db_type)
    ) {
      return focused;
    }
  }

  for (const [id, conn] of activeWorkspace.connections) {
    if (conn.status === "connected" && isDuckDbConnection(conn.profile.db_type)) {
      return id;
    }
  }

  return null;
}

function CuratedSettingRow({
  def,
  setting,
  onSet,
  isPending,
}: {
  def: CuratedSettingDef;
  setting: DuckDbSetting | undefined;
  onSet: (name: string, value: string) => void;
  isPending: boolean;
}) {
  const [localValue, setLocalValue] = useState<string | null>(null);
  const displayValue = localValue ?? setting?.value ?? "";

  const handleCommit = useCallback(
    (value: string) => {
      onSet(def.name, value);
      setLocalValue(null);
    },
    [def.name, onSet],
  );

  if (def.kind === "toggle") {
    const checked = displayValue === "true";
    return (
      <div className="flex items-center justify-between py-2.5 px-3 border rounded-lg">
        <div className="space-y-0.5 flex-1 min-w-0">
          <Label className="text-xs font-medium font-mono">{def.name}</Label>
          {setting?.description && (
            <p className="text-[11px] text-muted-foreground line-clamp-1">
              {setting.description}
            </p>
          )}
        </div>
        <Switch
          checked={checked}
          disabled={isPending}
          onCheckedChange={(v) => { handleCommit(v ? "true" : "false"); }}
        />
      </div>
    );
  }

  if (def.kind === "select") {
    return (
      <div className="flex items-center justify-between py-2.5 px-3 border rounded-lg">
        <div className="space-y-0.5 flex-1 min-w-0">
          <Label className="text-xs font-medium font-mono">{def.name}</Label>
          {setting?.description && (
            <p className="text-[11px] text-muted-foreground line-clamp-1">
              {setting.description}
            </p>
          )}
        </div>
        <Select
          value={displayValue}
          onValueChange={(v) => { if (v != null) handleCommit(v); }}
          disabled={isPending}
        >
          <SelectTrigger className="w-36 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {def.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2.5 px-3 border rounded-lg gap-3">
      <div className="space-y-0.5 flex-1 min-w-0">
        <Label className="text-xs font-medium font-mono">{def.name}</Label>
        {setting?.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-1">
            {setting.description}
          </p>
        )}
      </div>
      <Input
        value={localValue ?? displayValue}
        onChange={(e) => { setLocalValue(e.target.value); }}
        onBlur={() => {
          if (localValue !== null && localValue !== setting?.value) {
            handleCommit(localValue);
          } else {
            setLocalValue(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && localValue !== null) {
            handleCommit(localValue);
          }
        }}
        disabled={isPending}
        placeholder={def.hint}
        className="w-40 h-7 text-xs font-mono"
      />
    </div>
  );
}

function AllSettingsTable({
  settings,
  onSet,
  onReset,
  isPending,
}: {
  settings: DuckDbSetting[];
  onSet: (name: string, value: string) => void;
  onReset: (name: string) => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return settings;
    const q = search.toLowerCase();
    return settings.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [settings, search]);

  const startEditing = useCallback((s: DuckDbSetting) => {
    setEditingRow(s.name);
    setEditValue(s.value);
  }, []);

  const commitEdit = useCallback(
    (name: string) => {
      const original = settings.find((s) => s.name === name);
      if (original && editValue !== original.value) {
        onSet(name, editValue);
      }
      setEditingRow(null);
    },
    [settings, editValue, onSet],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          placeholder="Filter settings..."
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium w-44">Value</th>
              <th className="text-left px-3 py-2 font-medium w-20">Scope</th>
              <th className="text-right px-3 py-2 font-medium w-16" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.name}
                className="border-b last:border-b-0 hover:bg-muted/30 group"
              >
                <td className="px-3 py-1.5">
                  <span className="font-mono font-medium text-[11px]">
                    {s.name}
                  </span>
                  {s.description && (
                    <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                      {s.description}
                    </p>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {editingRow === s.name ? (
                    <Input
                      value={editValue}
                      onChange={(e) => { setEditValue(e.target.value); }}
                      onBlur={() => { commitEdit(s.name); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(s.name);
                        if (e.key === "Escape") setEditingRow(null);
                      }}
                      autoFocus
                      className="h-6 text-[11px] font-mono"
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-left font-mono text-[11px] hover:text-primary cursor-text w-full truncate"
                      onClick={() => { startEditing(s); }}
                      disabled={isPending}
                    >
                      {s.value || <span className="text-muted-foreground italic">empty</span>}
                    </button>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <Badge
                    variant={s.scope === "GLOBAL" ? "default" : "outline"}
                    className="text-[9px] px-1.5 py-0"
                  >
                    {s.scope}
                  </Badge>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { onReset(s.name); }}
                    disabled={isPending}
                    title="Reset to default"
                  >
                    <IconRotateClockwise className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No settings match &ldquo;{search}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}

export default function DuckDbPreferencesPanel() {
  const connId = useDuckDbConnectionId();
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    resources: true,
    sql: true,
    remote: false,
    security: false,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const {
    data: settings = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["duckdb-settings", connId],
    queryFn: () => {
      if (!connId) throw new Error("No DuckDB connection");
      return BackendAPI.duckdbGetSettings(connId);
    },
    enabled: !!connId,
  });

  const setMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) => {
      if (!connId) return Promise.reject(new Error("No DuckDB connection"));
      return BackendAPI.duckdbSetSetting(connId, name, value);
    },
    onSuccess: (_data, { name }) => {
      toast.success(`Setting "${name}" updated`);
      void queryClient.invalidateQueries({
        queryKey: ["duckdb-settings", connId],
      });
    },
    onError: (err, { name }) => {
      toast.error(`Failed to set "${name}"`, { description: String(err) });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (name: string) => {
      if (!connId) return Promise.reject(new Error("No DuckDB connection"));
      return BackendAPI.duckdbResetSetting(connId, name);
    },
    onSuccess: (_data, name) => {
      toast.success(`Setting "${name}" reset to default`);
      void queryClient.invalidateQueries({
        queryKey: ["duckdb-settings", connId],
      });
    },
    onError: (err, name) => {
      toast.error(`Failed to reset "${name}"`, { description: String(err) });
    },
  });

  const handleSet = useCallback(
    (name: string, value: string) => {
      setMutation.mutate({ name, value });
    },
    [setMutation],
  );

  const handleReset = useCallback(
    (name: string) => {
      resetMutation.mutate(name);
    },
    [resetMutation],
  );

  const [isApplyingPreset, setIsApplyingPreset] = useState(false);

  const applyPreset = useCallback(
    async (presetKey: string) => {
      const preset = PRESETS[presetKey];
      if (!preset || !connId) return;

      setIsApplyingPreset(true);
      const entries = Object.entries(preset.settings);
      let applied = 0;
      const failures: string[] = [];

      try {
        for (const [name, value] of entries) {
          try {
            await BackendAPI.duckdbSetSetting(connId, name, value);
            applied += 1;
          } catch (err) {
            failures.push(`${name}: ${String(err)}`);
          }
        }

        if (failures.length === 0) {
          toast.success(`"${preset.label}" preset applied (${applied} settings)`);
        } else if (applied > 0) {
          toast.warning(`Preset partially applied`, {
            description: `${applied}/${entries.length} succeeded. Failed: ${failures.join("; ")}`,
          });
        } else {
          toast.error(`Failed to apply preset`, {
            description: failures.join("; "),
          });
        }

        void queryClient.invalidateQueries({
          queryKey: ["duckdb-settings", connId],
        });
      } finally {
        setIsApplyingPreset(false);
      }
    },
    [connId, queryClient],
  );

  const isPending = setMutation.isPending || resetMutation.isPending || isApplyingPreset;

  if (!connId) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 px-8 pt-6 pb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <IconDatabase className="h-4 w-4" />
            DuckDB Settings
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <IconAlertCircle className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                No active DuckDB connection
              </p>
              <p className="text-xs text-muted-foreground/70">
                Connect to a DuckDB or MotherDuck database to configure settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-8 pt-6 pb-3 sticky top-0 bg-background z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <IconDatabase className="h-4 w-4" />
              DuckDB Settings
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure DuckDB engine settings for this connection. Changes apply immediately.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <IconRefresh className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-8 pb-8 pt-4 space-y-6">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="py-8 text-center text-sm text-destructive">
              Failed to load settings: {String(error)}
            </div>
          )}

          {!isLoading && !error && (
            <>
              {/* Presets */}
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <IconSparkles className="h-3.5 w-3.5" />
                  Quick Presets
                </Label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(PRESETS).map(([key, preset]) => (
                    <Button
                      key={key}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isPending}
                      onClick={() => void applyPreset(key)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Curated Sections */}
              {CURATED_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isOpen = openSections[section.id] ?? false;

                return (
                  <Collapsible
                    key={section.id}
                    open={isOpen}
                    onOpenChange={(open) => {
                      setOpenSections((prev) => ({ ...prev, [section.id]: open }));
                    }}
                  >
                    <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 group cursor-pointer">
                      {isOpen ? (
                        <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{section.label}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 pt-2 pl-6">
                        {section.settings.map((def) => (
                          <CuratedSettingRow
                            key={def.name}
                            def={def}
                            setting={settings.find((s) => s.name === def.name)}
                            onSet={handleSet}
                            isPending={isPending}
                          />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}

              {/* Advanced: All Settings */}
              <Collapsible
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full py-1 group cursor-pointer border-t pt-4">
                  {advancedOpen ? (
                    <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <IconAdjustments className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    All Settings
                  </span>
                  <Badge variant="outline" className="text-[10px] ml-1">
                    {settings.length}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pt-3">
                    <AllSettingsTable
                      settings={settings}
                      onSet={handleSet}
                      onReset={handleReset}
                      isPending={isPending}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
