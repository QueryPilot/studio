import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconDatabase, IconLoader2, IconCircleCheckFilled, IconChevronDown, IconShield, IconServer, IconPlus, IconX, IconCheck, IconClipboardText, IconClipboardCheck, IconPencil } from '@tabler/icons-react';
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
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
  type AwsSsmConfig,
  type AwsAuthMethod,
  DbType,
  SslMode,
} from "@/types/connection";
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

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: ConnectionProfile;
  onConnect?: (connectionId: string) => void;
}

interface EnvironmentTag {
  name: string;
  color: string;
  textColor: string;
}

interface GroupTag {
  name: string;
  color: string;
}

// Predefined environment tags with colors
const ENVIRONMENT_TAGS: EnvironmentTag[] = [
  { name: "local", color: "bg-gray-500", textColor: "text-gray-50" },
  { name: "dev", color: "bg-blue-500", textColor: "text-blue-50" },
  { name: "staging", color: "bg-yellow-500", textColor: "text-yellow-50" },
  { name: "uat", color: "bg-amber-600", textColor: "text-amber-50" },
  { name: "prod", color: "bg-red-500", textColor: "text-red-50" },
  { name: "test", color: "bg-green-500", textColor: "text-green-50" },
];

// Available colors for custom tags
const TAG_COLORS = [
  { value: "purple", class: "bg-purple-500", textClass: "text-purple-50" },
  { value: "pink", class: "bg-pink-500", textClass: "text-pink-50" },
  { value: "indigo", class: "bg-indigo-500", textClass: "text-indigo-50" },
  { value: "teal", class: "bg-teal-500", textClass: "text-teal-50" },
  { value: "orange", class: "bg-orange-500", textClass: "text-orange-50" },
  { value: "cyan", class: "bg-cyan-500", textClass: "text-cyan-50" },
  { value: "emerald", class: "bg-emerald-500", textClass: "text-emerald-50" },
  { value: "rose", class: "bg-rose-500", textClass: "text-rose-50" },
  { value: "violet", class: "bg-violet-500", textClass: "text-violet-50" },
  { value: "fuchsia", class: "bg-fuchsia-500", textClass: "text-fuchsia-50" },
  { value: "lime", class: "bg-lime-500", textClass: "text-lime-50" },
  { value: "amber", class: "bg-amber-500", textClass: "text-amber-50" },
  { value: "sky", class: "bg-sky-500", textClass: "text-sky-50" },
  { value: "slate", class: "bg-slate-500", textClass: "text-slate-50" },
  { value: "zinc", class: "bg-zinc-500", textClass: "text-zinc-50" },
];

// Get group tags from localStorage
const getGroupTags = (): GroupTag[] => {
  const stored = localStorage.getItem("query_pilot_group_tags");
  return stored ? (JSON.parse(stored) as GroupTag[]) : [];
};

