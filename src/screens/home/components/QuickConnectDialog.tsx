import { useState, useMemo } from "react";
import { IconLink, IconLock, IconLayout2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import {
  parseConnectionUri,
  parseConnectionEnv,
  detectConnectionFormat,
  type ParsedUriConfig,
  type ParsedEnvConfig,
} from "@/utils/connectionParser";
import {
  DbType,
  type ConnectionProfile,
  type SshAuthMethod,
} from "@/types/connection";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { toast } from "sonner";

function mapDatabaseType(dbType: string): DbType {
  const mapping: Record<string, DbType> = {
    postgresql: DbType.PostgreSQL,
    mysql: DbType.MySQL,
    mariadb: DbType.MariaDB,
    sqlite: DbType.SQLite,
    mssql: DbType.SQLServer,
    oracle: DbType.Oracle,
    mongodb: DbType.MongoDB,
    redis: DbType.Redis,
  };
  return mapping[dbType] || DbType.PostgreSQL;
}

const DB_DISPLAY_NAMES: Record<string, string> = {
  [DbType.PostgreSQL]: "PostgreSQL",
  [DbType.MySQL]: "MySQL",
  [DbType.MariaDB]: "MariaDB",
  [DbType.SQLite]: "SQLite",
  [DbType.SQLServer]: "SQL Server",
  [DbType.Oracle]: "Oracle",
  [DbType.MongoDB]: "MongoDB",
  [DbType.Redis]: "Redis",
};

function getDefaultPort(dbType: DbType): number {
  switch (dbType) {
    case DbType.PostgreSQL:
      return 5432;
    case DbType.MySQL:
    case DbType.MariaDB:
      return 3306;
    case DbType.SQLServer:
      return 1433;
    case DbType.Oracle:
      return 1521;
    case DbType.MongoDB:
      return 27017;
    case DbType.Redis:
      return 6379;
    case DbType.SQLite:
    case DbType.DuckDB:
      return 0;
  }
}

interface ParsedInfo {
  dbType: DbType;
  host?: string;
  port?: string;
  username?: string;
  hasPassword: boolean;
  database?: string;
  format: "uri" | "env";
  hasSSH: boolean;
}

function extractParsedInfo(
  config: ParsedUriConfig | ParsedEnvConfig,
  format: "uri" | "env",
): ParsedInfo {
  return {
    dbType: mapDatabaseType(config.dbType || "postgresql"),
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: Boolean(config.password),
    database: config.database,
    format,
    hasSSH: Boolean((config as ParsedEnvConfig).useSSH),
  };
}

function ConnectionSummary({ info }: { info: ParsedInfo }) {
  const displayName = DB_DISPLAY_NAMES[info.dbType] || info.dbType;

  // Build host:port string
  let hostStr = info.host || "localhost";
  if (info.port) {
    hostStr += `:${info.port}`;
  }

  // Build user@host string
  let connectionStr = "";
  if (info.username) {
    connectionStr = `${info.username}@`;
  }
  connectionStr += hostStr;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border overflow-hidden">
      <img
        src={getDatabaseLogo(info.dbType)}
        alt=""
        className="h-8 w-8 shrink-0"
      />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{displayName}</span>
          {info.hasPassword && (
            <IconLock className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          {info.hasSSH && (
            <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">
              SSH
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 uppercase ml-auto shrink-0">
            {info.format}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {connectionStr}
          {info.database && (
            <>
              <span className="mx-1 opacity-40">/</span>
              {info.database}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickConnectDialog({
  open,
  onOpenChange,
}: QuickConnectDialogProps) {
  const [uri, setUri] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [parsedInfo, setParsedInfo] = useState<ParsedInfo | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const saveConnection = useConnectionStore((s) => s.saveConnection);
  const savedWorkspaces = useWorkspaceBundleStore((s) => s.savedWorkspaces);
  const addConnectionToSavedWorkspace = useWorkspaceBundleStore(
    (s) => s.addConnectionToSavedWorkspace,
  );
  const userWorkspaces = useMemo(
    () => savedWorkspaces.filter((ws) => !ws.autoCreated),
    [savedWorkspaces],
  );

  const handleUriChange = (value: string) => {
    setUri(value);

    if (!value.trim()) {
      setParsedInfo(null);
      return;
    }

    try {
      const format = detectConnectionFormat(value);
      if (format === "uri") {
        const parsed = parseConnectionUri(value);
        setParsedInfo(extractParsedInfo(parsed, "uri"));
      } else if (format === "env") {
        const parsed = parseConnectionEnv(value);
        if (parsed.dbType || parsed.host || parsed.database) {
          setParsedInfo(extractParsedInfo(parsed, "env"));
        } else {
          setParsedInfo(null);
        }
      } else {
        setParsedInfo(null);
      }
    } catch {
      setParsedInfo(null);
    }
  };

  const handleSave = async () => {
    if (!uri.trim()) return;

    setIsSaving(true);
    try {
      const format = detectConnectionFormat(uri);
      let config: ParsedUriConfig | ParsedEnvConfig;

      if (format === "uri") {
        config = parseConnectionUri(uri);
      } else if (format === "env") {
        config = parseConnectionEnv(uri);
      } else {
        toast.error("Could not parse connection string");
        return;
      }

      const profile: ConnectionProfile = {
        id: crypto.randomUUID(),
        name: config.database || config.host || "Quick Connection",
        db_type: mapDatabaseType(config.dbType || "postgresql"),
        host: config.host || "localhost",
        port: parseInt(
          config.port || String(getDefaultPort(mapDatabaseType(config.dbType || "postgresql"))),
          10,
        ),
        username: config.username || "",
        password: config.password || "",
        database: config.database || "",
        ssl_mode: config.sslMode,
        ssl_config:
          ("sslKeyFile" in config && config.sslKeyFile) ||
          ("sslCertFile" in config && config.sslCertFile) ||
          ("sslCAFile" in config && config.sslCAFile)
            ? {
                key_file:
                  "sslKeyFile" in config ? config.sslKeyFile || undefined : undefined,
                cert_file:
                  "sslCertFile" in config ? config.sslCertFile || undefined : undefined,
                ca_file:
                  "sslCAFile" in config ? config.sslCAFile || undefined : undefined,
              }
            : undefined,
        options: {
          ...("options" in config ? config.options || {} : {}),
          ...(mapDatabaseType(config.dbType || "postgresql") === DbType.Oracle
            ? { oracle_connect_mode: "service_name" }
            : {}),
        },
      };

      // Include SSH tunnel config if parsed from env vars
      if (format === "env") {
        const envConfig = config as ParsedEnvConfig;
        if (envConfig.useSSH && envConfig.sshHost) {
          const auth: SshAuthMethod =
            envConfig.useSSHKey && envConfig.sshKeyPath
              ? { KeyFile: { path: envConfig.sshKeyPath, passphrase: null } }
              : { Password: envConfig.sshPassword || "" };
          profile.ssh_tunnel = {
            host: envConfig.sshHost,
            port: parseInt(envConfig.sshPort || "22", 10),
            user: envConfig.sshUser || "",
            auth,
          };
        }
      }

      const connectionId = await saveConnection(profile, []);

      if (selectedWorkspaceId && connectionId) {
        await addConnectionToSavedWorkspace(selectedWorkspaceId, connectionId);
      }

      toast.success("Connection created", {
        description: `${profile.name} has been added`,
      });
      onOpenChange(false);
      setUri("");
      setParsedInfo(null);
      setSelectedWorkspaceId("");
    } catch (error) {
      toast.error("Failed to create connection", {
        description: error instanceof Error ? error.message : "Invalid format",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconLink className="h-4 w-4" />
            Quick Connect
          </DialogTitle>
          <DialogDescription>
            Paste a connection URI, DSN, connection string, or environment
            variables.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          placeholder={`postgresql://user:pass@localhost:5432/mydb\nServer=localhost;Database=master;User Id=sa;\nDATABASE_URL=postgres://...\nPOSTGRES_HOST=localhost`}
          value={uri}
          onChange={(e) => {
            handleUriChange(e.target.value);
          }}
          className="min-h-[100px] font-mono text-xs overflow-wrap-anywhere"
          style={{ overflowWrap: "anywhere" }}
        />

        {parsedInfo && <ConnectionSummary info={parsedInfo} />}

        {userWorkspaces.length > 0 && (() => {
          const selectedWs = userWorkspaces.find((w) => w.id === selectedWorkspaceId);
          const wsLabel = (ws: { icon?: string; name: string }) =>
            ws.icon ? `${ws.icon} ${ws.name}` : ws.name;
          return (
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <IconLayout2 className="h-3 w-3 text-muted-foreground" />
                Workspace
              </Label>
              <Select
                value={selectedWorkspaceId || undefined}
                onValueChange={(val) => { setSelectedWorkspaceId(val ?? ""); }}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <span className={selectedWs ? "truncate" : "text-muted-foreground truncate"}>
                    {selectedWs ? wsLabel(selectedWs) : "No workspace"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {userWorkspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id} className="text-xs">
                      {wsLabel(ws)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })()}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              setUri("");
              setParsedInfo(null);
              setSelectedWorkspaceId("");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!parsedInfo || isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
