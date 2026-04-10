import { useState } from "react";
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
import { IconFolderOpen } from "@tabler/icons-react";

const { open: openFileDialog } = await import("@tauri-apps/plugin-dialog");

interface DuckDbAttachDatabaseDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    path: string,
    alias: string,
    dbType: string | undefined,
    readOnly: boolean,
  ) => void;
}

const ALIAS_PATTERN = /^[a-zA-Z0-9_]+$/;

function DuckDbAttachDatabaseForm({
  onClose,
  onSubmit,
}: Omit<DuckDbAttachDatabaseDialogProps, "open">) {
  const [path, setPath] = useState("");
  const [alias, setAlias] = useState("");
  const [dbType, setDbType] = useState("auto");
  const [readOnly, setReadOnly] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const aliasError =
    alias.length > 0 && !ALIAS_PATTERN.test(alias)
      ? "Only letters, numbers, and underscores allowed"
      : null;

  const canSubmit =
    path.trim().length > 0 &&
    alias.trim().length > 0 &&
    !aliasError &&
    !isSubmitting;

  const handleBrowse = async () => {
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
      if (!alias) {
        const filename = selected.split(/[/\\]/).pop() ?? "";
        const base = filename
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "")
          .toLowerCase();
        if (base && ALIAS_PATTERN.test(base)) {
          setAlias(base);
        }
      }
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    onSubmit(
      path.trim(),
      alias.trim(),
      dbType === "auto" ? undefined : dbType,
      readOnly,
    );
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
        <div className="space-y-1.5">
          <Label htmlFor="attach-db-path">Connection String / Path</Label>
          <div className="flex gap-2">
            <Input
              id="attach-db-path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
              }}
              placeholder="postgres://user:pass@host/db  or  /path/to/file.duckdb"
              className="font-mono text-[11px] flex-1"
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
            onCheckedChange={setReadOnly}
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
        <Button onClick={handleSubmit} disabled={!canSubmit}>
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
          <DuckDbAttachDatabaseForm onClose={onClose} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}
