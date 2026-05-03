import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import { dataTransferHasType } from "./dragDataTransfer";

function isDuckDbFamily(dbType: string | undefined): boolean {
  if (!dbType) return false;
  const n = dbType.toLowerCase();
  return n.includes("duckdb") || n.includes("motherduck");
}

function escapeSqlLiteral(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "''");
}

type ReadFn =
  | "read_parquet"
  | "read_csv_auto"
  | "read_json_auto"
  | "read_xlsx";

function detectReadFn(fileName: string): ReadFn | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".parquet")) return "read_parquet";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "read_csv_auto";
  if (lower.endsWith(".xlsx")) return "read_xlsx";
  if (
    lower.endsWith(".json") ||
    lower.endsWith(".jsonl") ||
    lower.endsWith(".ndjson")
  ) {
    return "read_json_auto";
  }
  return null;
}

function buildSelectForPath(absolutePath: string, fn: ReadFn): string {
  const escaped = escapeSqlLiteral(absolutePath);
  return `SELECT * FROM ${fn}('${escaped}');`;
}

function getNativeFilePath(file: File): string | undefined {
  const withPath = file as File & { path?: string };
  return typeof withPath.path === "string" && withPath.path.length > 0
    ? withPath.path
    : undefined;
}

export interface UseDuckDbFileDropOptions {
  readOnly?: boolean;
}

export interface UseDuckDbFileDropResult {
  /** Attach to the element that wraps the SQL editor (full editor hit target). */
  dropZoneRef: RefObject<HTMLDivElement | null>;
  /** True while a file drag is over the drop zone (OS file drag). */
  isFileDragOver: boolean;
}

/**
 * Drag-and-drop for CSV / Parquet / JSON files onto the query editor (DuckDB / MotherDuck).
 * Uses the native path on dropped files (Tauri augments `File` with `path`).
 * Expects an object ref to {@link SqlEditorRef} (see {@link QueryPanel}).
 */
export function useDuckDbFileDrop(
  editorRef: RefObject<SqlEditorRef | null> | RefObject<SqlEditorRef | undefined>,
  dbType: string | undefined,
  options: UseDuckDbFileDropOptions = {},
): UseDuckDbFileDropResult {
  const { readOnly = false } = options;
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (readOnly || !isDuckDbFamily(dbType)) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let detachListeners: (() => void) | undefined;
    let attempts = 0;
    const maxAttempts = 15;

    const attachToDropZone = (mountEl: HTMLElement) => {
      const containsFiles = (e: DragEvent) => {
        const dt = e.dataTransfer;
        if (!dt) return false;
        return dataTransferHasType(dt, "Files");
      };

      const onDragEnter = (e: DragEvent) => {
        if (!containsFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        if (dragDepthRef.current === 1) {
          setIsFileDragOver(true);
        }
      };

      const onDragOver = (e: DragEvent) => {
        if (!containsFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      };

      const onDragLeave = (e: DragEvent) => {
        if (!containsFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setIsFileDragOver(false);
        }
      };

      const onDrop = (e: DragEvent) => {
        if (!containsFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = 0;
        setIsFileDragOver(false);

        const files = e.dataTransfer?.files;
        if (!files?.length) {
          toast.error("No file in drop", {
            description: "Try dropping a file from your file manager.",
          });
          return;
        }

        const statements: string[] = [];
        let unsupported = 0;
        let missingPath = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files.item(i);
          if (!file) continue;
          const fn = detectReadFn(file.name);
          if (!fn) {
            unsupported += 1;
            continue;
          }
          const path = getNativeFilePath(file);
          if (!path) {
            missingPath += 1;
            continue;
          }
          statements.push(buildSelectForPath(path, fn));
        }

        if (missingPath > 0) {
          toast.error("Could not read file path", {
            description:
              "Dropped files need a native path (use the desktop app and drop from Finder / Explorer).",
          });
        }

        if (unsupported > 0 && statements.length === 0 && missingPath === 0) {
          toast.error("Unsupported file type", {
            description:
              "Use .csv, .tsv, .parquet, .json, .jsonl, .ndjson, or .xlsx.",
          });
        } else if (unsupported > 0 && statements.length > 0) {
          toast.message("Some files skipped", {
            description: `${unsupported} file(s) had an unsupported extension.`,
          });
        }

        if (statements.length === 0) return;

        const sql = statements.join("\n");
        const ed = editorRef.current;
        ed?.replaceSelection(sql);
        ed?.focus();
      };

      mountEl.addEventListener("dragenter", onDragEnter);
      mountEl.addEventListener("dragover", onDragOver);
      mountEl.addEventListener("dragleave", onDragLeave);
      mountEl.addEventListener("drop", onDrop);

      return () => {
        mountEl.removeEventListener("dragenter", onDragEnter);
        mountEl.removeEventListener("dragover", onDragOver);
        mountEl.removeEventListener("dragleave", onDragLeave);
        mountEl.removeEventListener("drop", onDrop);
      };
    };

    const tryAttach = () => {
      if (cancelled) return;
      const mountEl = dropZoneRef.current;
      if (mountEl) {
        detachListeners = attachToDropZone(mountEl);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        return;
      }
      const delay = Math.min(50 * Math.pow(2, attempts - 1), 1000);
      retryTimer = setTimeout(tryAttach, delay);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      detachListeners?.();
      dragDepthRef.current = 0;
      setIsFileDragOver(false);
    };
  }, [dbType, readOnly, editorRef]);

  return { dropZoneRef, isFileDragOver };
}
