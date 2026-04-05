import { logger } from "@/lib/logger";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
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
  IconPlus,
  IconCheck,
  IconClipboardText,
  IconClipboardCheck,
  IconArrowLeft,
  IconInfoCircle,
  IconFolderOpen,
  IconLayout2,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
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
import {
  extractConnectionErrorMessage,
  getSslModeOptionsForDb,
  normalizeSslModeForDb,
  supportsSslKeyFiles,
  validateSslInputs,
  validateSshTunnelInputs,
} from "./connectionFormHelpers";
import { ENV_COLORS, ENV_KEYS } from "@/lib/envColors";
import { TunnelSection, type TunnelMode } from "./TunnelSection";

const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
const { open, save } = await import("@tauri-apps/plugin-dialog");

// Environment tags derived from the shared color definitions
const ENVIRONMENT_TAGS = ENV_KEYS.map((key) => ({
  name: key,
  color: ENV_COLORS[key].solid,
  textColor: ENV_COLORS[key].solidText,
}));

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
    case "oracle":
      return "1521";
    case "sqlite":
    case "duckdb":
      return "";
    case "mongodb":
      return "27017";
    case "redis":
      return "6379";
    case "trino":
      return "8080";
    default:
      return "";
  }
}

function isFileBasedDbType(type: DatabaseType): boolean {
  return type === "sqlite" || type === "duckdb";
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
        "7": "oracle",
        "8": "duckdb",
        postgresql: "postgresql",
        postgres: "postgresql",
        mysql: "mysql",
        mariadb: "mariadb",
        sqlite: "sqlite",
        duckdb: "duckdb",
        mssql: "mssql",
        sqlserver: "mssql",
        oracle: "oracle",
        mongodb: "mongodb",
        redis: "redis",
        trino: "trino",
      };
      const key = connection.profile.db_type.toString().toLowerCase();
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
  const [safeMode, setSafeMode] = useState<SafeMode>(() => {
    if (connection?.profile.safe_mode) return connection.profile.safe_mode;
    return "full_access";
  });
  const [poolerMode, setPoolerMode] = useState<
    "auto" | "enabled" | "disabled"
  >(() => {
    if (connection?.profile.pooler_mode === true) {
      return "enabled";
    }
    if (connection?.profile.pooler_mode === false) {
      return "disabled";
    }
    return "auto";
  });
  const sslModeOptions = getSslModeOptionsForDb(dbType);
  const showsSslKeyFiles = supportsSslKeyFiles(dbType);
  const sslModeGridClassName = "mt-2 flex flex-wrap gap-x-4 gap-y-1";
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
      .catch((err: unknown) => {
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
      if (isEditMode && connection.profile.id) {
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

  // Tunnel state
  const [tunnelMode, setTunnelMode] = useState<TunnelMode>(() => {
    if (connection?.profile.tunnel_profile_id) return "profile";
    if (connection?.profile.tunnel_inline) return "ssm";
    if (connection?.profile.ssh_tunnel) return "ssh";
    return "none";
  });
  const [ssmAuthProfileId, setSsmAuthProfileId] = useState(
    connection?.profile.tunnel_inline?.auth_profile_id || "",
  );
  const [ssmRegion, setSsmRegion] = useState(() => {
    const inline = connection?.profile.tunnel_inline;
    if (inline && "SsmBastion" in inline.tunnel_type) {
      return inline.tunnel_type.SsmBastion.region;
    }
    return "ap-southeast-2";
  });
  const [tunnelRemoteHost, setTunnelRemoteHost] = useState(
    connection?.profile.tunnel_remote_host || "",
  );
  const [tunnelRemotePort, setTunnelRemotePort] = useState(
    connection?.profile.tunnel_remote_port?.toString() || "",
  );
  const [tunnelProfileId, setTunnelProfileId] = useState(
    connection?.profile.tunnel_profile_id || "",
  );
  const [saveAsTunnelProfile, setSaveAsTunnelProfile] = useState(false);

  // SSH tunnel state
  const existingSshTunnel = connection?.profile.ssh_tunnel;
  const useSSH = tunnelMode === "ssh";
  const setUseSSH = (v: boolean) => {
    setTunnelMode(v ? "ssh" : "none");
  };
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
  const [sslKeyFile, setSslKeyFile] = useState(
    connection?.profile.ssl_config?.key_file || "",
  );
  const [sslCertFile, setSslCertFile] = useState(
    connection?.profile.ssl_config?.cert_file || "",
  );
  const [sslCAFile, setSslCAFile] = useState(
    connection?.profile.ssl_config?.ca_file || "",
  );

  // Oracle-specific state
  const existingOptions = connection?.profile.options;
  const [oracleConnectMode, setOracleConnectMode] = useState<string>(() => {
    return existingOptions?.oracle_connect_mode || "service_name";
  });
  const [oracleSid, setOracleSid] = useState(
    existingOptions?.oracle_sid || "",
  );
  const [oracleTnsAlias, setOracleTnsAlias] = useState(
    existingOptions?.oracle_tns_alias || "",
  );
  const [oracleConnectString, setOracleConnectString] = useState(
    existingOptions?.oracle_connect_string || "",
  );
  const [oracleWalletDir, setOracleWalletDir] = useState(
    existingOptions?.oracle_wallet_dir || "",
  );

  // Connection options state (e.g., charset=utf8mb4)
  // Filter out Oracle-specific keys so they don't appear in the generic textarea
  const oracleOptionKeys = new Set([
    "oracle_connect_mode",
    "oracle_sid",
    "oracle_tns_alias",
    "oracle_connect_string",
    "oracle_wallet_dir",
  ]);
  const [connectionOptions, setConnectionOptions] = useState<string>(() => {
    if (connection?.profile.options) {
      return Object.entries(connection.profile.options)
        .filter(([k]) => !oracleOptionKeys.has(k))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    }
    return "";
  });

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [uriParsed, setUriParsed] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const skipDefaultPortRef = useRef(false);

  // Oracle driver availability check
  const [oracleDriverAvailable, setOracleDriverAvailable] = useState<
    boolean | null
  >(null);
  const openPreferences = usePreferencesStore((s) => s.openPreferences);

  useEffect(() => {
    if (dbType !== "oracle") {
      setOracleDriverAvailable(null);
      return;
    }
    let cancelled = false;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<{ available: boolean; reason?: string }>(
        "check_oracle_client",
      ).then((result) => {
        if (!cancelled) setOracleDriverAvailable(result.available);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [dbType]);

  const isOracleDriverMissing = dbType === "oracle" && oracleDriverAvailable === false;

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
    const normalizedMode = normalizeSslModeForDb(dbType, sslMode);
    if (normalizedMode !== sslMode) {
      setSslMode(normalizedMode);
    }
  }, [dbType, sslMode]);

  useEffect(() => {
    if (!connection && dbType === "trino") {
      setSafeMode("read_only");
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
      if (config.sslKeyFile !== undefined) setSslKeyFile(config.sslKeyFile);
      if (config.sslCertFile !== undefined) setSslCertFile(config.sslCertFile);
      if (config.sslCAFile !== undefined) setSslCAFile(config.sslCAFile);

      // SSH tunnel
      if (config.useSSH) {
        setUseSSH(true);
        if (config.sshHost) setSshHost(config.sshHost);
        if (config.sshPort) setSshPort(config.sshPort);
        if (config.sshUser) setSshUser(config.sshUser);
        if (config.sshPassword) setSshPassword(config.sshPassword);
        if (config.useSSHKey) {
          setUseSSHKey(true);
          if (config.sshKeyPath) setSshKeyPath(config.sshKeyPath);
        }
      }

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
        config.port && config.dbType !== dbType,
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

      const remainingOptions: Record<string, string> = {};
      let parsedDefaultSchema: string | undefined;
      if (config.options && Object.keys(config.options).length > 0) {
        for (const [key, value] of Object.entries(config.options)) {
          const normalized = key.toLowerCase().replace(/[\s-]+/g, "_");

          if (normalized === "default_schema") {
            parsedDefaultSchema = value;
            continue;
          }

          if (
            [
              "sslkey",
              "ssl_key",
              "sslkeyfile",
              "ssl_key_file",
              "keyfile",
              "key_file",
            ].includes(normalized)
          ) {
            setSslKeyFile(value);
            continue;
          }

          if (
            [
              "sslcert",
              "ssl_cert",
              "sslcertfile",
              "ssl_cert_file",
              "certfile",
              "cert_file",
            ].includes(normalized)
          ) {
            setSslCertFile(value);
            continue;
          }

          if (
            [
              "sslrootcert",
              "ssl_root_cert",
              "sslca",
              "ssl_ca",
              "sslcafile",
              "ssl_ca_file",
              "cafile",
              "ca_file",
            ].includes(normalized)
          ) {
            setSslCAFile(value);
            continue;
          }

          remainingOptions[key] = value;
        }
      }

      if (config.dbType === "trino") {
        setDefaultSchema(parsedDefaultSchema ?? "");
      }

      // Set connection options from query parameters
      if (Object.keys(remainingOptions).length > 0) {
        const optionsStr = Object.entries(remainingOptions)
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
            name: dbType === "duckdb" ? "DuckDB Scratchpad" : "SQLite Database",
            extensions:
              dbType === "duckdb"
                ? ["duckdb", "ddb"]
                : ["db", "sqlite", "sqlite3"],
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

  const handleCreateScratchpad = async () => {
    try {
      const selected = await save({
        filters: [
          {
            name: "DuckDB Scratchpad",
            extensions: ["duckdb"],
          },
        ],
        defaultPath: name.trim() ? `${name.trim()}.duckdb` : "scratchpad.duckdb",
      });

      if (selected && typeof selected === "string") {
        setDatabase(selected);
        if (!name) {
          const fileName = selected.split(/[/\\]/).pop();
          if (fileName) {
            setName(fileName.replace(/\.duckdb$/i, ""));
          }
        }
      }
    } catch (error) {
      logger.error("Failed to open scratchpad save dialog:", error);
      toast.error("Failed to create scratchpad path");
    }
  };

  const handleBrowseSshKey = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        setSshKeyPath(selected);
      }
    } catch (error) {
      logger.error("Failed to open file dialog:", error);
      toast.error("Failed to open file picker");
    }
  };

  const handleBrowseSslFile = async (target: "key" | "cert" | "ca") => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Certificate Files",
            extensions: ["pem", "crt", "cer", "key", "der", "p12", "pfx"],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        if (target === "key") {
          setSslKeyFile(selected);
        } else if (target === "cert") {
          setSslCertFile(selected);
        } else {
          setSslCAFile(selected);
        }
      }
    } catch (error) {
      logger.error("Failed to open SSL file dialog:", error);
      toast.error("Failed to open file picker");
    }
  };

  const clearSslFiles = () => {
    setSslKeyFile("");
    setSslCertFile("");
    setSslCAFile("");
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
          text: colorObj?.textClass || "text-foreground",
        };
      }
    }
    return { bg: "bg-gray-500", text: "text-gray-50" };
  };

  const buildConnectionProfile = (idOverride?: string): ConnectionProfile => {
    const resolvedId =
      idOverride ?? connection?.profile.id ?? `conn-${Date.now()}`;
    const isFileBased = isFileBasedDbType(dbType);

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
                : dbType === "oracle"
                  ? DbType.Oracle
                : dbType === "duckdb"
                  ? DbType.DuckDB
                : dbType === "mongodb"
                  ? DbType.MongoDB
                  : dbType === "redis"
                    ? DbType.Redis
                    : dbType === "trino"
                      ? DbType.Trino
                      : DbType.SQLServer,
      host: !isFileBased ? host : "localhost",
      port:
        !isFileBased
          ? parseInt(port, 10) || parseInt(getDefaultPort(dbType), 10)
          : 5432,
      username: !isFileBased ? username : "",
      password: !isFileBased ? password || undefined : undefined,
      database,
      ssl_mode: sslMode,
      ssl_config:
        showsSslKeyFiles &&
        sslMode !== SslMode.Disable &&
        (sslKeyFile || sslCertFile || sslCAFile)
          ? {
              key_file: sslKeyFile || undefined,
              cert_file: sslCertFile || undefined,
              ca_file: sslCAFile || undefined,
            }
          : undefined,
      ssh_tunnel: undefined,
      bastion: undefined,
      options: {
        ...parseConnectionOptions(connectionOptions),
        ...(dbType === "oracle"
          ? {
              oracle_connect_mode: oracleConnectMode,
              ...(oracleConnectMode === "sid" && oracleSid
                ? { oracle_sid: oracleSid }
                : {}),
              ...(oracleConnectMode === "tns_alias" && oracleTnsAlias
                ? { oracle_tns_alias: oracleTnsAlias }
                : {}),
              ...(oracleConnectMode === "connect_string" && oracleConnectString
                ? { oracle_connect_string: oracleConnectString }
                : {}),
              ...(oracleWalletDir
                ? { oracle_wallet_dir: oracleWalletDir }
                : {}),
            }
          : {}),
      },
      default_schema: defaultSchema || undefined,
      safe_mode: safeMode,
      pooler_mode:
        dbType === "postgresql"
          ? poolerMode === "auto"
            ? null
            : poolerMode === "enabled"
          : undefined,
      tunnel_profile_id:
        tunnelMode === "profile" ? tunnelProfileId || undefined : undefined,
      tunnel_inline:
        tunnelMode === "ssm"
          ? {
              tunnel_type: { SsmBastion: { region: ssmRegion } },
              auth_profile_id: ssmAuthProfileId || undefined,
            }
          : undefined,
      tunnel_remote_host:
        tunnelMode === "ssm" || tunnelMode === "profile"
          ? tunnelRemoteHost || undefined
          : undefined,
      tunnel_remote_port:
        tunnelMode === "ssm" || tunnelMode === "profile"
          ? parseInt(tunnelRemotePort) || undefined
          : undefined,
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
          : sshPassword
            ? { Password: sshPassword }
            : { Agent: true as const };

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
    const sslValidationError = validateSslInputs({
      dbType,
      sslMode,
      sslKeyFile,
      sslCertFile,
      sslCAFile,
    });
    if (sslValidationError) {
      toast.error("Connection Failed", {
        description: sslValidationError,
      });
      return;
    }

    const sshValidationError = validateSshTunnelInputs({
      useSSH,
      sshHost,
      sshUser,
      sshPassword,
      useSSHAgent,
      useSSHKey,
      sshKeyPath,
    });
    if (sshValidationError) {
      toast.error("Connection Failed", {
        description: sshValidationError,
      });
      return;
    }

    setIsTesting(true);
    setTestSuccess(false);

    try {
      const profile = buildConnectionProfile(`test-${Date.now()}`);
      const { invoke } = await import("@tauri-apps/api/core");

      const connectionInfo = await invoke<{
        id: string;
        pooler_mode?: boolean | null;
      }>("connect", {
        profile,
      });
      const testResult = await invoke<{
        success: boolean;
        message: string;
        pooler_mode?: boolean | null;
      }>("test_connection", { connId: connectionInfo.id });
      await invoke("disconnect", { connId: connectionInfo.id });

      const detectedPoolerMode =
        testResult.pooler_mode ?? connectionInfo.pooler_mode;

      if (
        dbType === "postgresql" &&
        poolerMode === "auto" &&
        detectedPoolerMode === true
      ) {
        setPoolerMode("enabled");
      }

      if (testResult.success) {
        setTestSuccess(true);
        setTimeout(() => {
          setTestSuccess(false);
        }, 3000);
      } else {
        toast.error("Connection Failed", { description: testResult.message });
      }
    } catch (error) {
      const errorMessage = extractConnectionErrorMessage(
        error,
        "Connection failed",
      );
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

    const sslValidationError = validateSslInputs({
      dbType,
      sslMode,
      sslKeyFile,
      sslCertFile,
      sslCAFile,
    });
    if (sslValidationError) {
      toast.error("Error", { description: sslValidationError });
      return;
    }

    const sshValidationError = validateSshTunnelInputs({
      useSSH,
      sshHost,
      sshUser,
      sshPassword,
      useSSHAgent,
      useSSHKey,
      sshKeyPath,
    });
    if (sshValidationError) {
      toast.error("Error", { description: sshValidationError });
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
      const errorMessage = extractConnectionErrorMessage(
        error,
        "Failed to save connection",
      );
      toast.error("Error", { description: errorMessage });
    } finally {
      setIsSaving(false);
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
      value: "duckdb",
      label: "DuckDB",
      logo: getDatabaseLogo(DbType.DuckDB),
      beta: true,
    },
    {
      value: "mssql",
      label: "SQL Server",
      logo: getDatabaseLogo(DbType.SQLServer),
    },
    {
      value: "oracle",
      label: "Oracle (Beta)",
      logo: getDatabaseLogo(DbType.Oracle),
    },
    {
      value: "mongodb",
      label: "MongoDB",
      logo: getDatabaseLogo(DbType.MongoDB),
      beta: true,
    },
    {
      value: "redis",
      label: "Redis",
      logo: getDatabaseLogo(DbType.Redis),
      beta: true,
    },
    {
      value: "trino",
      label: "Trino",
      logo: getDatabaseLogo(DbType.Trino),
      beta: true,
    },
  ];

  const currentDbType = dbTypeOptions.find((opt) => opt.value === dbType);
  const isFileBased = isFileBasedDbType(dbType);
  const fileInputPlaceholder = dbType === "duckdb"
    ? "/path/to/scratchpad.duckdb"
    : "/path/to/database.db";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Button variant="ghost" className="px-2 gap-2" onClick={closeForm}>
          <IconArrowLeft className="h-5! w-5!" />
          <span className="text-sm font-semibold">
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
          </SelectTrigger>
          <SelectContent>
            {dbTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                <div className="flex items-center gap-2">
                  <img src={opt.logo} alt={opt.label} className="h-3.5 w-3.5" />
                  {opt.label}
                  {opt.beta && (
                    <Badge variant="outline" size="xs">
                      Beta
                    </Badge>
                  )}
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
                        {selectedWorkspaceIds.some(
                          (id) => savedWorkspaces.find((ws) => ws.id === id && !ws.autoCreated),
                        ) ? (
                          <span className="truncate">
                            {selectedWorkspaceIds
                              .filter(
                                (id) => savedWorkspaces.find((ws) => ws.id === id && !ws.autoCreated),
                              )
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

                      {savedWorkspaces.filter((ws) => !ws.autoCreated).length > 0 && (
                        <CommandGroup heading="Workspaces" className="text-xs">
                          {savedWorkspaces.filter((ws) => !ws.autoCreated).map((ws) => (
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
                                void handleCreateGroup(groupSearchValue);
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
                                void handleCreateGroup(groupSearchValue);
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
          {!isFileBased ? (
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
                    {dbType === "oracle" && oracleConnectMode === "service_name"
                      ? "Service Name"
                      : dbType === "trino"
                        ? "Catalog"
                        : "Database"}
                  </Label>
                  <Input
                    id="database"
                    className="mt-1 h-8 text-xs"
                    value={database}
                    onChange={(e) => {
                      setDatabase(e.target.value);
                    }}
                    placeholder={
                      dbType === "oracle" && oracleConnectMode === "service_name"
                        ? "ORCL"
                        : "database name"
                    }
                    disabled={isTesting}
                  />
                </div>
                {(dbType === "postgresql" || dbType === "mssql" || dbType === "trino") && (
                  <div>
                    <Label htmlFor="defaultSchema" className="text-xs">
                      {dbType === "trino" ? "Default Schema (optional)" : "Default Schema"}
                    </Label>
                    <Input
                      id="defaultSchema"
                      className="mt-1 h-8 text-xs"
                      value={defaultSchema}
                      onChange={(e) => {
                        setDefaultSchema(e.target.value);
                      }}
                      placeholder={dbType === "postgresql" ? "public" : dbType === "trino" ? "default" : "dbo"}
                      disabled={isTesting}
                    />
                  </div>
                )}
              </div>

              {/* Oracle-specific fields */}
              {dbType === "oracle" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="oracleConnectMode" className="text-xs">
                        Connection Mode
                      </Label>
                      <Select
                        value={oracleConnectMode}
                        onValueChange={(v) => {
                          if (v) setOracleConnectMode(v);
                        }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="service_name" className="text-xs">
                            Service Name
                          </SelectItem>
                          <SelectItem value="sid" className="text-xs">
                            SID (legacy)
                          </SelectItem>
                          <SelectItem value="tns_alias" className="text-xs">
                            TNS Alias
                          </SelectItem>
                          <SelectItem value="connect_string" className="text-xs">
                            Raw Connect String
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {oracleConnectMode === "sid" && (
                      <div>
                        <Label htmlFor="oracleSid" className="text-xs">
                          SID
                        </Label>
                        <Input
                          id="oracleSid"
                          className="mt-1 h-8 text-xs"
                          value={oracleSid}
                          onChange={(e) => {
                            setOracleSid(e.target.value);
                          }}
                          placeholder="ORCL"
                          disabled={isTesting}
                        />
                      </div>
                    )}

                    {oracleConnectMode === "tns_alias" && (
                      <div>
                        <Label htmlFor="oracleTnsAlias" className="text-xs">
                          TNS Alias
                        </Label>
                        <Input
                          id="oracleTnsAlias"
                          className="mt-1 h-8 text-xs"
                          value={oracleTnsAlias}
                          onChange={(e) => {
                            setOracleTnsAlias(e.target.value);
                          }}
                          placeholder="mydb_alias"
                          disabled={isTesting}
                        />
                      </div>
                    )}
                  </div>

                  {oracleConnectMode === "connect_string" && (
                    <div>
                      <Label htmlFor="oracleConnectString" className="text-xs">
                        Connect String
                      </Label>
                      <textarea
                        id="oracleConnectString"
                        className="mt-1 w-full h-16 text-xs px-2 py-1.5 border rounded-md bg-background resize-none font-mono"
                        value={oracleConnectString}
                        onChange={(e) => {
                          setOracleConnectString(e.target.value);
                        }}
                        placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=...)))"
                        disabled={isTesting}
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="oracleWalletDir" className="text-xs">
                      Wallet Directory
                    </Label>
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        id="oracleWalletDir"
                        className="h-8 text-xs flex-1"
                        value={oracleWalletDir}
                        onChange={(e) => {
                          setOracleWalletDir(e.target.value);
                        }}
                        placeholder="/path/to/wallet (optional)"
                        disabled={isTesting}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => {
                          void (async () => {
                            try {
                              const selected = await open({ directory: true });
                              if (selected && typeof selected === "string") {
                                setOracleWalletDir(selected);
                              }
                            } catch (error) {
                              logger.error("Failed to open directory dialog:", error);
                              toast.error("Failed to open directory picker");
                            }
                          })();
                        }}
                        disabled={isTesting}
                        title="Browse wallet directory"
                      >
                        <IconFolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
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
                  placeholder={fileInputPlaceholder}
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
                {dbType === "duckdb" && (
                  <Button
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    onClick={() => void handleCreateScratchpad()}
                    disabled={isTesting}
                  >
                    New Scratchpad...
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* SSL Mode */}
          {!isFileBased && (
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
                className={sslModeGridClassName}
              >
                {sslModeOptions.map((option) => {
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

          {showsSslKeyFiles && (
            <div>
              <Label className="text-xs">SSL Key Files</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="flex min-w-[220px] flex-1 items-center gap-1">
                  <Input
                    id="ssl-key-file"
                    className="h-8 text-xs"
                    value={sslKeyFile}
                    onChange={(e) => {
                      setSslKeyFile(e.target.value);
                    }}
                    placeholder="Key..."
                    disabled={isTesting || sslMode === SslMode.Disable}
                    aria-label="SSL Key File"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => void handleBrowseSslFile("key")}
                    disabled={isTesting || sslMode === SslMode.Disable}
                    title="Browse SSL key file"
                    aria-label="Browse SSL key file"
                  >
                    <IconFolderOpen className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-[220px] flex-1 items-center gap-1">
                  <Input
                    id="ssl-cert-file"
                    className="h-8 text-xs"
                    value={sslCertFile}
                    onChange={(e) => {
                      setSslCertFile(e.target.value);
                    }}
                    placeholder="Cert..."
                    disabled={isTesting || sslMode === SslMode.Disable}
                    aria-label="SSL Cert File"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => void handleBrowseSslFile("cert")}
                    disabled={isTesting || sslMode === SslMode.Disable}
                    title="Browse SSL cert file"
                    aria-label="Browse SSL cert file"
                  >
                    <IconFolderOpen className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-[220px] flex-1 items-center gap-1">
                  <Input
                    id="ssl-ca-file"
                    className="h-8 text-xs"
                    value={sslCAFile}
                    onChange={(e) => {
                      setSslCAFile(e.target.value);
                    }}
                    placeholder="CA Cert..."
                    disabled={isTesting || sslMode === SslMode.Disable}
                    aria-label="SSL CA File"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => void handleBrowseSslFile("ca")}
                    disabled={isTesting || sslMode === SslMode.Disable}
                    title="Browse SSL CA cert file"
                    aria-label="Browse SSL CA cert file"
                  >
                    <IconFolderOpen className="h-4 w-4" />
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={clearSslFiles}
                  disabled={
                    isTesting ||
                    sslMode === SslMode.Disable ||
                    (!sslKeyFile && !sslCertFile && !sslCAFile)
                  }
                  title="Clear SSL files"
                  aria-label="Clear SSL files"
                >
                  <IconX className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {dbType === "postgresql" && (
            <div>
              <Label className="text-xs">Connection Pooler</Label>
              <RadioGroup
                value={poolerMode}
                onValueChange={(value) => {
                  setPoolerMode(
                    value as "auto" | "enabled" | "disabled",
                  );
                }}
                className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
              >
                {[
                  {
                    value: "auto",
                    label: "Auto-detect",
                  },
                  {
                    value: "enabled",
                    label: "Enabled",
                  },
                  {
                    value: "disabled",
                    label: "Disabled",
                  },
                ].map((option) => {
                  const id = `pooler-mode-${option.value}`;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={id}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                        poolerMode === option.value && "text-primary",
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
            <RadioGroup
              value={safeMode}
              onValueChange={(value) => {
                setSafeMode(value as SafeMode);
              }}
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
            >
              {[
                { value: "full_access", label: "Full Access" },
                { value: "read_write_update", label: "RW + Update" },
                { value: "read_write", label: "Read + Write" },
                { value: "read_only", label: "Read Only" },
              ].map((option) => {
                const id = `safe-mode-${option.value}`;
                return (
                  <Label
                    key={option.value}
                    htmlFor={id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      safeMode === option.value && "text-primary",
                    )}
                  >
                    <RadioGroupItem id={id} value={option.value} />
                    {option.label}
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          {/* Connection Options */}
          {!isFileBased && (
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

          {/* Tunnel */}
          {!isFileBased && (
            <TunnelSection
              tunnelMode={tunnelMode}
              onTunnelModeChange={setTunnelMode}
              ssmAuthProfileId={ssmAuthProfileId}
              onSsmAuthProfileIdChange={setSsmAuthProfileId}
              ssmRegion={ssmRegion}
              onSsmRegionChange={setSsmRegion}
              remoteHost={tunnelRemoteHost}
              onRemoteHostChange={setTunnelRemoteHost}
              remotePort={tunnelRemotePort}
              onRemotePortChange={setTunnelRemotePort}
              tunnelProfileId={tunnelProfileId}
              onTunnelProfileIdChange={setTunnelProfileId}
              saveAsProfile={saveAsTunnelProfile}
              onSaveAsProfileChange={setSaveAsTunnelProfile}
              disabled={isTesting}
            />
          )}

          {/* SSH Tunnel Fields */}
          {!isFileBased && tunnelMode === "ssh" && (
            <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-8">
                      <Label htmlFor="ssh-host" className="text-xs">
                        SSH Host
                      </Label>
                      <Input
                        id="ssh-host"
                        className="mt-1 h-8 text-xs"
                        value={sshHost}
                        onChange={(e) => {
                          setSshHost(e.target.value);
                        }}
                        placeholder="bastion.example.com or ssh-config alias"
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
                        placeholder="Optional if alias defines User"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Leave blank only if your SSH alias has User in
                        <code className="mx-1">~/.ssh/config</code>.
                      </p>
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
                          setUseSSHAgent(checked);
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
                          setUseSSHKey(checked);
                        }}
                      />
                      <Label
                        htmlFor="use-ssh-key"
                        className={cn(
                          "cursor-pointer text-xs",
                          useSSHAgent && "text-muted-foreground",
                        )}
                      >
                        Use SSH Key
                      </Label>
                    </div>

                    {useSSHKey && (
                      <>
                        <div>
                          <Label htmlFor="ssh-key" className="text-xs">
                            Private Key
                          </Label>
                          <div className="flex gap-1.5 mt-1">
                            <Input
                              id="ssh-key"
                              className="h-8 text-xs flex-1"
                              value={sshKeyPath}
                              onChange={(e) => {
                                setSshKeyPath(e.target.value);
                              }}
                              placeholder="~/.ssh/id_rsa"
                              disabled={isTesting}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => void handleBrowseSshKey()}
                              disabled={isTesting}
                              title="Browse file"
                            >
                              <IconFolderOpen className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div>
                          <Label
                            htmlFor="ssh-key-passphrase"
                            className="text-xs"
                          >
                            Passphrase
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
          {isOracleDriverMissing && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950"
              onClick={() => { openPreferences("integrations"); }}
            >
              <IconAlertTriangle className="h-3 w-3" />
              Install Driver
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting || isSaving || isOracleDriverMissing}
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
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isTesting}
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
        </div>
      </div>
    </div>
  );
}
