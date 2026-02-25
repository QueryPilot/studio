import { useState, useRef } from "react";
import {
  IconPlus,
  IconLink,
  IconFileImport,
} from "@tabler/icons-react";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  parseConnectionUri,
  parseConnectionEnv,
  detectConnectionFormat,
} from "@/utils/connectionParser";
import { DbType, type ConnectionProfile } from "@/types/connection";
import { getDatabaseLogo } from "@/utils/databaseLogos";
import { QuickConnectDialog } from "../QuickConnectDialog";

// Connection templates for quick setup
const CONNECTION_TEMPLATES: {
  name: string;
  description: string;
  profile: Partial<ConnectionProfile>;
}[] = [
  {
    name: "Local PostgreSQL",
    description: "localhost:5432",
    profile: {
      db_type: DbType.PostgreSQL,
      host: "localhost",
      port: 5432,
      username: "postgres",
      database: "postgres",
    },
  },
  {
    name: "Local MySQL",
    description: "localhost:3306",
    profile: {
      db_type: DbType.MySQL,
      host: "localhost",
      port: 3306,
      username: "root",
      database: "mysql",
    },
  },
  {
    name: "Local MongoDB",
    description: "localhost:27017",
    profile: {
      db_type: DbType.MongoDB,
      host: "localhost",
      port: 27017,
      database: "test",
    },
  },
  {
    name: "Local Redis",
    description: "localhost:6379",
    profile: {
      db_type: DbType.Redis,
      host: "localhost",
      port: 6379,
      database: "0",
    },
  },
  {
    name: "Docker PostgreSQL",
    description: "Docker default",
    profile: {
      db_type: DbType.PostgreSQL,
      host: "localhost",
      port: 5432,
      username: "postgres",
      password: "postgres",
      database: "postgres",
    },
  },
  {
    name: "Docker MySQL",
    description: "Docker default",
    profile: {
      db_type: DbType.MySQL,
      host: "localhost",
      port: 3306,
      username: "root",
      password: "root",
      database: "mysql",
    },
  },
];
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/utils/tauri";

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

