import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Database,
  Loader2,
  CheckCircle2,
  ChevronDown,
  Shield,
  Server,
  Plus,
  X,
  Check,
  ClipboardPaste,
  ClipboardCheck,
  XIcon,
  Edit2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { toast } from "sonner";
import {
  detectConnectionFormat,
  parseConnectionEnv,
  parseConnectionUri,
  type DatabaseType,
} from "@/utils/connectionParser";

import { type ConnectionProfile, DbType, SslMode } from "@/types/connection";
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
];

// Get group tags from localStorage
const getGroupTags = (): GroupTag[] => {
  const stored = localStorage.getItem("query_pilot_group_tags");
  return stored ? (JSON.parse(stored) as GroupTag[]) : [];
};

// Save group tags to localStorage
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
      // Check if it's a ConnectionProfile (has db_type field)
      if ("db_type" in connection) {
        const dbTypeMap: Record<number, DatabaseType> = {
          0: "postgresql", // DbType.PostgreSQL
          1: "mysql", // DbType.MySQL
          2: "sqlite", // DbType.SQLite
          3: "mssql", // DbType.SQLServer
        };
        return dbTypeMap[connection.db_type] || "postgresql";
      }
      // Otherwise it's a DatabaseConnection (has type field)
      const type = connection.type.toLowerCase();
      if (type === "mariadb") return "mysql";
      if (type && ["postgresql", "mysql", "sqlite", "mssql"].includes(type)) {
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
  const [useSSH, setUseSSH] = useState(!!connection?.ssh_tunnel);
  const [sshHost, setSshHost] = useState(connection?.ssh_tunnel?.host || "");
  const [sshPort, setSshPort] = useState(
    connection?.ssh_tunnel?.port.toString() || "22",
  );
  const [sshUser, setSshUser] = useState(connection?.ssh_tunnel?.user || "");
  const [sshPassword, setSshPassword] = useState(
    connection?.ssh_tunnel?.auth && "Password" in connection.ssh_tunnel.auth
      ? connection.ssh_tunnel.auth.Password
      : "",
  );
  const [useSSHKey, setUseSSHKey] = useState(
    !!(connection?.ssh_tunnel?.auth && "KeyFile" in connection.ssh_tunnel.auth),
  );
  const [sshKeyPath, setSshKeyPath] = useState(
    connection?.ssh_tunnel?.auth && "KeyFile" in connection.ssh_tunnel.auth
      ? connection.ssh_tunnel.auth.KeyFile.path
      : "",
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

  // Update port when database type changes
  useEffect(() => {
    if (!connection) {
      setPort(getDefaultPort(dbType));
    }
  }, [dbType, connection]);

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
      if (config.database) setDatabase(config.database);
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
      if (config.database) setDatabase(config.database);
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
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
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
          description: "No text found in clipboard. Copy connection details first.",
        });
      }
    } catch (error) {
      console.error("Clipboard error:", error);

      // Check if it's the "not available in requested format" error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("not available in the requested format") ||
        errorMessage.includes("clipboard is empty")
      ) {
        toast.error("Clipboard Empty", {
          description: "No text found in clipboard. Copy connection details first.",
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
              "No text found in clipboard. Copy connection details first.",
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

    // Check if group already exists
    const exists = groupTags.some((t) => t.name === groupName);
    if (exists) {
      toast.error("Group already exists", {
        description: `"${groupName}" is already in your groups`,
      });
      return;
    }

    // Assign a color from available colors
    const usedColors = groupTags.map((t) => t.color);
    const availableColor = TAG_COLORS.find(
      (c) => !usedColors.includes(c.class),
    );
    const color =
      availableColor?.class || TAG_COLORS[0]?.class || "bg-gray-500";

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

    // Check if new name already exists
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

  const getTagColor = (tagName: string, isGroup: boolean = false) => {
    if (!isGroup) {
      // Check environment tags
      const envTag = ENVIRONMENT_TAGS.find((t) => t.name === tagName);
      if (envTag) return { bg: envTag.color, text: envTag.textColor };
    } else {
      // Check group tags
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

  const handleTest = async () => {
    setIsTesting(true);
    setTestSuccess(false);

    try {
      // Build connection profile for testing
      const profile: ConnectionProfile = {
        id: `test-${Date.now()}`, // Temporary ID for testing
        name: name || "Test Connection",
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
            ? parseInt(port) || parseInt(getDefaultPort(dbType))
            : 5432,
        username: dbType !== "sqlite" ? username : "",
        password: dbType !== "sqlite" ? password : undefined,
        database,
        ssl_mode: sslMode,
        options: {},
      };

      // Use Tauri commands directly
      const { invoke } = await import("@tauri-apps/api/core");

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
          errorDetails = `Connection refused. Please check:\n• Database is running\n• Host and port are correct\n• Firewall settings`;
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

      toast.error("Connection Failed", {
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Error", {
        description: "Please provide a connection name",
      });
      return;
    }

    setIsSaving(true);
    try {
      const profile: ConnectionProfile = {
        id: connection?.id || `conn-${Date.now()}`,
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
            ? parseInt(port) || parseInt(getDefaultPort(dbType))
            : 5432,
        username: dbType !== "sqlite" ? username : "",
        password: dbType !== "sqlite" ? password : undefined,
        database: dbType !== "sqlite" ? database : database,
        ssl_mode: sslMode,
        ssl_config:
          sslMode !== SslMode.Disable &&
          (sslKeyFile || sslCertFile || sslCAFile)
            ? {
                key_file: sslKeyFile || undefined,
                cert_file: sslCertFile || undefined,
                ca_file: sslCAFile || undefined,
              }
            : undefined,
        ssh_tunnel: useSSH
          ? {
              host: sshHost,
              port: Number.parseInt(sshPort),
              user: sshUser,
              auth: useSSHKey
                ? { KeyFile: { path: sshKeyPath, passphrase: undefined } }
                : { Password: sshPassword },
            }
          : undefined,
        options: {},
      };

      // Save or update the connection with tags
      console.log("Saving connection with tags:", selectedTags);
      console.log("Profile:", JSON.stringify(profile, null, 2));

      try {
        if (isEditMode && connection.id) {
          console.log(
            "Updating connection via vault:",
            connection.id,
            profile,
            selectedTags,
          );
          await persistUpdate(connection.id, profile, selectedTags);
          console.log("Update successful");
        } else {
          console.log(
            "Creating new connection via vault:",
            profile,
            selectedTags,
          );
          await persistConnection(profile, selectedTags);
          console.log("Create successful");
        }
      } catch (invokeError) {
        console.error("Invoke error:", invokeError);
        throw invokeError;
      }

      toast.success("Success", {
        description: isEditMode
          ? "Connection updated successfully"
          : "Connection saved successfully",
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Save connection error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save connection";
      console.error("Error details:", errorMessage);
      toast.error("Error", {
        description: errorMessage,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const profile: ConnectionProfile = {
        id: connection?.id || `conn-${Date.now()}`,
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
            ? parseInt(port) || parseInt(getDefaultPort(dbType))
            : 5432,
        username: dbType !== "sqlite" ? username : "",
        password: dbType !== "sqlite" ? password : undefined,
        database: dbType !== "sqlite" ? database : database,
        ssl_mode: sslMode,
        ssl_config:
          sslMode !== SslMode.Disable &&
          (sslKeyFile || sslCertFile || sslCAFile)
            ? {
                key_file: sslKeyFile || undefined,
                cert_file: sslCertFile || undefined,
                ca_file: sslCAFile || undefined,
              }
            : undefined,
        ssh_tunnel: useSSH
          ? {
              host: sshHost,
              port: Number.parseInt(sshPort),
              user: sshUser,
              auth: useSSHKey
                ? { KeyFile: { path: sshKeyPath, passphrase: undefined } }
                : { Password: sshPassword },
            }
          : undefined,
        options: {},
      };

      const connectionId = await persistConnection(profile, selectedTags);
      if (onConnect) {
        onConnect(connectionId || profile.id);
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
        <DialogHeader className="sticky top-0 bg-background px-4 py-2 border-b flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            {isEditMode ? "Edit Connection" : "Connect Database"}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <XIcon className="size-5" />
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <Tabs
            value={dbType}
            onValueChange={(v) => {
              setDbType(v as DatabaseType);
            }}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="postgresql">PostgreSQL</TabsTrigger>
              <TabsTrigger value="mysql">MySQL</TabsTrigger>
              <TabsTrigger value="sqlite">SQLite</TabsTrigger>
              <TabsTrigger value="mssql">SQL Server</TabsTrigger>
            </TabsList>

            <TabsContent value={dbType} className="space-y-6 mt-6">
              {/* Name and Tags */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    className="mt-1.5"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                    placeholder={`My ${dbType} Database`}
                    disabled={isTesting}
                  />
                </div>
                <div>
                  <Label htmlFor="tags">Tags</Label>
                  <Popover
                    open={tagsCommandOpen}
                    onOpenChange={setTagsCommandOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={tagsCommandOpen}
                        className="w-full justify-between mt-1.5 focus:ring-0 focus:ring-offset-0"
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
                                      "w-3 h-3 rounded-full flex-shrink-0",
                                      tagColor.bg,
                                    )}
                                  />
                                  <span className="text-sm truncate max-w-[100px]">
                                    {tag}
                                  </span>
                                </div>
                              );
                            })
                          ) : (
                            <span className="text-muted-foreground">
                              Select tags...
                            </span>
                          )}
                        </div>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                      <Command>
                        <CommandInput
                          className="outline-none focus:ring-0 focus:ring-offset-0"
                          placeholder="Search or create group..."
                          value={groupSearchValue}
                          onValueChange={setGroupSearchValue}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <div className="py-2 text-center">
                              <p className="text-sm text-muted-foreground mb-2">
                                No group found.
                              </p>
                              {groupSearchValue && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    handleCreateGroup(groupSearchValue);
                                  }}
                                  className="gap-2"
                                >
                                  <Plus className="h-3 w-3" />
                                  Create "{groupSearchValue}"
                                </Button>
                              )}
                            </div>
                          </CommandEmpty>

                          {/* Environment Tags */}
                          <CommandGroup heading="Environment">
                            {ENVIRONMENT_TAGS.map((t) => (
                              <CommandItem
                                key={t.name}
                                value={t.name}
                                onSelect={() => {
                                  handleTagToggle(t.name);
                                }}
                                className="flex items-center justify-between"
                              >
                                <div className="flex items-center gap-2">
                                  <div
                                    className={cn(
                                      "w-3 h-3 rounded-full",
                                      t.color,
                                    )}
                                  />
                                  <span>{t.name}</span>
                                </div>
                                {selectedTags.includes(t.name) && (
                                  <Check className="h-4 w-4" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>

                          {/* Group Tags */}
                          {groupTags.length > 0 && (
                            <CommandGroup heading="Groups">
                              {groupTags.map((t) => (
                                <CommandItem
                                  key={t.name}
                                  value={t.name}
                                  onSelect={() => {
                                    if (editingGroupTag === t.name) return;
                                    handleTagToggle(t.name);
                                  }}
                                  className="group flex items-center justify-between"
                                >
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        "w-3 h-3 rounded-full",
                                        t.color,
                                      )}
                                    />
                                    {editingGroupTag === t.name ? (
                                      <Input
                                        className="h-6 px-1"
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
                                          className="h-6 w-6 p-0 hover:bg-accent"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingGroupTag(t.name);
                                            setEditingGroupName(t.name);
                                          }}
                                        >
                                          <Edit2 className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 hover:bg-destructive/10"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteGroup(t.name);
                                          }}
                                        >
                                          <X className="h-3 w-3 text-destructive" />
                                        </Button>
                                      </div>
                                    )}
                                    {selectedTags.includes(t.name) && (
                                      <Check className="h-4 w-4" />
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
                                >
                                  <Plus className="h-4 w-4 mr-2" />
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
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-8">
                      <Label htmlFor="host">Host/Socket</Label>
                      <Input
                        id="host"
                        className="mt-1.5"
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                        }}
                        placeholder="127.0.0.1"
                        disabled={isTesting}
                      />
                    </div>
                    <div className="col-span-4">
                      <Label htmlFor="port">Port</Label>
                      <Input
                        id="port"
                        className="mt-1.5"
                        value={port}
                        onChange={(e) => {
                          setPort(e.target.value);
                        }}
                        placeholder={getDefaultPort(dbType)}
                        disabled={isTesting}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="username">User</Label>
                      <Input
                        id="username"
                        className="mt-1.5"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                        }}
                        placeholder="username"
                        disabled={isTesting}
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        className="mt-1.5"
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
                    <Label htmlFor="database">Database</Label>
                    <Input
                      id="database"
                      className="mt-1.5"
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
                  <Label htmlFor="database">Database File</Label>
                  <Input
                    id="database"
                    className="mt-1.5"
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
                  <div className="space-y-4">
                    <div>
                      <Label
                        htmlFor="ssl-mode"
                        className="flex items-center gap-2"
                      >
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        SSL Mode
                      </Label>
                      <Popover open={sslModeOpen} onOpenChange={setSslModeOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            id="ssl-mode"
                            variant="outline"
                            className="w-full justify-between mt-1.5"
                          >
                            <span className="capitalize">{sslMode}</span>
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
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
                                className="justify-start capitalize"
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
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label htmlFor="ssl-key" className="text-xs">
                              Key File
                            </Label>
                            <div className="relative mt-1.5">
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
                              <div className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs">
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
                            <div className="relative mt-1.5">
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
                              <div className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs">
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
                            <div className="relative mt-1.5">
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
                              <div className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs">
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
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        SSH Tunnel
                      </Label>
                      <Switch checked={useSSH} onCheckedChange={setUseSSH} />
                    </div>

                    {useSSH && (
                      <>
                        <div className="grid grid-cols-12 gap-4">
                          <div className="col-span-8">
                            <Label htmlFor="ssh-host">SSH Server</Label>
                            <Input
                              id="ssh-host"
                              className="mt-1.5"
                              value={sshHost}
                              onChange={(e) => {
                                setSshHost(e.target.value);
                              }}
                              placeholder="192.168.1.1"
                            />
                          </div>
                          <div className="col-span-4">
                            <Label htmlFor="ssh-port">Port</Label>
                            <Input
                              id="ssh-port"
                              className="mt-1.5"
                              value={sshPort}
                              onChange={(e) => {
                                setSshPort(e.target.value);
                              }}
                              placeholder="22"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="ssh-user">SSH User</Label>
                            <Input
                              id="ssh-user"
                              className="mt-1.5"
                              value={sshUser}
                              onChange={(e) => {
                                setSshUser(e.target.value);
                              }}
                              placeholder="username"
                            />
                          </div>
                          <div>
                            <Label htmlFor="ssh-password">SSH Password</Label>
                            <Input
                              id="ssh-password"
                              className="mt-1.5"
                              type="password"
                              value={sshPassword}
                              onChange={(e) => {
                                setSshPassword(e.target.value);
                              }}
                              placeholder="password"
                              disabled={useSSHKey}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="use-ssh-key"
                              checked={useSSHKey}
                              onCheckedChange={(checked) => {
                                setUseSSHKey(!!checked);
                              }}
                            />
                            <Label
                              htmlFor="use-ssh-key"
                              className="cursor-pointer"
                            >
                              Use SSH Key
                            </Label>
                          </div>
                          {useSSHKey && (
                            <div>
                              <Label htmlFor="ssh-key" className="text-xs">
                                Private Key
                              </Label>
                              <div className="relative mt-1.5">
                                <Input
                                  id="ssh-key"
                                  type="file"
                                  accept=".pem,.key,id_rsa,id_ed25519,id_ecdsa"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setSshKeyPath(file.name);
                                    }
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                                <div className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs">
                                  <span
                                    className={cn(
                                      "truncate",
                                      sshKeyPath
                                        ? "text-foreground"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {sshKeyPath || "Choose private key..."}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="sticky bottom-0 bg-background border-t px-3 py-1.5 gap-1.5">
          <div className="flex-1">
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
                "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3 py-1 cursor-pointer select-none",
                uriParsed && "text-green-600",
              )}
              style={{ WebkitUserSelect: "none", userSelect: "none" }}
            >
              {uriParsed && (
                <>
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Parsed
                </>
              )}
              {!uriParsed && (
                <>
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste Config
                </>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting || isSaving || isConnecting}
            className={cn("h-8 px-3", testSuccess && "text-green-600")}
          >
            {isTesting && (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Testing...
              </>
            )}
            {!isTesting && testSuccess && (
              <>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Tested
              </>
            )}
            {!isTesting && !testSuccess && "Test"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isConnecting || isTesting}
            className="h-8 px-3"
          >
            {isSaving && (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            )}
            {!isSaving && "Save"}
          </Button>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting || isSaving || isTesting}
            className="h-8 px-4"
          >
            {isConnecting && (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
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
