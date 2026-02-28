import { useState } from "react";
import { IconLink, IconArrowRight, IconLock } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  parseConnectionUri,
  parseConnectionEnv,
  detectConnectionFormat,
  type ParsedUriConfig,
  type ParsedEnvConfig,
} from "@/utils/connectionParser";
import { DbType } from "@/types/connection";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { toast } from "sonner";

function mapDatabaseType(dbType: string): DbType {
  const mapping: Record<string, DbType> = {
    postgresql: DbType.PostgreSQL,
    mysql: DbType.MySQL,
    mariadb: DbType.MariaDB,
    sqlite: DbType.SQLite,
    mssql: DbType.SQLServer,
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
  [DbType.MongoDB]: "MongoDB",
  [DbType.Redis]: "Redis",
};

interface ParsedInfo {
  dbType: DbType;
  host?: string;
  port?: string;
  username?: string;
  hasPassword: boolean;
  database?: string;
  format: "uri" | "env";
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
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
      <img
        src={getDatabaseLogo(info.dbType)}
        alt=""
        className="h-8 w-8 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{displayName}</span>
          {info.hasPassword && (
            <IconLock className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-[10px] text-muted-foreground/60 uppercase ml-auto">
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
  const [isConnecting, setIsConnecting] = useState(false);
  const [parsedInfo, setParsedInfo] = useState<ParsedInfo | null>(null);
  const saveConnection = useConnectionStore((s) => s.saveConnection);

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
        if (parsed.dbType) {
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

  const handleConnect = async () => {
    if (!uri.trim()) return;

    setIsConnecting(true);
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

      const profile = {
        id: crypto.randomUUID(),
        name: config.database || config.host || "Quick Connection",
        db_type: mapDatabaseType(config.dbType || "postgresql"),
        host: config.host || "localhost",
        port: parseInt(config.port || "5432", 10),
        username: config.username || "",
        password: config.password || "",
        database: config.database || "",
        options: {},
      };

      await saveConnection(profile, []);
      toast.success("Connection created", {
        description: `${profile.name} has been added`,
      });
      onOpenChange(false);
      setUri("");
      setParsedInfo(null);
    } catch (error) {
      toast.error("Failed to create connection", {
        description: error instanceof Error ? error.message : "Invalid format",
      });
    } finally {
      setIsConnecting(false);
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
          className="min-h-[100px] font-mono text-xs break-all"
        />

        {parsedInfo && <ConnectionSummary info={parsedInfo} />}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              setUri("");
              setParsedInfo(null);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!parsedInfo || isConnecting}
          >
            {isConnecting ? "Connecting..." : "Connect"}
            <IconArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
