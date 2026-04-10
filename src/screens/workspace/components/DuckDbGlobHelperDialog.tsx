import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import { writeClipboardText } from "@/lib/clipboard";
import { insertSqlIntoFocusedEditor } from "@/utils/insertSqlIntoFocusedEditor";
import { isTauri } from "@/utils/tauri";

const { open: openDialog } = await import("@tauri-apps/plugin-dialog");

type FileKind = "parquet" | "csv" | "json";

const READ_FN: Record<FileKind, string> = {
  parquet: "read_parquet",
  csv: "read_csv_auto",
  json: "read_json_auto",
};

const EXT: Record<FileKind, string> = {
  parquet: "parquet",
  csv: "csv",
  json: "json",
};

function escapeSqlLiteral(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "''");
}

function normalizeBaseDir(dir: string): string {
  return dir.replace(/[/\\]+$/, "").replace(/\\/g, "/");
}

function buildGlobPath(baseDir: string, kind: FileKind, recursive: boolean): string {
  const base = normalizeBaseDir(baseDir.trim());
  const ext = EXT[kind];
  const tail = recursive ? `**/*.${ext}` : `*.${ext}`;
  return base ? `${base}/${tail}` : tail;
}

function buildSql(readFn: string, pathOrGlob: string): string {
  const escaped = escapeSqlLiteral(pathOrGlob.trim());
  return `SELECT * FROM ${readFn}('${escaped}');`;
}

interface DuckDbGlobHelperFormProps {
  onClose: () => void;
}

function DuckDbGlobHelperForm({ onClose }: DuckDbGlobHelperFormProps) {
  const [baseDir, setBaseDir] = useState("");
  const [fileKind, setFileKind] = useState<FileKind>("parquet");
  const [recursive, setRecursive] = useState(true);
  const [customPattern, setCustomPattern] = useState("");

  const generatedPath = useMemo(() => {
    if (!baseDir.trim()) return "";
    return buildGlobPath(baseDir, fileKind, recursive);
  }, [baseDir, fileKind, recursive]);

  const previewSql = useMemo(() => {
    const readFn = READ_FN[fileKind];
    if (customPattern.trim()) {
      return buildSql(readFn, customPattern.trim());
    }
    if (!generatedPath) return "";
    return buildSql(readFn, generatedPath);
  }, [customPattern, fileKind, generatedPath]);

  const canInsert = previewSql.length > 0;

  const pickDirectory = async () => {
    if (!isTauri()) {
      toast.error("Directory picker requires the desktop app");
      return;
    }
    try {
      const selected = await openDialog({
        title: "Base directory",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string" && selected) {
        setBaseDir(selected);
      }
    } catch (e) {
      toast.error("Could not open directory picker", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleInsert = () => {
    if (!canInsert) return;
    const ok = insertSqlIntoFocusedEditor(previewSql);
    if (ok) {
      toast.success("Inserted into query editor");
      onClose();
    } else {
      toast.error("No focused query editor", {
        description: "Click inside a SQL query tab, then try again.",
      });
    }
  };

  const handleCopy = async () => {
    if (!canInsert) return;
    try {
      await writeClipboardText(previewSql);
      toast.success("Copied to clipboard");
    } catch (e) {
      toast.error("Copy failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>File pattern helper</DialogTitle>
        <DialogDescription>
          Build a glob path for DuckDB table functions like{" "}
          <code className="text-xs">read_parquet</code>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="duckdb-glob-base">Base directory</Label>
          <div className="flex gap-2">
            <Input
              id="duckdb-glob-base"
              value={baseDir}
              onChange={(e) => {
                setBaseDir(e.target.value);
              }}
              placeholder="/path/to/data"
              className="font-mono text-[11px]"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                void pickDirectory();
              }}
              title="Choose folder"
            >
              <IconFolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>File type</Label>
          <Select
            value={fileKind}
            onValueChange={(v) => {
              setFileKind(v as FileKind);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="parquet">Parquet</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={recursive}
            onCheckedChange={(c) => {
              setRecursive(typeof c === "boolean" ? c : false);
            }}
          />
          <span>Recursive ({recursive ? `"**/*.ext"` : `"*.ext"`})</span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="duckdb-glob-custom">Custom pattern (optional)</Label>
          <Input
            id="duckdb-glob-custom"
            value={customPattern}
            onChange={(e) => {
              setCustomPattern(e.target.value);
            }}
            placeholder="Overrides generated path, e.g. data/part-*.parquet"
            className="font-mono text-[11px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="duckdb-glob-preview">Preview</Label>
          <pre
            id="duckdb-glob-preview"
            className="max-h-28 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground"
          >
            {canInsert ? previewSql : "Set a base directory or custom pattern."}
          </pre>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void handleCopy();
          }}
          disabled={!canInsert}
        >
          Copy
        </Button>
        <Button type="button" onClick={handleInsert} disabled={!canInsert}>
          Insert
        </Button>
      </DialogFooter>
    </>
  );
}

interface DuckDbGlobHelperDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DuckDbGlobHelperDialog({
  open,
  onClose,
}: DuckDbGlobHelperDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(openValue) => {
        if (!openValue) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {open ? <DuckDbGlobHelperForm onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
