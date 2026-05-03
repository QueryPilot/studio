import { useEffect, useMemo, useState } from "react";
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

export type DuckDbImportFileFormat =
  | "csv"
  | "tsv"
  | "parquet"
  | "json"
  | "jsonl"
  | "ndjson"
  | "xlsx";

export interface DuckDbAddFileDialogItem {
  filePath: string;
  targetName: string;
  format: DuckDbImportFileFormat;
  availableSheets?: string[];
  selectedSheet?: string;
}

interface DuckDbAddFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: DuckDbAddFileDialogItem[];
  isSubmitting?: boolean;
  loadSheets?: (filePath: string) => Promise<string[]>;
  onConfirm: (files: DuckDbAddFileDialogItem[]) => Promise<void> | void;
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

export function DuckDbAddFileDialog({
  open,
  onOpenChange,
  files,
  isSubmitting = false,
  loadSheets,
  onConfirm,
}: DuckDbAddFileDialogProps) {
  const [draftFiles, setDraftFiles] = useState<DuckDbAddFileDialogItem[]>(files);
  const [loadingSheets, setLoadingSheets] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      files
        .filter((file) => file.format === "xlsx" && !file.availableSheets)
        .map((file) => [file.filePath, true]),
    ),
  );
  const [sheetErrors, setSheetErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !loadSheets) return;

    let cancelled = false;
    const pendingFiles = files.filter(
      (file) => file.format === "xlsx" && !file.availableSheets,
    );

    for (const file of pendingFiles) {
      const key = file.filePath;
      void loadSheets(file.filePath)
        .then((availableSheets) => {
          if (cancelled) return;

          if (availableSheets.length === 0) {
            setSheetErrors((current) => ({
              ...current,
              [key]: "Excel workbook has no sheets.",
            }));
            return;
          }

          setDraftFiles((current) =>
            current.map((item) =>
              item.filePath === file.filePath
                ? {
                    ...item,
                    availableSheets,
                    selectedSheet: item.selectedSheet ?? availableSheets[0],
                  }
                : item,
            ),
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setSheetErrors((current) => ({
            ...current,
            [key]: error instanceof Error ? error.message : String(error),
          }));
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingSheets((current) => ({ ...current, [key]: false }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [files, loadSheets, open]);

  const hasFiles = draftFiles.length > 0;
  const title = useMemo(
    () =>
      draftFiles.length > 1
        ? "Add Files to Scratchpad"
        : "Add File to Scratchpad",
    [draftFiles.length],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Import the selected file{draftFiles.length > 1 ? "s" : ""} into the
            DuckDB scratchpad as managed table
            {draftFiles.length > 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {draftFiles.map((file, index) => {
            const fileId = `duckdb-import-file-${index}`;
            const targetId = `duckdb-target-name-${index}`;
            const sheetId = `duckdb-sheet-${index}`;
            const showSheetPicker =
              file.format === "xlsx" &&
              file.availableSheets &&
              file.availableSheets.length > 0;
            const isLoadingSheets = Boolean(loadingSheets[file.filePath]);
            const sheetError = sheetErrors[file.filePath];

            return (
              <div
                key={`${file.filePath}:${index}`}
                className="space-y-3 rounded-md border p-3"
              >
                {draftFiles.length > 1 && (
                  <div className="text-xs font-medium">{getFileName(file.filePath)}</div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={fileId}>
                    {draftFiles.length > 1 ? "File path" : "Selected file"}
                  </Label>
                  <Input
                    id={fileId}
                    value={file.filePath}
                    readOnly
                    className="font-mono text-[11px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={targetId}>Target table</Label>
                  <Input
                    id={targetId}
                    value={file.targetName}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraftFiles((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, targetName: next }
                            : item,
                        ),
                      );
                    }}
                    placeholder="imported_data"
                  />
                </div>

                {showSheetPicker && (
                  <div className="space-y-1.5">
                    <Label htmlFor={sheetId}>Sheet</Label>
                    <select
                      id={sheetId}
                      aria-label="Sheet"
                      className="bg-input/20 dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/30 rounded-md border h-7 w-full px-2 text-xs outline-none focus-visible:ring-[2px]"
                      value={file.selectedSheet ?? file.availableSheets?.[0] ?? ""}
                      onChange={(event) => {
                        const next = event.target.value;
                        setDraftFiles((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, selectedSheet: next }
                              : item,
                          ),
                        );
                      }}
                    >
                      {file.availableSheets?.map((sheet) => (
                        <option key={sheet} value={sheet}>
                          {sheet}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {file.format === "xlsx" && isLoadingSheets && !showSheetPicker && (
                  <div className="text-xs text-muted-foreground">
                    Loading sheets...
                  </div>
                )}

                {file.format === "xlsx" && sheetError && (
                  <div className="text-xs text-destructive">{sheetError}</div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void onConfirm(draftFiles)}
            disabled={
              isSubmitting ||
              !hasFiles ||
              Object.values(loadingSheets).some(Boolean) ||
              draftFiles.some(
                (file) =>
                  !file.filePath ||
                  !file.targetName.trim() ||
                  Boolean(sheetErrors[file.filePath]) ||
                  (file.format === "xlsx" && !file.availableSheets) ||
                  (file.format === "xlsx" &&
                    file.availableSheets &&
                    file.availableSheets.length > 0 &&
                    !file.selectedSheet),
              )
            }
          >
            {isSubmitting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