// IconDeviceFloppy group tags to localStorage
const saveGroupTags = (tags: GroupTag[]) => {
  localStorage.setItem("query_pilot_group_tags", JSON.stringify(tags));
};

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onConnect,
}: ConnectionDialogProps) {
  const { saveConnection: persistConnection, updateConnection: persistUpdate } =
    useConnectionStore();
  const isEditMode = !!connection;

  // Form state
  const [dbType, setDbType] = useState<DatabaseType>(() => {
    // Handle both DatabaseConnection and ConnectionProfile types
    if (connection) {
      // IconCheck if it's a ConnectionProfile (has db_type field)
      if ("db_type" in connection) {
        const dbTypeMap: Record<number, DatabaseType> = {
          0: "postgresql", // DbType.PostgreSQL
          1: "mysql", // DbType.MySQL
          2: "sqlite", // DbType.SQLite
          3: "mssql", // DbType.SQLServer
        };
        return (
          dbTypeMap[connection.db_type as unknown as number] || "postgresql"
        );
      }
      // Otherwise it's a DatabaseConnection (has type field)
      const type = (connection as any).type.toLowerCase();
      if (type === "mariadb") return "mysql";
      if (
        type &&
        ["postgresql", "mysql", "sqlite", "mssql"].includes(type as string)
      ) {
        return type as DatabaseType;
      }
    }
    return "postgresql";
  });
  const [name, setName] = useState(connection?.name || "");
  const [host, setHost] = useState(connection?.host || "localhost");
  const [port, setPort] = useState(
    connection?.port?.toString() || getDefaultPort(dbType),
  );
  const [username, setUsername] = useState(connection?.username || "");
  const [password, setPassword] = useState(connection?.password || "");
  const [database, setDatabase] = useState(connection?.database || "");
  const [sslMode, setSslMode] = useState<SslMode>(
    connection?.ssl_mode || SslMode.Disable,
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    // Initialize tags from existing connection metadata if in edit mode
    if (isEditMode && "metadata" in (connection || {})) {
      return (connection as any).metadata?.tags || [];
    }
    return ["local"];
  });

  // Group tag management
  const [groupTags, setGroupTags] = useState<GroupTag[]>(getGroupTags());
  const [tagsCommandOpen, setTagsCommandOpen] = useState(false);
  const [groupSearchValue, setGroupSearchValue] = useState("");
  const [editingGroupTag, setEditingGroupTag] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  // SSH tunnel state
  const existingSshTunnel: ConnectionProfile["ssh_tunnel"] =
    connection?.ssh_tunnel ??
    ((connection as any)?.bastion?.Ssh as ConnectionProfile["ssh_tunnel"]);

  const [useSSH, setUseSSH] = useState(!!existingSshTunnel);
  const [sshHost, setSshHost] = useState(
    (existingSshTunnel && existingSshTunnel.host) || "",
  );
  const [sshPort, setSshPort] = useState(
    (existingSshTunnel && existingSshTunnel.port.toString()) || "22",
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
  const existingAwsSsm: AwsSsmConfig | undefined = (connection as any)?.bastion
    ? ((connection as any).bastion.AwsSsm as AwsSsmConfig | undefined)
    : undefined;
  const [useAwsSsm, setUseAwsSsm] = useState(!!existingAwsSsm);
  const [ssmTargetId, setSsmTargetId] = useState(
    existingAwsSsm?.target_id || "",
  );
  const [ssmRegion, setSsmRegion] = useState(existingAwsSsm?.region || "");
  const [ssmProfileName, setSsmProfileName] = useState(
    existingAwsSsm && (existingAwsSsm.auth as any)?.AwsProfile
      ? (existingAwsSsm.auth as any).AwsProfile.profile_name
      : "",
  );
  const [ssmAuthType, setSsmAuthType] = useState<"profile" | "oauth">(
    existingAwsSsm && (existingAwsSsm.auth as any)?.OAuthFederated
      ? "oauth"
      : "profile",
  );
  const [ssmOAuthProvider, setSsmOAuthProvider] = useState<string>(
    existingAwsSsm && (existingAwsSsm.auth as any)?.OAuthFederated?.provider
      ? typeof (existingAwsSsm.auth as any).OAuthFederated.provider === "string"
        ? (existingAwsSsm.auth as any).OAuthFederated.provider
        : "Microsoft"
      : "Microsoft",
  );
  const [ssmOAuthClientId, setSsmOAuthClientId] = useState(
    existingAwsSsm && (existingAwsSsm.auth as any)?.OAuthFederated
      ? (existingAwsSsm.auth as any).OAuthFederated.client_id || ""
      : "",
  );
  const [ssmOAuthTenantId, setSsmOAuthTenantId] = useState(
    existingAwsSsm && (existingAwsSsm.auth as any)?.OAuthFederated
      ? (existingAwsSsm.auth as any).OAuthFederated.tenant_id || ""
      : "",
  );
  const [ssmAssumeRoleArn, setSsmAssumeRoleArn] = useState(
    existingAwsSsm && (existingAwsSsm.auth as any)?.OAuthFederated
      ? (existingAwsSsm.auth as any).OAuthFederated.assume_role_arn || ""
      : "",
  );
  const [ssmRemoteHost, setSsmRemoteHost] = useState(
    existingAwsSsm?.remote_host || host,
  );
  const [ssmRemotePort, setSsmRemotePort] = useState(
    existingAwsSsm?.remote_port ? existingAwsSsm.remote_port.toString() : port,
  );

  // SSL certificates state
  const [sslKeyFile, setSslKeyFile] = useState<string>(
    connection?.ssl_config?.key_file || "",
  );
  const [sslCertFile, setSslCertFile] = useState<string>(
    connection?.ssl_config?.cert_file || "",
  );
  const [sslCAFile, setSslCAFile] = useState<string>(
    connection?.ssl_config?.ca_file || "",
  );

  // UI state
  const [sslModeOpen, setSslModeOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [uriParsed, setUriParsed] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testStage, setTestStage] = useState<"idle" | "ssh" | "db">("idle");
  const [testStatusMessage, setTestStatusMessage] = useState("");

  // Update port when database type changes
  useEffect(() => {
    if (!connection) {
      setPort(getDefaultPort(dbType));
    }
  }, [dbType, connection]);

  useEffect(() => {
    if (useSSHAgent) {
      setUseSSHKey(false);
      setSshPassword("");
    }
  }, [useSSHAgent]);

  // IconKeyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Enter = IconDeviceFloppy & Connect
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        if (!isSaving && !isConnecting && !isTesting) {
          void handleConnect();
        }
      }
      // Enter = IconDeviceFloppy (only if not in textarea/input with modifier)
      else if (e.key === "Enter" && !e.metaKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        // Allow Enter in textareas
        if (target.tagName === "TEXTAREA") return;
        // Allow Enter in inputs (for form navigation)
        if (target.tagName === "INPUT") return;

        e.preventDefault();
        if (!isSaving && !isConnecting && !isTesting) {
          void handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSaving, isConnecting, isTesting]);

  useEffect(() => {
    if (!useSSHKey) {
      setSshKeyPassphrase("");
    } else {
      setUseSSHAgent(false);
    }
  }, [useSSHKey]);

  useEffect(() => {
    if (useAwsSsm) {
      setUseSSH(false);
    }
  }, [useAwsSsm]);

  useEffect(() => {
    if (useSSH) {
      setUseAwsSsm(false);
    }
  }, [useSSH]);

  function getDefaultPort(type: DatabaseType): string {
    switch (type) {
      case "postgresql":
        return "5432";
      case "mysql":
        return "3306";
      case "mssql":
        return "1433";
      case "sqlite":
        return "";
      default:
        return "";
    }
  }

  const handleParseEnv = (text: string) => {
    try {
      const config = parseConnectionEnv(text);

      // Apply parsed configuration to state
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
      if (config.sslKeyFile) setSslKeyFile(config.sslKeyFile);
      if (config.sslCertFile) setSslCertFile(config.sslCertFile);
      if (config.sslCAFile) setSslCAFile(config.sslCAFile);

      // SSH configuration
      if (config.useSSH) {
        setUseSSH(true);
        if (config.sshHost) setSshHost(config.sshHost);
        if (config.sshPort) setSshPort(config.sshPort);
        if (config.sshUser) setSshUser(config.sshUser);
        if (config.sshPassword) setSshPassword(config.sshPassword);
        if (config.useSSHKey && config.sshKeyPath) {
          setUseSSHKey(true);
          setSshKeyPath(config.sshKeyPath);
        }
      }

      setUriParsed(true);
      setTimeout(() => {
        setUriParsed(false);
      }, 3000);

      toast.success("Environment Config Parsed", {
        description: "Successfully parsed environment variables",
      });
    } catch (error) {
      toast.error("Invalid Environment Format", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to parse environment variables. Please check the format.",
      });
    }
  };

  const handleParseUri = (uri: string) => {
    try {
      const config = parseConnectionUri(uri);

      // Apply parsed configuration to state
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

      setUriParsed(true);
      setTimeout(() => {
        setUriParsed(false);
      }, 3000);
    } catch (error) {
      toast.error("Invalid URI", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to parse connection URI. Please check the format.",
      });
    }
  };

  const handlePasteUri = async () => {
    try {
      // Always use Tauri clipboard API when available

      const text = await readText();

      if (text && text.trim()) {
        const trimmed = text.trim();
        const format = detectConnectionFormat(trimmed);

        if (format === "uri") {
          handleParseUri(trimmed);
        } else if (format === "env") {
          handleParseEnv(trimmed);
        } else {
          toast.error("Unknown Format", {
            description:
              "Unable to detect format. Please paste a connection URI or environment variables.",
          });
        }
      } else {
        toast.error("Clipboard Empty", {
          description:
            "No text found in clipboard. IconCopy connection details first.",
        });
      }
    } catch (error) {
      console.error("Clipboard error:", error);

      // IconCheck if it's the "not available in requested format" error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("not available in the requested format") ||
        errorMessage.includes("clipboard is empty")
      ) {
        toast.error("Clipboard Empty", {
          description:
            "No text found in clipboard. IconCopy connection details first.",
        });
        return;
      }

      // Try browser API as absolute fallback with user gesture
      try {
        // This might work if called from a user gesture
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          const trimmed = text.trim();
          const format = detectConnectionFormat(trimmed);

          if (format === "uri") {
            handleParseUri(trimmed);
          } else if (format === "env") {
            handleParseEnv(trimmed);
          } else {
            toast.error("Unknown Format", {
              description:
                "Unable to detect format. Please paste a connection URI or environment variables.",
            });
          }
        } else {
          toast.error("Clipboard Empty", {
            description:
              "No text found in clipboard. IconCopy connection details first.",
          });
        }
      } catch (browserError) {
        console.error("[ConnectionDialog.handlePasteUri]", browserError);
        toast.error("Clipboard Access Failed", {
          description:
            "Unable to read clipboard. Please copy connection details and try again.",
        });
      }
    }
  };

  const handleTagToggle = (tagName: string) => {
    const isEnvironmentTag = ENVIRONMENT_TAGS.some((t) => t.name === tagName);
    const isGroupTag = groupTags.some((t) => t.name === tagName);

    if (selectedTags.includes(tagName)) {
      // Remove tag
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      // Add tag, but replace existing tag of the same type (env or group)
      const currentEnvTag = selectedTags.find((t) =>
        ENVIRONMENT_TAGS.some((env) => env.name === t),
      );
      const currentGroupTag = selectedTags.find((t) =>
        groupTags.some((g) => g.name === t),
      );

      let newTags = [...selectedTags];

      if (isEnvironmentTag) {
        // Remove any existing environment tag but keep group tags
        if (currentEnvTag) {
          newTags = newTags.filter((t) => t !== currentEnvTag);
        }
      }

      if (isGroupTag) {
        // Remove any existing group tag
        if (currentGroupTag) {
          newTags = newTags.filter((t) => t !== currentGroupTag);
        }
        // Keep environment tag if exists, replace group
        if (currentEnvTag) {
          newTags = [currentEnvTag];
        } else {
          newTags = [];
        }
      }

      newTags.push(tagName);
      setSelectedTags(newTags);
    }
  };

  const handleCreateGroup = (groupName: string) => {
    if (!groupName.trim()) return;

    // IconCheck if group already exists
    const exists = groupTags.some((t) => t.name === groupName);
    if (exists) {
      toast.error("Group already exists", {
        description: `"${groupName}" is already in your groups`,
      });
      return;
    }

    // Assign a random color from available colors
    const usedColors = groupTags.map((t) => t.color);
    const availableColors = TAG_COLORS.filter(
      (c) => !usedColors.includes(c.class),
    );

    // If no available colors, pick randomly from all colors
    const colorPool = availableColors.length > 0 ? availableColors : TAG_COLORS;
    const randomColor = colorPool[Math.floor(Math.random() * colorPool.length)];
    const color = randomColor?.class || "bg-gray-500";

    const newGroup: GroupTag = {
      name: groupName.trim(),
      color,
    };

    const updatedTags = [...groupTags, newGroup];
    setGroupTags(updatedTags);
    saveGroupTags(updatedTags);

    // Auto-select the new group
    handleTagToggle(groupName);
    setTagsCommandOpen(false);
    setGroupSearchValue("");

    toast.success("Group created", {
      description: `"${groupName}" has been added to your groups`,
    });
  };

  const handleEditGroup = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      setEditingGroupTag(null);
      return;
    }

    // IconCheck if new name already exists
    const exists = groupTags.some(
      (t) => t.name === newName && t.name !== oldName,
    );
    if (exists) {
      toast.error("Group already exists", {
        description: `"${newName}" is already in your groups`,
      });
      return;
    }

    const updatedTags = groupTags.map((t) =>
      t.name === oldName ? { ...t, name: newName.trim() } : t,
    );
    setGroupTags(updatedTags);
    saveGroupTags(updatedTags);

    // Update selection if this group was selected
    if (selectedTags.includes(oldName)) {
      setSelectedTags(
        selectedTags.map((t) => (t === oldName ? newName.trim() : t)),
      );
    }

    setEditingGroupTag(null);
    setEditingGroupName("");

    toast.success("Group renamed", {
      description: `"${oldName}" has been renamed to "${newName}"`,
    });
  };

  const handleDeleteGroup = (groupName: string) => {
    const updatedTags = groupTags.filter((t) => t.name !== groupName);
    setGroupTags(updatedTags);
    saveGroupTags(updatedTags);

    // If the deleted group was selected, remove from selection
    if (selectedTags.includes(groupName)) {
      setSelectedTags(selectedTags.filter((t) => t !== groupName));
    }

    toast.success("Group deleted", {
      description: `"${groupName}" has been removed`,
    });
  };

  const handleChangeGroupColor = (groupName: string) => {
    const currentTag = groupTags.find((t) => t.name === groupName);
    if (!currentTag) return;

    // Get next color in the list
    const currentIndex = TAG_COLORS.findIndex(
      (c) => c.class === currentTag.color,
    );
    const nextIndex = (currentIndex + 1) % TAG_COLORS.length;
    const newColor = TAG_COLORS[nextIndex].class;

    const updatedTags = groupTags.map((t) =>
      t.name === groupName ? { ...t, color: newColor } : t,
    );
    setGroupTags(updatedTags);
    saveGroupTags(updatedTags);
  };

  const getTagColor = (tagName: string, isGroup: boolean = false) => {
    if (!isGroup) {
      // IconCheck environment tags
      const envTag = ENVIRONMENT_TAGS.find((t) => t.name === tagName);
      if (envTag) return { bg: envTag.color, text: envTag.textColor };
    } else {
      // IconCheck group tags
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

  const handleSelectSSHKey = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        title: "Select SSH Private Key",
        multiple: false,
        filters: [
          {
            name: "SSH Keys",
            extensions: ["pem", "key", "ppk", "rsa", "ed25519"],
          },
        ],
      });

      if (result) {
        if (typeof result === "string") {
          setSshKeyPath(result);
        } else if (Array.isArray(result)) {
          const paths = result as string[];
          if (paths.length > 0 && paths[0]) {
            setSshKeyPath(paths[0]);
          }
        }
      }
    } catch (error) {
      toast.error("Failed to open file picker", {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  const buildConnectionProfile = (idOverride?: string): ConnectionProfile => {
    const resolvedId = idOverride ?? connection?.id ?? `conn-${Date.now()}`;

    const profile: ConnectionProfile = {
      id: resolvedId,
      name,
      db_type:
        dbType === "postgresql"
          ? DbType.PostgreSQL
          : dbType === "mysql"
          ? DbType.MySQL
          : dbType === "sqlite"
          ? DbType.SQLite
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
      options: {},
    };

    let sshTunnelConfig: ConnectionProfile["ssh_tunnel"] = undefined;

    if (useSSH) {
      const portNumber = Number.parseInt(sshPort, 10) || 22;

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

      sshTunnelConfig = {
        host: sshHost,
        port: portNumber,
        user: sshUser,
        auth,
      };
    }

    profile.ssh_tunnel = useAwsSsm ? undefined : sshTunnelConfig;

    if (useAwsSsm) {
      const auth: AwsAuthMethod =
        ssmAuthType === "oauth"
          ? {
              OAuthFederated: {
                provider: ssmOAuthProvider as any, // Type checked at runtime
                client_id: ssmOAuthClientId,
                tenant_id: ssmOAuthTenantId || undefined,
                organization: undefined,
                domain: undefined,
                scopes: [],
                assume_role_arn: ssmAssumeRoleArn,
              },
            }
          : {
              AwsProfile: {
                profile_name: ssmProfileName || "default",
              },
            };

      profile.bastion = {
        AwsSsm: {
          target_id: ssmTargetId,
          region: ssmRegion,
          auth,
          remote_host: ssmRemoteHost || profile.host,
          remote_port:
            Number.parseInt(ssmRemotePort, 10) || profile.port || 5432,
        },
      };
    } else if (sshTunnelConfig) {
      profile.bastion = { Ssh: sshTunnelConfig };
    }

    return profile;
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestSuccess(false);
    setTestStage(useSSH ? "ssh" : "db");
    setTestStatusMessage("");

    try {
      // Basic validation for SSH-specific inputs
      if (useSSH) {
        if (!sshHost.trim()) {
          throw new Error(
            "SSH host is required when SSH tunneling is enabled.",
          );
        }
        if (!sshUser.trim() && !useSSHAgent) {
          throw new Error(
            "SSH user is required when SSH tunneling is enabled.",
          );
        }
        if (useSSHKey && !sshKeyPath) {
          throw new Error(
            "Select a private key file or disable key authentication.",
          );
        }
        if (!useSSHKey && !useSSHAgent && !sshPassword) {
          throw new Error(
            "Provide an SSH password or switch to key authentication.",
          );
        }
      }

      if (useAwsSsm) {
        if (!ssmRegion.trim()) {
          throw new Error(
            "AWS region is required for SSM bastion connections.",
          );
        }
        if (!ssmTargetId.trim()) {
          throw new Error("Provide the SSM target instance or task ID.");
        }
        if (!ssmRemoteHost.trim()) {
          throw new Error("Remote host is required when using AWS SSM.");
        }
        if (ssmAuthType === "oauth") {
          if (!ssmOAuthClientId.trim()) {
            throw new Error("OAuth Client ID is required.");
          }
          if (!ssmAssumeRoleArn.trim()) {
            throw new Error(
              "AWS IAM Role ARN is required for OAuth authentication.",
            );
          }
        }
      }

      const profile = buildConnectionProfile(`test-${Date.now()}`);

      // Use Tauri commands directly
      const { invoke } = await import("@tauri-apps/api/core");

      // Test SSH tunnel if using bastion with SSH
      if (useSSH && profile.bastion && "Ssh" in profile.bastion) {
        try {
          setTestStage("ssh");
          setTestStatusMessage("Establishing SSH tunnel…");
          await invoke("test_ssh_connection", {
            config: profile.bastion.Ssh,
          });
          setTestStatusMessage("SSH tunnel ok");
        } catch (sshError: unknown) {
          const message =
            sshError instanceof Error ? sshError.message : String(sshError);
          throw new Error(
            message || "SSH tunnel failed. Verify host, user, and credentials.",
          );
        }
      }

      setTestStage("db");
      setTestStatusMessage("Connecting to database…");

      // Connect to the database
      const connectionInfo = await invoke<{ id: string }>("connect", {
        profile,
      });

      // Test the connection
      const testResult = await invoke<{ success: boolean; message: string }>(
        "test_connection",
        { connId: connectionInfo.id },
      );

      // Disconnect after testing
      await invoke("disconnect", { connId: connectionInfo.id });

      if (testResult.success) {
        setTestSuccess(true);
        setTestStatusMessage("Database connection ok");
        // Auto-reset success state after 3 seconds
        setTimeout(() => {
          setTestSuccess(false);
        }, 3000);
      } else {
        // Extract more detailed error information
        let errorDetails =
          testResult.message || "Unable to connect to the database";

        // Try to make common error messages more user-friendly
        if (errorDetails.includes("password authentication failed")) {
          errorDetails =
            "Authentication failed. Please check your username and password.";
        } else if (
          errorDetails.includes("ECONNREFUSED") ||
          errorDetails.includes("Connection refused")
        ) {
          errorDetails = `Connection refused. Please check:\n• IconDatabase is running\n• Host and port are correct\n• Firewall settings`;
        } else if (
          errorDetails.includes("ENOTFOUND") ||
          errorDetails.includes("getaddrinfo")
        ) {
          errorDetails = `Host not found. Please check the hostname/IP address.`;
        } else if (
          errorDetails.includes("timeout") ||
          errorDetails.includes("ETIMEDOUT")
        ) {
          errorDetails =
            "Connection timed out. The database might be unreachable or slow to respond.";
        } else if (
          errorDetails.includes("SSL") ||
          errorDetails.includes("TLS")
        ) {
          errorDetails = "SSL/TLS error. Please check your SSL settings.";
        } else if (
          errorDetails.includes("database") &&
          errorDetails.includes("does not exist")
        ) {
          errorDetails =
            "Database does not exist. Please check the database name.";
        }

        toast.error("Connection Failed", {
          description: errorDetails,
          duration: 5000, // Show for longer to read the details
        });
      }
    } catch (error) {
      // Extract detailed error message
      let errorMessage = "Unable to connect to the database";

      if (error instanceof Error) {
        errorMessage = error.message;

        // Parse common Rust/Tauri error formats
        if (errorMessage.includes("error returned from database:")) {
          errorMessage =
            errorMessage.split("error returned from database:")[1]?.trim() ||
            errorMessage;
        }

        // Make error messages more user-friendly
        if (errorMessage.includes("No such host is known")) {
          errorMessage = "Unknown host. Please verify the hostname.";
        } else if (errorMessage.includes("Access denied")) {
          errorMessage =
            "Access denied. Please check your credentials and permissions.";
        }
      }

      setTestStatusMessage(errorMessage);

      toast.error("Connection Failed", {
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setIsTesting(false);
      setTestStage("idle");
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Error", {
        description: "Please provide a connection name",
      });
      return;
    }

    if (useSSH) {
      if (!sshHost.trim()) {
        toast.error("Error", {
          description: "SSH host is required when SSH tunneling is enabled",
        });
        return;
      }
      if (!useSSHAgent && !sshUser.trim()) {
        toast.error("Error", {
          description: "SSH user is required when SSH tunneling is enabled",
        });
        return;
      }
      if (useSSHKey && !sshKeyPath) {
        toast.error("Error", {
          description:
            "Select a private key file or disable key authentication",
        });
        return;
      }
      if (!useSSHKey && !useSSHAgent && !sshPassword) {
        toast.error("Error", {
          description:
            "Provide an SSH password or choose key/agent authentication",
        });
        return;
      }
    }

    if (useAwsSsm) {
      if (!ssmRegion.trim()) {
        toast.error("Error", {
          description: "AWS region is required when AWS SSM is enabled",
        });
        return;
      }
      if (!ssmTargetId.trim()) {
        toast.error("Error", {
          description: "Provide the SSM target instance or task identifier",
        });
        return;
      }
      if (!ssmRemoteHost.trim()) {
        toast.error("Error", {
          description: "Remote host is required when using AWS SSM",
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const profile = buildConnectionProfile(connection?.id);

      if (isEditMode && connection.id) {
        await persistUpdate(connection.id, profile, selectedTags);
      } else {
        await persistConnection(profile, selectedTags);
      }

      toast.success("Success", {
        description: isEditMode
          ? "Connection updated successfully"
          : "Connection saved successfully",
      });

      onOpenChange(false);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save connection";
      toast.error("Error", {
        description: errorMessage,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnect = async () => {
    if (!name.trim()) {
      toast.error("Error", {
        description: "Please provide a connection name",
      });
      return;
    }

    if (useSSH) {
      if (!sshHost.trim()) {
        toast.error("Error", {
          description: "SSH host is required when SSH tunneling is enabled",
        });
        return;
      }
      if (!useSSHAgent && !sshUser.trim()) {
        toast.error("Error", {
          description: "SSH user is required when SSH tunneling is enabled",
        });
        return;
      }
      if (useSSHKey && !sshKeyPath) {
        toast.error("Error", {
          description:
            "Select a private key file or disable key authentication",
        });
        return;
      }
      if (!useSSHKey && !useSSHAgent && !sshPassword) {
        toast.error("Error", {
          description:
            "Provide an SSH password or choose key/agent authentication",
        });
        return;
      }
    }

    if (useAwsSsm) {
      if (!ssmRegion.trim()) {
        toast.error("Error", {
          description: "AWS region is required when AWS SSM is enabled",
        });
        return;
      }
      if (!ssmTargetId.trim()) {
        toast.error("Error", {
          description: "Provide the SSM target instance or task identifier",
        });
        return;
      }
      if (!ssmRemoteHost.trim()) {
        toast.error("Error", {
          description: "Remote host is required when using AWS SSM",
        });
        return;
      }
    }

    setIsConnecting(true);
    try {
      const profile = buildConnectionProfile(connection?.id);

      if (isEditMode && connection.id) {
        await persistUpdate(connection.id, profile, selectedTags);
      } else {
        await persistConnection(profile, selectedTags);
      }

      if (onConnect) {
        onConnect(profile.id);
      }

      onOpenChange(false);
    } catch (error) {
      toast.error("Error", {
        description:
          error instanceof Error ? error.message : "Failed to connect",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0 [&>button[data-slot='dialog-close']]:size-auto [&>button[data-slot='dialog-close']_svg]:size-5 [&>button[data-slot='dialog-close']]:top-[0.625rem]"
      >
        <DialogHeader className="sticky top-0 bg-background px-4 py-2.5 border-b flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <IconDatabase className="h-3.5 w-3.5" />
            {isEditMode ? "Edit Connection" : "Connect Database"}
          </DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
              <IconX className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <Tabs
            value={dbType}
            onValueChange={(v) => {
              setDbType(v as DatabaseType);
            }}
            enableShortcuts={true}
            tabGroupId="connection-db-type"
            focused={open}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="postgresql" tabIndex={0} className="gap-1.5">
                <img
                  src={getDatabaseLogo(DbType.PostgreSQL)}
                  alt="PostgreSQL"
                  className="h-4 w-4"
                />
                PostgreSQL
              </TabsTrigger>
              <TabsTrigger value="mysql" tabIndex={1} className="gap-1.5">
                <img
                  src={getDatabaseLogo(DbType.MySQL)}
                  alt="MySQL"
                  className="h-4 w-4"
                />
                MySQL
              </TabsTrigger>
              <TabsTrigger value="sqlite" tabIndex={2} className="gap-1.5">
                <img
                  src={getDatabaseLogo(DbType.SQLite)}
                  alt="SQLite"
                  className="h-4 w-4"
                />
                SQLite
              </TabsTrigger>
              <TabsTrigger value="mssql" tabIndex={3} className="gap-1.5">
                <img
                  src={getDatabaseLogo(DbType.SQLServer)}
                  alt="SQL Server"
                  className="h-4 w-4"
                />
                SQL IconServer
              </TabsTrigger>
            </TabsList>

            <TabsContent value={dbType} className="space-y-4 mt-4">
              {/* Name and Tags */}
              <div className="grid grid-cols-2 gap-3">
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
                  <Label htmlFor="tags" className="text-xs">
                    Tags
                  </Label>
                  <Popover
                    open={tagsCommandOpen}
                    onOpenChange={setTagsCommandOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={tagsCommandOpen}
                        className="w-full justify-between mt-1 h-8 text-xs focus:ring-0 focus:ring-offset-0"
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
                                      "w-2.5 h-2.5 rounded-full flex-shrink-0",
                                      tagColor.bg,
                                    )}
                                  />
                                  <span className="text-xs truncate max-w-[100px]">
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
                        <IconChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                      <Command>
                        <CommandInput
                          className="outline-none focus:ring-0 focus:ring-offset-0 text-xs h-8"
                          placeholder="Search or create group..."
                          value={groupSearchValue}
                          onValueChange={setGroupSearchValue}
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
                                  className="gap-1.5 h-7 px-2 text-xs"
                                >
                                  <IconPlus className="h-3 w-3" />
                                  Create "{groupSearchValue}"
                                </Button>
                              )}
                            </div>
                          </CommandEmpty>

                          {/* Environment Tags */}
                          <CommandGroup
                            heading="Environment"
                            className="text-xs"
                          >
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
                                    className={cn(
                                      "w-2.5 h-2.5 rounded-full",
                                      t.color,
                                    )}
                                  />
                                  <span>{t.name}</span>
                                </div>
                                {selectedTags.includes(t.name) && (
                                  <IconCheck className="h-3.5 w-3.5" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>

                          {/* Group Tags */}
                          {groupTags.length > 0 && (
                            <CommandGroup heading="Groups" className="text-xs">
                              {groupTags.map((t) => (
                                <CommandItem
                                  key={t.name}
                                  value={t.name}
                                  onSelect={() => {
                                    if (editingGroupTag === t.name) return;
                                    handleTagToggle(t.name);
                                  }}
                                  className="group flex items-center justify-between text-xs"
                                >
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        "w-2.5 h-2.5 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-primary transition-all",
                                        t.color,
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleChangeGroupColor(t.name);
                                      }}
                                      title="Click to change color"
                                    />
                                    {editingGroupTag === t.name ? (
                                      <Input
                                        className="h-6 px-1 text-xs"
                                        value={editingGroupName}
                                        onChange={(e) => {
                                          setEditingGroupName(e.target.value);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            handleEditGroup(
                                              t.name,
                                              editingGroupName,
                                            );
                                          } else if (e.key === "Escape") {
                                            setEditingGroupTag(null);
                                            setEditingGroupName("");
                                          }
                                        }}
                                        onBlur={() => {
                                          handleEditGroup(
                                            t.name,
                                            editingGroupName,
                                          );
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                        }}
                                        autoFocus
                                      />
                                    ) : (
                                      <span>{t.name}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!editingGroupTag && (
                                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-5 w-5 p-0 hover:bg-accent"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingGroupTag(t.name);
                                            setEditingGroupName(t.name);
                                          }}
                                        >
                                          <IconPencil className="h-2.5 w-2.5" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-5 w-5 p-0 hover:bg-destructive/10"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteGroup(t.name);
                                          }}
                                        >
                                          <IconX className="h-2.5 w-2.5 text-destructive" />
                                        </Button>
                                      </div>
                                    )}
                                    {selectedTags.includes(t.name) && (
                                      <IconCheck className="h-3.5 w-3.5" />
                                    )}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}

                          {/* Create new group option - shows when typing */}
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

                  <div>
                    <Label htmlFor="database" className="text-xs">
                      IconDatabase
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
                </>
              ) : (
                <div>
                  <Label htmlFor="database" className="text-xs">
                    IconDatabase File
                  </Label>
                  <Input
                    id="database"
                    className="mt-1 h-8 text-xs"
                    value={database}
                    onChange={(e) => {
                      setDatabase(e.target.value);
                    }}
                    placeholder="/path/to/database.db"
                    disabled={isTesting}
                  />
                </div>
              )}

              {/* SSL and SSH Options */}
              {dbType !== "sqlite" && (
                <>
                  <div className="space-y-3">
                    <div>
                      <Label
                        htmlFor="ssl-mode"
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <IconShield className="h-3 w-3 text-muted-foreground" />
                        SSL Mode
                      </Label>
                      <Popover open={sslModeOpen} onOpenChange={setSslModeOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            id="ssl-mode"
                            variant="outline"
                            className="w-full justify-between mt-1 h-8 text-xs"
                          >
                            <span className="capitalize">{sslMode}</span>
                            <IconChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] p-1"
                          align="start"
                        >
                          <div className="flex flex-col">
                            {[
                              SslMode.Disable,
                              SslMode.Require,
                              SslMode.VerifyCa,
                              SslMode.VerifyFull,
                            ].map((mode) => (
                              <Button
                                key={mode}
                                variant={
                                  sslMode === mode ? "secondary" : "ghost"
                                }
                                className="justify-start capitalize text-xs h-8"
                                onClick={() => {
                                  setSslMode(mode);
                                  setSslModeOpen(false);
                                }}
                              >
                                {mode}
                              </Button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {sslMode !== SslMode.Disable && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="ssl-key" className="text-xs">
                              IconKey File
                            </Label>
                            <div className="relative mt-1">
                              <Input
                                id="ssl-key"
                                type="file"
                                accept=".pem,.key"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  setSslKeyFile(file?.name || "");
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                              />
                              <div className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs">
                                <span
                                  className={cn(
                                    "truncate",
                                    sslKeyFile
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {sslKeyFile || "Choose key file..."}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="ssl-cert" className="text-xs">
                              Certificate
                            </Label>
                            <div className="relative mt-1">
                              <Input
                                id="ssl-cert"
                                type="file"
                                accept=".pem,.crt,.cert"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  setSslCertFile(file?.name || "");
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                              />
                              <div className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs">
                                <span
                                  className={cn(
                                    "truncate",
                                    sslCertFile
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {sslCertFile || "Choose certificate..."}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="ssl-ca" className="text-xs">
                              CA Certificate
                            </Label>
                            <div className="relative mt-1">
                              <Input
                                id="ssl-ca"
                                type="file"
                                accept=".pem,.crt,.ca"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  setSslCAFile(file?.name || "");
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                              />
                              <div className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs">
                                <span
                                  className={cn(
                                    "truncate",
                                    sslCAFile
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {sslCAFile || "Choose CA certificate..."}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SSH Tunnel */}
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
                                <div className="mt-1 flex gap-2">
                                  <Input
                                    id="ssh-key"
                                    value={sshKeyPath}
                                    readOnly
                                    placeholder="Select private key..."
                                    className="flex-1 h-8 text-xs"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleSelectSSHKey}
                                    className="h-8 px-3 text-xs"
                                  >
                                    Browse
                                  </Button>
                                </div>
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
                </>
              )}
            </TabsContent>
          </Tabs>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs">
                <IconServer className="h-3 w-3 text-muted-foreground" />
                AWS SSM Bastion
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Beta
                </Badge>
              </Label>
              <Switch
                checked={useAwsSsm}
                onCheckedChange={(checked) => {
                  setUseAwsSsm(!!checked);
                }}
              />
            </div>
            {useAwsSsm && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ssm-region" className="text-xs">
                      Region *
                    </Label>
                    <Input
                      id="ssm-region"
                      className="mt-1 h-8 text-xs"
                      value={ssmRegion}
                      onChange={(e) => {
                        setSsmRegion(e.target.value);
                      }}
                      placeholder="us-east-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ssm-target" className="text-xs">
                      Target ID *
                    </Label>
                    <Input
                      id="ssm-target"
                      className="mt-1 h-8 text-xs"
                      value={ssmTargetId}
                      onChange={(e) => {
                        setSsmTargetId(e.target.value);
                      }}
                      placeholder="i-0123456789abcdef0 or ecs:cluster/task"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Authentication Method</Label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ssm-auth"
                        value="profile"
                        checked={ssmAuthType === "profile"}
                        onChange={() => {
                          setSsmAuthType("profile");
                        }}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs">AWS Profile</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ssm-auth"
                        value="oauth"
                        checked={ssmAuthType === "oauth"}
                        onChange={() => {
                          setSsmAuthType("oauth");
                        }}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs">SSO / OAuth</span>
                    </label>
                  </div>
                </div>
                {ssmAuthType === "profile" ? (
                  <div>
                    <Label htmlFor="ssm-profile" className="text-xs">
                      AWS Profile Name
                    </Label>
                    <Input
                      id="ssm-profile"
                      className="mt-1 h-8 text-xs"
                      value={ssmProfileName}
                      onChange={(e) => {
                        setSsmProfileName(e.target.value);
                      }}
                      placeholder="default"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="oauth-provider" className="text-xs">
                        SSO Provider *
                      </Label>
                      <Select
                        value={ssmOAuthProvider}
                        onValueChange={(value) => {
                          setSsmOAuthProvider(value);
                        }}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs w-full">
                          <SelectValue placeholder="Select SSO provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Microsoft">
                            Microsoft Entra ID
                          </SelectItem>
                          <SelectItem value="Google">
                            Google Workspace
                          </SelectItem>
                          <SelectItem value="Okta">Okta</SelectItem>
                          <SelectItem value="Auth0">Auth0</SelectItem>
                          <SelectItem value="Keycloak">Keycloak</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="oauth-client-id" className="text-xs">
                          Client ID *
                        </Label>
                        <Input
                          id="oauth-client-id"
                          className="mt-1 h-8 text-xs"
                          value={ssmOAuthClientId}
                          onChange={(e) => {
                            setSsmOAuthClientId(e.target.value);
                          }}
                          placeholder="Your OAuth app client ID"
                        />
                      </div>
                      {ssmOAuthProvider === "Microsoft" && (
                        <div>
                          <Label htmlFor="oauth-tenant-id" className="text-xs">
                            Tenant ID
                          </Label>
                          <Input
                            id="oauth-tenant-id"
                            className="mt-1 h-8 text-xs"
                            value={ssmOAuthTenantId}
                            onChange={(e) => {
                              setSsmOAuthTenantId(e.target.value);
                            }}
                            placeholder="common or your tenant ID"
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="assume-role-arn" className="text-xs">
                        AWS IAM Role ARN *
                      </Label>
                      <Input
                        id="assume-role-arn"
                        className="mt-1 h-8 text-xs"
                        value={ssmAssumeRoleArn}
                        onChange={(e) => {
                          setSsmAssumeRoleArn(e.target.value);
                        }}
                        placeholder="arn:aws:iam::123456789012:role/SSMAccessRole"
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        IAM role to assume using the OAuth token
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ssm-remote-host" className="text-xs">
                      Remote Host
                    </Label>
                    <Input
                      id="ssm-remote-host"
                      className="mt-1 h-8 text-xs"
                      value={ssmRemoteHost}
                      onChange={(e) => {
                        setSsmRemoteHost(e.target.value);
                      }}
                      placeholder={host}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ssm-remote-port" className="text-xs">
                      Remote Port
                    </Label>
                    <Input
                      id="ssm-remote-port"
                      className="mt-1 h-8 text-xs"
                      value={ssmRemotePort}
                      onChange={(e) => {
                        setSsmRemotePort(e.target.value);
                      }}
                      placeholder={getDefaultPort(dbType)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 bg-background border-t px-4 py-2.5 gap-2">
          <div className="flex items-center gap-2 flex-1">
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                void handlePasteUri();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void handlePasteUri();
                }
              }}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3 cursor-pointer select-none",
                uriParsed && "text-green-600",
              )}
              style={{ WebkitUserSelect: "none", userSelect: "none" }}
            >
              {uriParsed && (
                <>
                  <IconClipboardCheck className="h-3 w-3" />
                  Parsed
                </>
              )}
              {!uriParsed && (
                <>
                  <IconClipboardText className="h-3 w-3" />
                  Paste Config
                </>
              )}
            </div>
            {testStatusMessage && (
              <span className="text-xs text-muted-foreground select-text truncate">
                {testStatusMessage}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="xs"
            onClick={handleTest}
            disabled={isTesting || isSaving || isConnecting}
            className={cn("h-8 px-3 text-xs", testSuccess && "text-green-600")}
          >
            {isTesting ? (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                {testStage === "ssh" ? "Testing SSH…" : "Testing DB…"}
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
            size="xs"
            onClick={handleSave}
            disabled={isSaving || isConnecting || isTesting}
            className="h-8 px-3 text-xs"
          >
            {isSaving && (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Saving...
              </>
            )}
            {!isSaving && "Save"}
          </Button>
          <Button
            size="xs"
            onClick={handleConnect}
            disabled={isConnecting || isSaving || isTesting}
            className="h-8 px-4 text-xs"
          >
            {isConnecting && (
              <>
                <IconLoader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Connecting...
              </>
            )}
            {!isConnecting && "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
