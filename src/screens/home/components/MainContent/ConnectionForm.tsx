import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/stores/connectionStoreNew";
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
  type AwsSsmConfig,
  type AwsAuthMethod,
  DbType,
  SslMode,
} from "@/types/connection";

const { readText } = await import("@tauri-apps/plugin-clipboard-manager");

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

interface GroupTag {
  name: string;
  color: string;
}

const getGroupTags = (): GroupTag[] => {
  const stored = localStorage.getItem("query_pilot_group_tags");
  return stored ? (JSON.parse(stored) as GroupTag[]) : [];
};

const saveGroupTags = (tags: GroupTag[]) => {
  localStorage.setItem("query_pilot_group_tags", JSON.stringify(tags));
};

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
      const dbTypeMap: Record<number, DatabaseType> = {
        0: "postgresql",
        1: "mysql",
        2: "sqlite",
        3: "mssql",
      };
      return (
        dbTypeMap[connection.profile.db_type as unknown as number] ||
        "postgresql"
      );
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
  const [sslMode, setSslMode] = useState<SslMode>(
    connection?.profile.ssl_mode || SslMode.Disable,
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    if (isEditMode && connection.profile.tags) {
      return connection.metadata.tags || [];
    }
    return ["local"];
  });

  // Group tag management
  const [groupTags, setGroupTags] = useState<GroupTag[]>(getGroupTags());
  const [tagsCommandOpen, setTagsCommandOpen] = useState(false);
  const [groupSearchValue, setGroupSearchValue] = useState("");

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

  // AWS SSM state
  const existingAwsSsm = connection?.profile.bastion
    ? ((connection.profile.bastion as any).AwsSsm as AwsSsmConfig | undefined)
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
  const [ssmOAuthProvider, setSsmOAuthProvider] = useState("Microsoft");
  const [ssmOAuthClientId, setSsmOAuthClientId] = useState("");
  const [ssmOAuthTenantId, setSsmOAuthTenantId] = useState("");
  const [ssmAssumeRoleArn, setSsmAssumeRoleArn] = useState("");
  const [ssmRemoteHost, setSsmRemoteHost] = useState(
    existingAwsSsm?.remote_host || host,
  );
  const [ssmRemotePort, setSsmRemotePort] = useState(
    existingAwsSsm?.remote_port ? existingAwsSsm.remote_port.toString() : port,
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

  const handleParseEnv = (text: string) => {
    try {
      const config = parseConnectionEnv(text);
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
      toast.success("Environment Config Parsed");
    } catch (error) {
      toast.error("Invalid Environment Format", {
        description: error instanceof Error ? error.message : "Failed to parse",
      });
    }
  };

  const handleParseUri = (uri: string) => {
    try {
      const config = parseConnectionUri(uri);
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
      console.error(error);
      toast.error("Clipboard Access Failed");
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

  const handleCreateGroup = (groupName: string) => {
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
    const updatedTags = [...groupTags, newGroup];
    setGroupTags(updatedTags);
    saveGroupTags(updatedTags);
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

    if (useAwsSsm) {
      const auth: AwsAuthMethod =
        ssmAuthType === "oauth"
          ? {
              OAuthFederated: {
                provider: ssmOAuthProvider as any,
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
          remote_port: parseInt(ssmRemotePort, 10) || profile.port || 5432,
        },
      };
    }

    return profile;
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

      // TODO: Implement actual connection
      console.log("Connect to", profile.id);

      closeForm();
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
    { value: "sqlite", label: "SQLite", logo: getDatabaseLogo(DbType.SQLite) },
    {
      value: "mssql",
      label: "SQL Server",
      logo: getDatabaseLogo(DbType.SQLServer),
    },
  ];

  const currentDbType = dbTypeOptions.find((opt) => opt.value === dbType);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={closeForm}
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>

          <span className="text-sm font-semibold">
            {isEditMode
              ? "Edit Connection"
              : formMode === "import"
              ? "Import Connection"
              : "New Connection"}
          </span>
        </div>

        <Select
          value={dbType}
          onValueChange={(v) => {
            setDbType(v as DatabaseType);
          }}
        >
          <SelectTrigger className="w-auto h-7 gap-2 text-xs border-none shadow-none px-2">
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
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Form Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
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
              <Popover open={tagsCommandOpen} onOpenChange={setTagsCommandOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between mt-1 h-8 text-xs"
                    disabled={isTesting}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {selectedTags.length > 0 ? (
                        selectedTags.map((tag) => {
                          const isGroup = groupTags.some((g) => g.name === tag);
                          const tagColor = getTagColor(tag, isGroup);
                          return (
                            <div
                              key={tag}
                              className="flex items-center gap-1.5"
                            >
                              <div
                                className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0",
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
                </PopoverTrigger>
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

          {/* SSL Mode */}
          {dbType !== "sqlite" && (
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <IconShield className="h-3 w-3 text-muted-foreground" />
                SSL Mode
              </Label>
              <Popover open={sslModeOpen} onOpenChange={setSslModeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between mt-1 h-8 text-xs"
                  >
                    <span className="capitalize">{sslMode}</span>
                    <IconChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1">
                  <div className="flex flex-col">
                    {[
                      SslMode.Disable,
                      SslMode.Require,
                      SslMode.VerifyCa,
                      SslMode.VerifyFull,
                    ].map((mode) => (
                      <Button
                        key={mode}
                        variant={sslMode === mode ? "secondary" : "ghost"}
                        className="justify-start capitalize text-xs h-7"
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

          {/* AWS SSM */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs">
                <IconServer className="h-3 w-3 text-muted-foreground" />
                AWS SSM Bastion
                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                  Beta
                </Badge>
              </Label>
              <Switch checked={useAwsSsm} onCheckedChange={setUseAwsSsm} />
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
                      placeholder="i-0123456789abcdef0"
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
                        className="h-3 w-3"
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
                        className="h-3 w-3"
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
                        onValueChange={setSsmOAuthProvider}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
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
                        </SelectContent>
                      </Select>
                    </div>

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
            uriParsed && "text-green-600",
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
              testSuccess && "text-green-600",
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
