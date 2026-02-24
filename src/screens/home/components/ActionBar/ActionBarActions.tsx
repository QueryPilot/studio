import { useState } from "react";
import {
  IconPlus,
  IconLayout2,
  IconLink,
  IconArrowRight,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  parseConnectionUri,
  parseConnectionEnv,
  detectConnectionFormat,
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

interface QuickConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function QuickConnectDialog({ open, onOpenChange }: QuickConnectDialogProps) {
  const [uri, setUri] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [parsedInfo, setParsedInfo] = useState<{
    dbType: DbType;
    host?: string;
    database?: string;
  } | null>(null);
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
        setParsedInfo({
          dbType: mapDatabaseType(parsed.dbType),
          host: parsed.host,
          database: parsed.database,
        });
      } else if (format === "env") {
        const parsed = parseConnectionEnv(value);
        if (parsed.dbType) {
          setParsedInfo({
            dbType: mapDatabaseType(parsed.dbType),
            host: parsed.host,
            database: parsed.database,
          });
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
      let config;

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
            Paste a connection URI or environment variables to connect quickly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Textarea
            placeholder={`postgresql://user:password@localhost:5432/mydb\n\nor\n\nDATABASE_URL=postgres://...`}
            value={uri}
            onChange={(e) => { handleUriChange(e.target.value); }}
            className="min-h-[120px] font-mono text-xs"
          />

          {parsedInfo && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
              <img
                src={getDatabaseLogo(parsedInfo.dbType)}
                alt=""
                className="h-6 w-6"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{parsedInfo.dbType}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {parsedInfo.host}
                  {parsedInfo.database && ` · ${parsedInfo.database}`}
                </div>
              </div>
            </div>
          )}

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
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ActionBarActions() {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);
  const openWorkspaceCreationForm = useHomeScreenStore(
    (s) => s.openWorkspaceCreationForm
  );
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);

  const handleNewConnection = () => {
    openConnectionForm("create");
  };

  const handleNewWorkspace = () => {
    openWorkspaceCreationForm();
  };

  const handleQuickConnect = () => {
    setQuickConnectOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={handleNewConnection}
          className="flex items-center gap-3 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors text-left"
        >
          <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20">
            <IconPlus className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium">New Connection</span>
            <span className="text-[10px] text-muted-foreground">
              Add database
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={handleQuickConnect}
          className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left"
        >
          <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted">
            <IconLink className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium">Quick Connect</span>
            <span className="text-[10px] text-muted-foreground">Paste URI</span>
          </div>
        </button>

        <button
          type="button"
          onClick={handleNewWorkspace}
          className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left"
        >
          <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted">
            <IconLayout2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium">New Workspace</span>
            <span className="text-[10px] text-muted-foreground">
              Group connections
            </span>
          </div>
        </button>
      </div>

      <QuickConnectDialog
        open={quickConnectOpen}
        onOpenChange={setQuickConnectOpen}
      />
    </>
  );
}
