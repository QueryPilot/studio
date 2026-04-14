import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconFolderOpen,
  IconPlugConnected,
  IconSearch,
  IconCircleCheck,
} from "@tabler/icons-react";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";
import type { ConnectionProfile } from "@/types/connection";
import { buildConnectionUri } from "@/utils/connectionParser";
import { getDatabaseLogo } from "@/utils/databaseLogos";

const ATTACH_COMPATIBLE_TYPES: DbType[] = [
  DbType.PostgreSQL,
  DbType.MySQL,
  DbType.MariaDB,
  DbType.SQLite,
  DbType.DuckDB,
];

const DB_TYPE_TO_ATTACH_TYPE: Partial<Record<DbType, string>> = {
  [DbType.PostgreSQL]: "POSTGRES",
  [DbType.MySQL]: "MYSQL",
  [DbType.MariaDB]: "MYSQL",
  [DbType.SQLite]: "SQLITE",
  [DbType.DuckDB]: "DUCKDB",
};

interface DuckDbAttachDatabaseDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    path: string,
    alias: string,
    dbType: string | undefined,
    readOnly: boolean,
  ) => void | Promise<void>;
  currentConnectionId?: string;
}

const ALIAS_PATTERN = /^[a-zA-Z0-9_]+$/;

function sanitizeAlias(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function maskConnectionUri(uri: string): string {
  return uri.replace(
    /(:\/\/[^:]+:)([^@]+)(@)/,
    (_match, before, _password, after) => `${before}${"*".repeat(8)}${after}`,
  );
}

function DuckDbAttachDatabaseForm({
  onClose,
  onSubmit,
  currentConnectionId,
}: Omit<DuckDbAttachDatabaseDialogProps, "open">) {
  const [path, setPath] = useState("");
  const [displayPath, setDisplayPath] = useState("");
  const [pickedFromSaved, setPickedFromSaved] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [dbType, setDbType] = useState("auto");
  const [readOnly, setReadOnly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectionSearch, setConnectionSearch] = useState("");

  const allConnections = useConnectionStore((s) => s.connections);
  const savedConnections = useMemo(
    () =>
      allConnections.filter(
        (c) =>
          ATTACH_COMPATIBLE_TYPES.includes(c.profile.db_type) &&
          c.profile.id !== currentConnectionId,
      ),
    [allConnections, currentConnectionId],
  );

  const filteredConnections = useMemo(() => {
    if (!connectionSearch.trim()) return savedConnections;
    const q = connectionSearch.toLowerCase();
    return savedConnections.filter(
      (c) =>
        c.profile.name.toLowerCase().includes(q) ||
        c.profile.db_type.toLowerCase().includes(q) ||
        c.profile.host?.toLowerCase().includes(q) ||
        c.profile.database?.toLowerCase().includes(q),
    );
  }, [savedConnections, connectionSearch]);

  const aliasError =
    alias.length > 0 && !ALIAS_PATTERN.test(alias)
      ? "Only letters, numbers, and underscores allowed"
      : null;

  const canSubmit =
    path.trim().length > 0 &&
    alias.trim().length > 0 &&
    !aliasError &&
    !isSubmitting;

  const handlePickSavedConnection = (profile: ConnectionProfile) => {
    const realUri = buildConnectionUri(profile, true);
    const maskedUri = maskConnectionUri(realUri);
    setPath(realUri);
    setDisplayPath(maskedUri);
    setPickedFromSaved(true);
    setSelectedProfileId(profile.id);

    const attachType = DB_TYPE_TO_ATTACH_TYPE[profile.db_type];
    if (attachType) {
      setDbType(attachType);
    }

    if (!alias) {
      const candidate = sanitizeAlias(profile.name);
      if (candidate && ALIAS_PATTERN.test(candidate)) {
        setAlias(candidate);
      }
    }
  };

  const handlePathChange = (value: string) => {
    setPath(value);
    setDisplayPath(value);
    setPickedFromSaved(false);
    setSelectedProfileId(null);
  };

  const handleBrowse = async () => {
    const { open: openFileDialog } = await import("@tauri-apps/plugin-dialog");
    const selected = await openFileDialog({
      title: "Select database file",
      multiple: false,
      filters: [
        {
          name: "Database files",
          extensions: ["duckdb", "db", "sqlite", "sqlite3"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (selected) {
      setPath(selected);
      setDisplayPath(selected);
      setPickedFromSaved(false);
      setSelectedProfileId(null);
      if (!alias) {
        const filename = selected.split(/[/\\]/).pop() ?? "";
        const base = sanitizeAlias(filename.replace(/\.[^.]+$/, ""));
        if (base && ALIAS_PATTERN.test(base)) {
          setAlias(base);
        }
      }
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onSubmit(
        path.trim(),
        alias.trim(),
        dbType === "auto" ? undefined : dbType,
        readOnly,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attach Database</DialogTitle>
        <DialogDescription>
          Attach an external database to query across multiple data sources in a
          single SQL statement.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {savedConnections.length > 0 && (
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <IconPlugConnected className="h-3.5 w-3.5" />
              Pick from saved connections
            </Label>
            {savedConnections.length > 4 && (
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={connectionSearch}
                  onChange={(e) => setConnectionSearch(e.target.value)}
                  placeholder="Search connections..."
                  className="pl-8 h-7 text-xs"
                />
              </div>
            )}
            <div className="grid gap-0.5 max-h-[140px] overflow-y-auto rounded-md border p-1">
              {filteredConnections.map((conn) => {
                const isSelected = selectedProfileId === conn.profile.id;
                return (
                  <button
                    key={conn.profile.id}
                    type="button"
                    onClick={() => { handlePickSavedConnection(conn.profile); }}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-accent"
                    }`}
                  >
                    <img
                      src={getDatabaseLogo(conn.profile.db_type)}
                      alt=""
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="truncate font-medium">{conn.profile.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {conn.profile.db_type}
                    </span>
                    {isSelected && (
                      <IconCircleCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>
                );
              })}
              {filteredConnections.length === 0 && connectionSearch.trim() && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No connections match &ldquo;{connectionSearch}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="attach-db-path">Connection String / Path</Label>
          <div className="flex gap-2">
            <Input
              id="attach-db-path"
              value={displayPath}
              onChange={(e) => { handlePathChange(e.target.value); }}
              placeholder="postgres://user:pass@host/db  or  /path/to/file.duckdb"
              className="font-mono text-[11px] flex-1"
              readOnly={pickedFromSaved}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void handleBrowse()}
              title="Browse for file"
            >
              <IconFolderOpen className="h-4 w-4" />
            </Button>
          </div>
          {pickedFromSaved && (
            <p className="text-[11px] text-muted-foreground">
              Using saved connection credentials (password masked).{" "}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setDisplayPath(path);
                  setPickedFromSaved(false);
                  setSelectedProfileId(null);
                }}
              >
                Edit manually
              </button>
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="attach-db-alias">Alias</Label>
          <Input
            id="attach-db-alias"
            value={alias}
            onChange={(e) => {
              setAlias(e.target.value);
            }}
            placeholder="my_database"
          />
          {aliasError && (
            <p className="text-xs text-destructive">{aliasError}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="attach-db-type">Database Type</Label>
          <Select value={dbType} onValueChange={(value) => { setDbType(value ?? "auto"); }}>
            <SelectTrigger id="attach-db-type">
              <SelectValue placeholder="Auto-detect" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              <SelectItem value="POSTGRES">PostgreSQL</SelectItem>
              <SelectItem value="MYSQL">MySQL</SelectItem>
              <SelectItem value="SQLITE">SQLite</SelectItem>
              <SelectItem value="DUCKDB">DuckDB</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="attach-db-readonly"
            checked={readOnly}
            onCheckedChange={(checked) => { setReadOnly(checked === true); }}
          />
          <Label htmlFor="attach-db-readonly" className="text-sm font-normal">
            Read-only
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={() => { void handleSubmit(); }} disabled={!canSubmit}>
          {isSubmitting ? "Attaching..." : "Attach"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DuckDbAttachDatabaseDialog({
  open,
  onClose,
  onSubmit,
  currentConnectionId,
}: DuckDbAttachDatabaseDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(openValue) => {
        if (!openValue) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {open && (
          <DuckDbAttachDatabaseForm
            onClose={onClose}
            onSubmit={onSubmit}
            currentConnectionId={currentConnectionId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
