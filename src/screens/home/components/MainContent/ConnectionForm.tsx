import { logger } from "@/lib/logger";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SafeMode } from "@/types/connection";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  IconLoader2,
  IconCircleCheckFilled,
  IconChevronDown,
  IconShield,
  IconServer,
  IconPlus,
  IconCheck,
  IconClipboardText,
  IconClipboardCheck,
  IconArrowLeft,
  IconInfoCircle,
  IconFolderOpen,
  IconLayout2,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { toast } from "sonner";
import {
  detectConnectionFormat,
  parseConnectionEnv,
  parseConnectionUri,
  type DatabaseType,
} from "@/utils/connectionParser";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import {
  type ConnectionProfile,
  DbType,
  SslMode,
  type GroupTag,
} from "@/types/connection";
import { vaultStorage } from "@/services/vaultStorage";
import { windowManager } from "@/services/windowManager";

const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
const { open } = await import("@tauri-apps/plugin-dialog");

// Environment tags
const ENVIRONMENT_TAGS = [
  { name: "local", color: "bg-gray-500", textColor: "text-gray-50" },
  { name: "dev", color: "bg-blue-500", textColor: "text-blue-50" },
  { name: "staging", color: "bg-yellow-500", textColor: "text-yellow-50" },
  { name: "uat", color: "bg-amber-600", textColor: "text-amber-50" },
  { name: "prod", color: "bg-red-500", textColor: "text-red-50" },
  { name: "test", color: "bg-green-500", textColor: "text-green-50" },
];

// Tag colors
const TAG_COLORS = [
  { value: "purple", class: "bg-purple-500", textClass: "text-purple-50" },
  { value: "pink", class: "bg-pink-500", textClass: "text-pink-50" },
  { value: "indigo", class: "bg-indigo-500", textClass: "text-indigo-50" },
  { value: "teal", class: "bg-teal-500", textClass: "text-teal-50" },
  { value: "orange", class: "bg-orange-500", textClass: "text-orange-50" },
  { value: "cyan", class: "bg-cyan-500", textClass: "text-cyan-50" },
];

function getDefaultPort(type: DatabaseType): string {
  switch (type) {
    case "postgresql":
      return "5432";
    case "mysql":
    case "mariadb":
      return "3306";
    case "mssql":
      return "1433";
    case "sqlite":
      return "";
    case "mongodb":
      return "27017";
    case "redis":
      return "6379";
    default:
      return "";
  }
}

/**
 * Parse connection options from a multiline string
 * Format: key=value (one per line)
 * Example:
 *   charset=utf8mb4
 *   timezone=UTC
 */
function parseConnectionOptions(optionsStr: string): Record<string, string> {
  const options: Record<string, string> = {};
  if (!optionsStr.trim()) return options;

  for (const line of optionsStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // Skip empty lines and comments

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (key) {
        options[key] = value;
      }
    }
  }

  return options;
}

