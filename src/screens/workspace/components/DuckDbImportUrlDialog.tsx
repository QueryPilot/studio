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

interface DuckDbImportUrlDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string, targetName: string) => void;
  initialUrl?: string;
}

/**
 * Derive a table name from a URL by extracting the filename,
 * removing the extension, and sanitizing to a valid identifier.
 */
function deriveTableNameFromUrl(url: string): string {
  try {
    // Strip query string and fragment
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() ?? "";
    // Remove extension
    const base = filename.replace(/\.[^.]+$/, "");
    if (!base) return "";
    // Sanitize: replace non-alphanumeric with underscore, collapse, trim
    const sanitized = base
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase();
    // Prefix with underscore if starts with digit
    if (/^[0-9]/.test(sanitized)) {
      return `_${sanitized}`;
    }
    return sanitized;
  } catch {
    return "";
  }
}

/**
 * Inner form component that resets state via key-based remounting.
 */
function DuckDbImportUrlForm({
  onClose,
  onSubmit,
  initialUrl,
}: Omit<DuckDbImportUrlDialogProps, "open">) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [targetName, setTargetName] = useState(() =>
    initialUrl ? deriveTableNameFromUrl(initialUrl) : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEditedTarget, setUserEditedTarget] = useState(false);

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    // Auto-derive target name unless user has manually edited it
    if (!userEditedTarget) {
      const derived = deriveTableNameFromUrl(newUrl);
      if (derived) {
        setTargetName(derived);
      }
    }
  };

  const handleTargetNameChange = (value: string) => {
    setUserEditedTarget(true);
    setTargetName(value);
  };

  const trimmedUrl = url.trim();
  const isValidUrl =
    trimmedUrl.startsWith("http://") ||
    trimmedUrl.startsWith("https://") ||
    trimmedUrl.startsWith("s3://");

  const handleSubmit = () => {
    if (!isValidUrl || !targetName.trim()) return;
    setIsSubmitting(true);
    onSubmit(trimmedUrl, targetName.trim());
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import from URL</DialogTitle>
        <DialogDescription>
          Import a remote file into the DuckDB scratchpad as a managed table.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="duckdb-import-url">URL</Label>
          <Input
            id="duckdb-import-url"
            value={url}
            onChange={(e) => {
              handleUrlChange(e.target.value);
            }}
            placeholder="https://example.com/data.parquet"
            className="font-mono text-[11px]"
          />
          <p className="text-xs text-muted-foreground">
            Supports HTTP, HTTPS, and S3 URLs for Parquet, CSV, and JSON files.
          </p>
          {trimmedUrl && !isValidUrl && (
            <p className="text-xs text-destructive">
              URL must start with http://, https://, or s3://
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="duckdb-import-url-target">Target table</Label>
          <Input
            id="duckdb-import-url-target"
            value={targetName}
            onChange={(e) => {
              handleTargetNameChange(e.target.value);
            }}
            placeholder="imported_data"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !isValidUrl || !targetName.trim()}
        >
          {isSubmitting ? "Importing..." : "Import"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DuckDbImportUrlDialog({
  open,
  onClose,
  onSubmit,
  initialUrl,
}: DuckDbImportUrlDialogProps) {
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
        {/* Key-based remounting resets form state each time dialog opens */}
        {open && (
          <DuckDbImportUrlForm
            onClose={onClose}
            onSubmit={onSubmit}
            initialUrl={initialUrl}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