interface QuickActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function QuickActionCard({
  icon,
  title,
  description,
  onClick,
}: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all duration-200 text-center group"
    >
      <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
    </button>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: (typeof CONNECTION_TEMPLATES)[0];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 hover:border-primary/20 transition-all text-left group"
    >
      <img
        src={getDatabaseLogo(template.profile.db_type ?? DbType.PostgreSQL)}
        alt=""
        className="h-6 w-6 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{template.name}</div>
        <div className="text-[10px] text-muted-foreground">{template.description}</div>
      </div>
      <IconPlus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export function WelcomeSection() {
  const openConnectionForm = useHomeScreenStore((s) => s.openConnectionForm);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveConnection = useConnectionStore((s) => s.saveConnection);

  const handleNewConnection = () => {
    openConnectionForm("create");
  };

  const handleQuickConnect = () => {
    setQuickConnectOpen(true);
  };

  const handleTemplateSelect = async (template: (typeof CONNECTION_TEMPLATES)[0]) => {
    try {
      const profile = {
        id: crypto.randomUUID(),
        name: template.name,
        db_type: template.profile.db_type ?? DbType.PostgreSQL,
        host: template.profile.host ?? "localhost",
        port: template.profile.port ?? 5432,
        username: template.profile.username ?? "",
        password: template.profile.password ?? "",
        database: template.profile.database ?? "",
        options: {},
      };

      await saveConnection(profile, ["local"]);
      toast.success("Connection created from template", {
        description: `${profile.name} has been added`,
      });
    } catch (error) {
      toast.error("Failed to create connection", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleImportFile = async () => {
    if (isTauri()) {
      try {
        const selected = await open({
          multiple: false,
          filters: [
            {
              name: "Connection Files",
              extensions: ["json", "env"],
            },
          ],
        });

        if (selected) {
          const content = await invoke<string>("read_text_file", { path: selected });
          await processImportedContent(content, selected);
        }
      } catch (error) {
        toast.error("Failed to import file", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const processImportedContent = async (content: string, filename: string) => {
    try {
      // Try JSON format first
      if (filename.endsWith(".json")) {
        const data = JSON.parse(content);

        // Handle array of connections or single connection
        const connections = Array.isArray(data) ? data : [data];
        let imported = 0;

        for (const conn of connections) {
          if (conn.profile || conn.host) {
            const profile = conn.profile || {
              id: crypto.randomUUID(),
              name: conn.name || conn.database || "Imported Connection",
              db_type: conn.db_type || DbType.PostgreSQL,
              host: conn.host || "localhost",
              port: conn.port || 5432,
              username: conn.username || "",
              password: conn.password || "",
              database: conn.database || "",
              options: {},
            };

            await saveConnection(
              { ...profile, id: crypto.randomUUID() },
              conn.tags || conn.metadata?.tags || []
            );
            imported++;
          }
        }

        if (imported > 0) {
          toast.success(`Imported ${imported} connection${imported > 1 ? "s" : ""}`);
        } else {
          toast.error("No valid connections found in file");
        }
        return;
      }

      // Try env format
      const format = detectConnectionFormat(content);
      if (format === "env") {
        const parsed = parseConnectionEnv(content);
        if (parsed.dbType) {
          const profile = {
            id: crypto.randomUUID(),
            name: parsed.database || parsed.host || "Imported Connection",
            db_type: mapDatabaseType(parsed.dbType),
            host: parsed.host || "localhost",
            port: parseInt(parsed.port || "5432", 10),
            username: parsed.username || "",
            password: parsed.password || "",
            database: parsed.database || "",
            options: {},
          };
          await saveConnection(profile, []);
          toast.success("Connection imported");
          return;
        }
      }

      // Try URI format
      if (format === "uri") {
        const parsed = parseConnectionUri(content);
        const profile = {
          id: crypto.randomUUID(),
          name: parsed.database || parsed.host || "Imported Connection",
          db_type: mapDatabaseType(parsed.dbType),
          host: parsed.host || "localhost",
          port: parseInt(parsed.port || "5432", 10),
          username: parsed.username || "",
          password: parsed.password || "",
          database: parsed.database || "",
          options: {},
        };
        await saveConnection(profile, []);
        toast.success("Connection imported");
        return;
      }

      toast.error("Could not parse file content");
    } catch (error) {
      toast.error("Failed to import", {
        description: error instanceof Error ? error.message : "Invalid format",
      });
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      await processImportedContent(content, file.name);
    } catch (error) {
      toast.error("Failed to read file", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Reset input
    e.target.value = "";
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      {/* Welcome Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-semibold mb-3">Welcome to Query Pilot</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Connect to your databases and start querying. Create a new connection
          or quickly connect using a URI.
        </p>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <QuickActionCard
          icon={<IconPlus className="h-6 w-6 text-primary" />}
          title="New Connection"
          description="Configure manually"
          onClick={handleNewConnection}
        />
        <QuickActionCard
          icon={<IconLink className="h-6 w-6 text-primary" />}
          title="Quick Connect"
          description="Paste a URI"
          onClick={handleQuickConnect}
        />
        <QuickActionCard
          icon={<IconFileImport className="h-6 w-6 text-primary" />}
          title="Import"
          description="From JSON or .env"
          onClick={handleImportFile}
        />
      </div>

      {/* Connection Templates */}
      <div className="mt-10 w-full max-w-2xl">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          Quick Start Templates
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CONNECTION_TEMPLATES.map((template) => (
            <TemplateCard
              key={template.name}
              template={template}
              onSelect={() => handleTemplateSelect(template)}
            />
          ))}
        </div>
      </div>

      {/* Hidden file input for web */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.env"
        onChange={handleFileInputChange}
        className="hidden"
      />

      <QuickConnectDialog
        open={quickConnectOpen}
        onOpenChange={setQuickConnectOpen}
      />
    </div>
  );
}