export function ConnectionForm() {
  const formMode = useHomeScreenStore((s) => s.formMode);
  const formConnectionId = useHomeScreenStore((s) => s.formConnectionId);
  const closeForm = useHomeScreenStore((s) => s.closeForm);

  const {
    saveConnection: persistConnection,
    updateConnection: persistUpdate,
    getConnection,
  } = useConnectionStore();

  const connection = formConnectionId ? getConnection(formConnectionId) : null;
  const isEditMode = formMode === "edit" && !!connection;

  // Form state
  const [dbType, setDbType] = useState<DatabaseType>(() => {
    if (connection) {
      const dbTypeMap: Record<string, DatabaseType> = {
        "0": "postgresql",
        "1": "mysql",
        "2": "sqlite",
        "3": "mssql",
        "4": "mariadb",
        "5": "mongodb",
        "6": "redis",
        postgresql: "postgresql",
        postgres: "postgresql",
        mysql: "mysql",
        mariadb: "mariadb",
        sqlite: "sqlite",
        mssql: "mssql",
        sqlserver: "mssql",
        mongodb: "mongodb",
        redis: "redis",
      };
      const key = String(connection.profile.db_type).toLowerCase();
      return dbTypeMap[key] || "postgresql";
    }
    return "postgresql";
  });
  const [name, setName] = useState(connection?.profile.name || "");
  const [host, setHost] = useState(connection?.profile.host || "localhost");
  const [port, setPort] = useState(
    connection?.profile.port.toString() || getDefaultPort(dbType),
  );
  const [username, setUsername] = useState(connection?.profile.username || "");
  const [password, setPassword] = useState(connection?.profile.password || "");
  const [database, setDatabase] = useState(connection?.profile.database || "");
  const [defaultSchema, setDefaultSchema] = useState(
    connection?.profile.default_schema || "",
  );
  const [sslMode, setSslMode] = useState<SslMode>(
    connection?.profile.ssl_mode || SslMode.Disable,
  );
  const [safeMode, setSafeMode] = useState<SafeMode>(
    connection?.profile.safe_mode || "full_access",
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (isEditMode && connection.metadata.tags) {
      return connection.metadata.tags;
    }
    return ["local"];
  });

  // Group tag management
  const [groupTags, setGroupTags] = useState<GroupTag[]>([]);
  const [tagsCommandOpen, setTagsCommandOpen] = useState(false);
  const [groupSearchValue, setGroupSearchValue] = useState("");

  // Load group tags from vault
  useEffect(() => {
    vaultStorage
      .listGroupTags()
      .then(setGroupTags)
      .catch((err) => {
        logger.error("Failed to load group tags", err);
      });
  }, []);

  // Workspace assignment state
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const getWorkspacesForConnection = useWorkspaceBundleStore(
    (s) => s.getWorkspacesForConnection,
  );
  const addConnectionToSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToSavedWorkspace,
  );
  const removeConnectionFromSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.removeConnectionFromSavedWorkspace,
  );
  const createWorkspace = useWorkspaceBundleStore((s) => s.createWorkspace);

  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>(
    () => {
      if (isEditMode && connection) {
        return getWorkspacesForConnection(connection.profile.id).map(
          (ws) => ws.id,
        );
      }
      const preselectedId =
        useHomeScreenStore.getState().formPreselectedWorkspaceId;
      if (preselectedId) {
        return [preselectedId];
      }
      return [];
    },
  );
  const [workspacesCommandOpen, setWorkspacesCommandOpen] = useState(false);
  const [workspaceSearchValue, setWorkspaceSearchValue] = useState("");

  // SSH tunnel state
  const existingSshTunnel = connection?.profile.ssh_tunnel;
  const [useSSH, setUseSSH] = useState(!!existingSshTunnel);
  const [sshHost, setSshHost] = useState(existingSshTunnel?.host || "");
  const [sshPort, setSshPort] = useState(
    existingSshTunnel?.port.toString() || "22",
  );
  const [sshUser, setSshUser] = useState(existingSshTunnel?.user || "");
  const [sshPassword, setSshPassword] = useState(
    existingSshTunnel?.auth && "Password" in existingSshTunnel.auth
      ? existingSshTunnel.auth.Password
      : "",
  );
  const [useSSHKey, setUseSSHKey] = useState(
    !!(existingSshTunnel?.auth && "KeyFile" in existingSshTunnel.auth),
  );
  const [sshKeyPath, setSshKeyPath] = useState(
    existingSshTunnel?.auth && "KeyFile" in existingSshTunnel.auth
      ? existingSshTunnel.auth.KeyFile.path
      : "",
  );
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState(
    existingSshTunnel?.auth && "KeyFile" in existingSshTunnel.auth
      ? existingSshTunnel.auth.KeyFile.passphrase || ""
      : "",
  );
  const [useSSHAgent, setUseSSHAgent] = useState(
    !!(existingSshTunnel?.auth && "Agent" in existingSshTunnel.auth),
  );

  // SSL certificates state
  const [sslKeyFile, _setSslKeyFile] = useState(
    connection?.profile.ssl_config?.key_file || "",
  );
  const [sslCertFile, _setSslCertFile] = useState(
    connection?.profile.ssl_config?.cert_file || "",
  );
  const [sslCAFile, _setSslCAFile] = useState(
    connection?.profile.ssl_config?.ca_file || "",
  );

  // Connection options state (e.g., charset=utf8mb4)
  const [connectionOptions, setConnectionOptions] = useState<string>(() => {
    if (connection?.profile.options) {
      return Object.entries(connection.profile.options)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }
    return "";
  });

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [uriParsed, setUriParsed] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const skipDefaultPortRef = useRef(false);

  // Update port when database type changes
  useEffect(() => {
    if (!connection) {
      if (skipDefaultPortRef.current) {
        skipDefaultPortRef.current = false;
        return;
      }
      setPort(getDefaultPort(dbType));
    }
  }, [dbType, connection]);

  useEffect(() => {
    if (useSSHAgent) {
      setUseSSHKey(false);
      setSshPassword("");
    }
  }, [useSSHAgent]);

  useEffect(() => {
    if (!useSSHKey) {
      setSshKeyPassphrase("");
    } else {
      setUseSSHAgent(false);
    }
  }, [useSSHKey]);

  const handleParseEnv = (text: string) => {
    try {
      const config = parseConnectionEnv(text);
      skipDefaultPortRef.current = Boolean(
        config.port && config.dbType && config.dbType !== dbType,
      );
      if (config.dbType) setDbType(config.dbType);
      if (config.host) setHost(config.host);
      if (config.port) setPort(config.port);
      if (config.username) setUsername(config.username);
      if (config.password) setPassword(config.password);
      if (config.database) {
        setDatabase(config.database);
        setName(config.database);
      }
      if (config.sslMode !== undefined) setSslMode(config.sslMode);

      setUriParsed(true);
      setTimeout(() => {
        setUriParsed(false);
      }, 3000);
    } catch (error) {
      toast.error("Invalid Environment Format", {
        description: error instanceof Error ? error.message : "Failed to parse",
      });
    }
  };

  const handleParseUri = (uri: string) => {
    try {
      const config = parseConnectionUri(uri);
      skipDefaultPortRef.current = Boolean(
        config.port && config.dbType && config.dbType !== dbType,
      );
      setDbType(config.dbType);
      if (config.host) setHost(config.host);
      if (config.port) setPort(config.port);
      if (config.username) setUsername(config.username);
      if (config.password) setPassword(config.password);
      if (config.database) {
        setDatabase(config.database);
        setName(config.database);
      }
      if (config.sslMode !== undefined) setSslMode(config.sslMode);

      // Set connection options from query parameters
      if (config.options && Object.keys(config.options).length > 0) {
        const optionsStr = Object.entries(config.options)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");
        setConnectionOptions(optionsStr);
      } else {
        setConnectionOptions("");
      }

      setUriParsed(true);
      setTimeout(() => {
        setUriParsed(false);
      }, 3000);
    } catch (error) {
      toast.error("Invalid URI", {
        description: error instanceof Error ? error.message : "Failed to parse",
      });
    }
  };

  const handlePasteUri = async () => {
    try {
      const text = await readText();
      if (text && text.trim()) {
        const trimmed = text.trim();
        const format = detectConnectionFormat(trimmed);
        if (format === "uri") {
          handleParseUri(trimmed);
        } else if (format === "env") {
          handleParseEnv(trimmed);
        } else {
          toast.error("Unknown Format");
        }
      } else {
        toast.error("Clipboard Empty");
      }
    } catch (error) {
      logger.error(error);
      toast.error("Clipboard Access Failed");
    }
  };

  const handleBrowseFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "SQLite Database",
            extensions: ["db", "sqlite", "sqlite3"],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        setDatabase(selected);
        // If name is empty, try to set it from filename
        if (!name) {
          const fileName = selected.split(/[/\\]/).pop();
          if (fileName) {
            setName(fileName);
          }
        }
      }
    } catch (error) {
      logger.error("Failed to open file dialog:", error);
      toast.error("Failed to open file picker");
    }
  };

  const handleTagToggle = (tagName: string) => {
    const isEnvironmentTag = ENVIRONMENT_TAGS.some((t) => t.name === tagName);
    const isGroupTag = groupTags.some((t) => t.name === tagName);

    if (selectedTags.includes(tagName)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      let newTags = [...selectedTags];

      if (isEnvironmentTag) {
        const currentEnvTag = selectedTags.find((t) =>
          ENVIRONMENT_TAGS.some((env) => env.name === t),
        );
        if (currentEnvTag) {
          newTags = newTags.filter((t) => t !== currentEnvTag);
        }
      }

      if (isGroupTag) {
        const currentGroupTag = selectedTags.find((t) =>
          groupTags.some((g) => g.name === t),
        );
        if (currentGroupTag) {
          newTags = newTags.filter((t) => t !== currentGroupTag);
        }
      }

      newTags.push(tagName);
      setSelectedTags(newTags);
    }
  };

  const handleCreateGroup = async (groupName: string) => {
    if (!groupName.trim()) return;

    const exists = groupTags.some((t) => t.name === groupName);
    if (exists) {
      toast.error("Group already exists");
      return;
    }

    const colorPool = TAG_COLORS;
    const randomColor = colorPool[Math.floor(Math.random() * colorPool.length)];
    const color = randomColor?.class || "bg-gray-500";

    const newGroup: GroupTag = { name: groupName.trim(), color };
    await vaultStorage.storeGroupTag(newGroup);
    const updated = await vaultStorage.listGroupTags();
    setGroupTags(updated);
    handleTagToggle(groupName);
    setTagsCommandOpen(false);
    setGroupSearchValue("");
  };

  const getTagColor = (tagName: string, isGroup: boolean = false) => {
    if (!isGroup) {
      const envTag = ENVIRONMENT_TAGS.find((t) => t.name === tagName);
      if (envTag) return { bg: envTag.color, text: envTag.textColor };
    } else {
      const groupTag = groupTags.find((t) => t.name === tagName);
      if (groupTag) {
        const colorObj = TAG_COLORS.find((c) => c.class === groupTag.color);
        return {
          bg: groupTag.color,
          text: colorObj?.textClass || "text-white",
        };
      }
    }
    return { bg: "bg-gray-500", text: "text-gray-50" };
  };

  const buildConnectionProfile = (idOverride?: string): ConnectionProfile => {
    const resolvedId =
      idOverride ?? connection?.profile.id ?? `conn-${Date.now()}`;

    const profile: ConnectionProfile = {
      id: resolvedId,
      name,
      db_type:
        dbType === "postgresql"
          ? DbType.PostgreSQL
          : dbType === "mysql"
            ? DbType.MySQL
            : dbType === "mariadb"
              ? DbType.MariaDB
              : dbType === "sqlite"
                ? DbType.SQLite
                : dbType === "mongodb"
                  ? DbType.MongoDB
                  : dbType === "redis"
                    ? DbType.Redis
                    : DbType.SQLServer,
      host: dbType !== "sqlite" ? host : "localhost",
      port:
        dbType !== "sqlite"
          ? parseInt(port, 10) || parseInt(getDefaultPort(dbType), 10)
          : 5432,
      username: dbType !== "sqlite" ? username : "",
      password: dbType !== "sqlite" ? password || undefined : undefined,
      database,
      ssl_mode: sslMode,
      ssl_config:
        sslMode !== SslMode.Disable && (sslKeyFile || sslCertFile || sslCAFile)
          ? {
              key_file: sslKeyFile || undefined,
              cert_file: sslCertFile || undefined,
              ca_file: sslCAFile || undefined,
            }
          : undefined,
      ssh_tunnel: undefined,
      bastion: undefined,
      options: parseConnectionOptions(connectionOptions),
      default_schema: defaultSchema || undefined,
      safe_mode: safeMode,
    };

    if (useSSH) {
      const auth = useSSHAgent
        ? { Agent: true as const }
        : useSSHKey
          ? {
              KeyFile: {
                path: sshKeyPath,
                passphrase: sshKeyPassphrase || undefined,
              },
            }
          : { Password: sshPassword };

      profile.ssh_tunnel = {
        host: sshHost,
        port: parseInt(sshPort, 10) || 22,
        user: sshUser,
        auth,
      };
      profile.bastion = { Ssh: profile.ssh_tunnel };
    }

    return profile;
  };

  const syncWorkspaceMemberships = async (connectionId: string) => {
    const currentWorkspaces = getWorkspacesForConnection(connectionId);
    const currentWorkspaceIds = new Set(currentWorkspaces.map((ws) => ws.id));
    const selectedIds = new Set(selectedWorkspaceIds);

    for (const wsId of selectedWorkspaceIds) {
      if (!currentWorkspaceIds.has(wsId)) {
        await addConnectionToSavedWorkspace(wsId, connectionId);
      }
    }

    for (const ws of currentWorkspaces) {
      if (!selectedIds.has(ws.id)) {
        await removeConnectionFromSavedWorkspace(ws.id, connectionId);
      }
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestSuccess(false);

    try {
      const profile = buildConnectionProfile(`test-${Date.now()}`);
      const { invoke } = await import("@tauri-apps/api/core");

      const connectionInfo = await invoke<{ id: string }>("connect", {
        profile,
      });
      const testResult = await invoke<{ success: boolean; message: string }>(
        "test_connection",
        { connId: connectionInfo.id },
      );
      await invoke("disconnect", { connId: connectionInfo.id });

      if (testResult.success) {
        setTestSuccess(true);
        setTimeout(() => {
          setTestSuccess(false);
        }, 3000);
      } else {
        toast.error("Connection Failed", { description: testResult.message });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";
      toast.error("Connection Failed", { description: errorMessage });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Error", { description: "Please provide a connection name" });
      return;
    }

    setIsSaving(true);
    try {
      const profile = buildConnectionProfile(connection?.profile.id);

      if (isEditMode && connection.profile.id) {
        await persistUpdate(connection.profile.id, profile, selectedTags);
      } else {
        await persistConnection(profile, selectedTags);
      }

      await syncWorkspaceMemberships(profile.id);

      toast.success("Success", {
        description: isEditMode
          ? "Connection updated successfully"
          : "Connection saved successfully",
      });

      closeForm();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save connection";
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnect = async () => {
    if (!name.trim()) {
      toast.error("Error", { description: "Please provide a connection name" });
      return;
    }

    setIsConnecting(true);
    try {
      const profile = buildConnectionProfile(connection?.profile.id);

      if (isEditMode && connection.profile.id) {
        await persistUpdate(connection.profile.id, profile, selectedTags);
      } else {
        await persistConnection(profile, selectedTags);
      }

      await syncWorkspaceMemberships(profile.id);

      closeForm();

      await windowManager.openWorkspace(profile.id, profile.name, {
        database: profile.database,
      });
    } catch (error) {
      toast.error("Error", {
        description:
          error instanceof Error ? error.message : "Failed to connect",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const dbTypeOptions = [
    {
      value: "postgresql",
      label: "PostgreSQL",
      logo: getDatabaseLogo(DbType.PostgreSQL),
    },
    { value: "mysql", label: "MySQL", logo: getDatabaseLogo(DbType.MySQL) },
    {
      value: "mariadb",
      label: "MariaDB",
      logo: getDatabaseLogo(DbType.MariaDB),
    },
    { value: "sqlite", label: "SQLite", logo: getDatabaseLogo(DbType.SQLite) },
    {
      value: "mssql",
      label: "SQL Server",
      logo: getDatabaseLogo(DbType.SQLServer),
    },
    {
      value: "mongodb",
      label: "MongoDB",
      logo: getDatabaseLogo(DbType.MongoDB),
    },
    { value: "redis", label: "Redis", logo: getDatabaseLogo(DbType.Redis) },
  ];

  const currentDbType = dbTypeOptions.find((opt) => opt.value === dbType);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-2"
          onClick={closeForm}
        >
          <IconArrowLeft className="h-4 w-4" />
          <span className="text-xs font-semibold">
            {isEditMode
              ? "Edit Connection"
              : formMode === "import"
                ? "Import Connection"
                : "New Connection"}
          </span>
        </Button>

        <Select
          value={dbType}
          onValueChange={(v) => {
            setDbType(v as DatabaseType);
          }}
        >
          <SelectTrigger>
            <div className="flex items-center gap-2">
              <img
                src={currentDbType?.logo}
                alt={currentDbType?.label}
                className="h-4 w-4"
              />
              <span>{currentDbType?.label}</span>
            </div>
            <SelectValue>{currentDbType?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {dbTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                <div className="flex items-center gap-2">
                  <img src={opt.logo} alt={opt.label} className="h-3.5 w-3.5" />
                  {opt.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Form Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          {/* Name, Workspace, and Tags */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="name" className="text-xs">
                Name
              </Label>
              <Input
                id="name"
                className="mt-1 h-8 text-xs"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder={`My ${dbType} Database`}
                disabled={isTesting}
              />
            </div>
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <IconLayout2 className="h-3 w-3 text-muted-foreground" />
                Workspace
              </Label>
              <Popover
                open={workspacesCommandOpen}
                onOpenChange={setWorkspacesCommandOpen}
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between mt-1 h-8 text-xs"
                      disabled={isTesting}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                        {selectedWorkspaceIds.length > 0 ? (
                          <span className="truncate">
                            {selectedWorkspaceIds
                              .map(
                                (id) =>
                                  savedWorkspaces.find((ws) => ws.id === id)
                                    ?.name || id,
                              )
                              .join(", ")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            No workspaces
                          </span>
                        )}
                      </div>
                      <IconChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                    </Button>
                  }
                />
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput
                      placeholder="Search or create workspace..."
                      value={workspaceSearchValue}
                      onValueChange={setWorkspaceSearchValue}
                      className="text-xs h-8"
                    />
                    <CommandList>
                      <CommandEmpty>
                        <div className="py-2 text-center">
                          <p className="text-xs text-muted-foreground mb-2">
                            No workspace found.
                          </p>
                          {workspaceSearchValue && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void (async () => {
                                  const wsId = await createWorkspace(
                                    workspaceSearchValue.trim(),
                                    [],
                                  );
                                  setSelectedWorkspaceIds((prev) => [
                                    ...prev,
                                    wsId,
                                  ]);
                                  setWorkspacesCommandOpen(false);
                                  setWorkspaceSearchValue("");
                                })();
                              }}
                              className="gap-1.5 h-6 px-2 text-xs"
                            >
                              <IconPlus className="h-3 w-3" />
                              Create "{workspaceSearchValue}"
                            </Button>
                          )}
                        </div>
                      </CommandEmpty>

                      {savedWorkspaces.length > 0 && (
                        <CommandGroup heading="Workspaces" className="text-xs">
                          {savedWorkspaces.map((ws) => (
                            <CommandItem
                              key={ws.id}
                              value={ws.name}
                              onSelect={() => {
                                setSelectedWorkspaceIds((prev) =>
                                  prev.includes(ws.id)
                                    ? prev.filter((id) => id !== ws.id)
                                    : [...prev, ws.id],
                                );
                              }}
                              className="flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <IconLayout2 className="h-3 w-3 text-muted-foreground" />
                                <span>{ws.name}</span>
                              </div>
                              {selectedWorkspaceIds.includes(ws.id) && (
                                <IconCheck className="h-3 w-3" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      {workspaceSearchValue &&
                        !savedWorkspaces.some(
                          (ws) =>
                            ws.name.toLowerCase() ===
                            workspaceSearchValue.toLowerCase(),
                        ) && (
                          <CommandGroup>
                            <CommandItem
                              value={`create-${workspaceSearchValue}`}
                              onSelect={() => {
                                void (async () => {
                                  const wsId = await createWorkspace(
                                    workspaceSearchValue.trim(),
                                    [],
                                  );
                                  setSelectedWorkspaceIds((prev) => [
                                    ...prev,
                                    wsId,
                                  ]);
                                  setWorkspacesCommandOpen(false);
                                  setWorkspaceSearchValue("");
                                })();
                              }}
                              className="text-xs"
                            >
                              <IconPlus className="h-3 w-3 mr-2" />
                              Create "{workspaceSearchValue}"
                            </CommandItem>
                          </CommandGroup>
                        )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor="tags" className="text-xs">
                Tags
              </Label>
              <Popover open={tagsCommandOpen} onOpenChange={setTagsCommandOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-full justify-between mt-1 h-8 text-xs"
                      disabled={isTesting}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {selectedTags.length > 0 ? (
                          selectedTags.map((tag) => {
                            const isGroup = groupTags.some(
                              (g) => g.name === tag,
                            );
                            const tagColor = getTagColor(tag, isGroup);
                            return (
                              <div
                                key={tag}
                                className="flex items-center gap-1.5"
                              >
                                <div
                                  className={cn(
                                    "w-2 h-2 rounded-full shrink-0",
                                    tagColor.bg,
                                  )}
                                />
                                <span className="text-xs truncate max-w-[80px]">
                                  {tag}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Select tags...
                          </span>
                        )}
                      </div>
                      <IconChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                    </Button>
                  }
                />
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput
                      placeholder="Search or create group..."
                      value={groupSearchValue}
                      onValueChange={setGroupSearchValue}
                      className="text-xs h-8"
                    />
                    <CommandList>
                      <CommandEmpty>
                        <div className="py-2 text-center">
                          <p className="text-xs text-muted-foreground mb-2">
                            No group found.
                          </p>
                          {groupSearchValue && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                handleCreateGroup(groupSearchValue);
                              }}
                              className="gap-1.5 h-6 px-2 text-xs"
                            >
                              <IconPlus className="h-3 w-3" />
                              Create "{groupSearchValue}"
                            </Button>
                          )}
                        </div>
                      </CommandEmpty>

                      <CommandGroup heading="Environment" className="text-xs">
                        {ENVIRONMENT_TAGS.map((t) => (
                          <CommandItem
                            key={t.name}
                            value={t.name}
                            onSelect={() => {
                              handleTagToggle(t.name);
                            }}
                            className="flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={cn("w-2 h-2 rounded-full", t.color)}
                              />
                              <span>{t.name}</span>
                            </div>
                            {selectedTags.includes(t.name) && (
                              <IconCheck className="h-3 w-3" />
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>

                      {groupTags.length > 0 && (
                        <CommandGroup heading="Groups" className="text-xs">
                          {groupTags.map((t) => (
                            <CommandItem
                              key={t.name}
                              value={t.name}
                              onSelect={() => {
                                handleTagToggle(t.name);
                              }}
                              className="flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    "w-2 h-2 rounded-full",
                                    t.color,
                                  )}
                                />
                                <span>{t.name}</span>
                              </div>
                              {selectedTags.includes(t.name) && (
                                <IconCheck className="h-3 w-3" />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}

                      {groupSearchValue &&
                        !groupTags.some(
                          (t) =>
                            t.name.toLowerCase() ===
                            groupSearchValue.toLowerCase(),
                        ) && (
                          <CommandGroup>
                            <CommandItem
                              value={groupSearchValue}
                              onSelect={() => {
                                handleCreateGroup(groupSearchValue);
                              }}
                              className="text-xs"
                            >
                              <IconPlus className="h-3 w-3 mr-2" />
                              Create "{groupSearchValue}"
                            </CommandItem>
                          </CommandGroup>
                        )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Connection Details */}
          {dbType !== "sqlite" ? (
            <>
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-8">
                  <Label htmlFor="host" className="text-xs">
                    Host/Socket
                  </Label>
                  <Input
                    id="host"
                    className="mt-1 h-8 text-xs"
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                    }}
                    placeholder="127.0.0.1"
                    disabled={isTesting}
                  />
                </div>
                <div className="col-span-4">
                  <Label htmlFor="port" className="text-xs">
                    Port
                  </Label>
                  <Input
                    id="port"
                    className="mt-1 h-8 text-xs"
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value);
                    }}
                    placeholder={getDefaultPort(dbType)}
                    disabled={isTesting}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="username" className="text-xs">
                    User
                  </Label>
                  <Input
                    id="username"
                    className="mt-1 h-8 text-xs"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                    }}
                    placeholder="username"
                    disabled={isTesting}
                  />
                </div>
                <div>
                  <Label htmlFor="password" className="text-xs">
                    Password
                  </Label>
                  <Input
                    id="password"
                    className="mt-1 h-8 text-xs"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                    placeholder="password"
                    disabled={isTesting}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="database" className="text-xs">
                    Database
                  </Label>
                  <Input
                    id="database"
                    className="mt-1 h-8 text-xs"
                    value={database}
                    onChange={(e) => {
                      setDatabase(e.target.value);
                    }}
                    placeholder="database name"
                    disabled={isTesting}
                  />
                </div>
                {(dbType === "postgresql" || dbType === "mssql") && (
                  <div>
                    <Label htmlFor="defaultSchema" className="text-xs">
                      Default Schema
                    </Label>
                    <Input
                      id="defaultSchema"
                      className="mt-1 h-8 text-xs"
                      value={defaultSchema}
                      onChange={(e) => {
                        setDefaultSchema(e.target.value);
                      }}
                      placeholder={dbType === "postgresql" ? "public" : "dbo"}
                      disabled={isTesting}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="database" className="text-xs">
                Database File
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="database"
                  className="h-8 text-xs flex-1"
                  value={database}
                  onChange={(e) => {
                    setDatabase(e.target.value);
                  }}
                  placeholder="/path/to/database.db"
                  disabled={isTesting}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void handleBrowseFile()}
                  disabled={isTesting}
                  title="Browse file"
                >
                  <IconFolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* SSL Mode */}
          {dbType !== "sqlite" && (
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <IconShield className="h-3 w-3 text-muted-foreground" />
                SSL Mode
              </Label>
              <RadioGroup
                value={sslMode}
                onValueChange={(value) => {
                  setSslMode(value as SslMode);
                }}
                className="mt-2 grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {[
                  { value: SslMode.Disable, label: "Disable" },
                  { value: SslMode.Require, label: "Require" },
                  { value: SslMode.VerifyCa, label: "Verify CA" },
                  { value: SslMode.VerifyFull, label: "Verify Full" },
                ].map((option) => {
                  const id = `ssl-mode-${option.value}`;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={id}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                        sslMode === option.value && "text-primary",
                      )}
                    >
                      <RadioGroupItem id={id} value={option.value} />
                      {option.label}
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>
          )}

          {/* Safe Mode */}
          <div>
            <Label className="flex items-center gap-1.5 text-xs">
              <IconShield className="h-3 w-3 text-muted-foreground" />
              Safe Mode
            </Label>
            <Select
              value={safeMode}
              onValueChange={(value) => setSafeMode(value as SafeMode)}
            >
              <SelectTrigger className="mt-2 h-8 text-xs">
                <SelectValue placeholder="Select safe mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_access">Full Access</SelectItem>
                <SelectItem value="read_write_update">Read + Write + Update</SelectItem>
                <SelectItem value="read_write">Read + Write</SelectItem>
                <SelectItem value="read_only">Read Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Connection Options */}
          {dbType !== "sqlite" && (
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                Connection Options
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconInfoCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    }
                  />
                  <TooltipContent side="top" className="max-w-[300px]">
                    <p className="font-medium mb-1">
                      Optional connection parameters
                    </p>
                    <p className="mb-2">One per line, format: key=value</p>
                    <div className="text-xs font-mono bg-muted/50 p-1.5 rounded">
                      {(dbType === "mysql" || dbType === "mariadb") && (
                        <>
                          charset=utf8mb4
                          <br />
                          timezone=UTC
                        </>
                      )}
                      {dbType === "postgresql" && (
                        <>
                          application_name=QueryPilot
                          <br />
                          connect_timeout=10
                        </>
                      )}
                      {dbType === "mssql" && (
                        <>
                          application_name=QueryPilot
                          <br />
                          trust_cert=true
                        </>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <textarea
                className="mt-1 w-full h-16 text-xs px-2 py-1.5 border rounded-md bg-background resize-none font-mono"
                value={connectionOptions}
                onChange={(e) => {
                  setConnectionOptions(e.target.value);
                }}
                placeholder={
                  dbType === "mysql" || dbType === "mariadb"
                    ? "charset=utf8mb4\ntimezone=UTC"
                    : dbType === "mssql"
                      ? "application_name=QueryPilot"
                      : "application_name=QueryPilot"
                }
                disabled={isTesting}
              />
            </div>
          )}

          {/* SSH Tunnel */}
          {dbType !== "sqlite" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs">
                  <IconServer className="h-3 w-3 text-muted-foreground" />
                  SSH Tunnel
                </Label>
                <Switch checked={useSSH} onCheckedChange={setUseSSH} />
              </div>

              {useSSH && (
                <>
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-8">
                      <Label htmlFor="ssh-host" className="text-xs">
                        SSH IconServer
                      </Label>
                      <Input
                        id="ssh-host"
                        className="mt-1 h-8 text-xs"
                        value={sshHost}
                        onChange={(e) => {
                          setSshHost(e.target.value);
                        }}
                        placeholder="192.168.1.1"
                      />
                    </div>
                    <div className="col-span-4">
                      <Label htmlFor="ssh-port" className="text-xs">
                        Port
                      </Label>
                      <Input
                        id="ssh-port"
                        className="mt-1 h-8 text-xs"
                        value={sshPort}
                        onChange={(e) => {
                          setSshPort(e.target.value);
                        }}
                        placeholder="22"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="ssh-user" className="text-xs">
                        SSH User
                      </Label>
                      <Input
                        id="ssh-user"
                        className="mt-1 h-8 text-xs"
                        value={sshUser}
                        onChange={(e) => {
                          setSshUser(e.target.value);
                        }}
                        placeholder="username"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ssh-password" className="text-xs">
                        SSH Password
                      </Label>
                      <Input
                        id="ssh-password"
                        className="mt-1 h-8 text-xs"
                        type="password"
                        value={sshPassword}
                        onChange={(e) => {
                          setSshPassword(e.target.value);
                        }}
                        placeholder="password"
                        disabled={useSSHKey || useSSHAgent}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="use-ssh-agent"
                        checked={useSSHAgent}
                        onCheckedChange={(checked) => {
                          setUseSSHAgent(!!checked);
                        }}
                      />
                      <Label
                        htmlFor="use-ssh-agent"
                        className="cursor-pointer text-xs"
                      >
                        Use SSH Agent
                      </Label>
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="use-ssh-key"
                        checked={useSSHKey}
                        disabled={useSSHAgent}
                        onCheckedChange={(checked) => {
                          setUseSSHKey(!!checked);
                        }}
                      />
                      <Label
                        htmlFor="use-ssh-key"
                        className={cn(
                          "cursor-pointer text-xs",
                          useSSHAgent && "text-muted-foreground",
                        )}
                      >
                        Use SSH IconKey
                      </Label>
                    </div>

                    {useSSHKey && (
                      <>
                        <div>
                          <Label htmlFor="ssh-key" className="text-xs">
                            Private IconKey
                          </Label>
                          <Input
                            id="ssh-key"
                            className="mt-1 h-8 text-xs"
                            value={sshKeyPath}
                            onChange={(e) => {
                              setSshKeyPath(e.target.value);
                            }}
                            placeholder="~/.ssh/id_rsa"
                          />
                        </div>
                        <div>
                          <Label
                            htmlFor="ssh-key-passphrase"
                            className="text-xs"
                          >
                            IconKey Passphrase
                          </Label>
                          <Input
                            id="ssh-key-passphrase"
                            className="mt-1 h-8 text-xs"
                            type="password"
                            value={sshKeyPassphrase}
                            onChange={(e) => {
                              setSshKeyPassphrase(e.target.value);
                            }}
                            placeholder="Optional"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-border">
        <div
          role="button"
          tabIndex={0}
          onClick={() => void handlePasteUri()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void handlePasteUri();
            }
          }}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 px-2.5 cursor-pointer select-none",
            uriParsed && "text-green-600!",
          )}
        >
          {uriParsed ? (
            <>
              <IconClipboardCheck className="h-3 w-3" />
              Parsed
            </>
          ) : (
            <>
              <IconClipboardText className="h-3 w-3" />
              Paste Config
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting || isSaving || isConnecting}
            className={cn(
              "h-7 px-2.5 text-xs",
              testSuccess && "text-green-600!",
            )}
          >
            {isTesting ? (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Testing...
              </>
            ) : testSuccess ? (
              <>
                <IconCircleCheckFilled className="mr-1.5 h-3 w-3" />
                Tested
              </>
            ) : (
              "Test"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isConnecting || isTesting}
            className="h-7 px-2.5 text-xs"
          >
            {isSaving ? (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting || isSaving || isTesting}
            className="h-7 px-3 text-xs"
          >
            {isConnecting ? (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Connecting...
              </>
            ) : (
              "Connect"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
