import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { dataTransferHasAnyType } from "./dragDataTransfer";

export interface DroppedFile {
  name: string;
  path?: string;
}

export interface UseDuckDbSidebarDropOptions {
  enabled: boolean;
  onFilesDropped: (files: DroppedFile[]) => void;
  onUrlDropped: (url: string) => void;
}

export interface UseDuckDbSidebarDropResult {
  dropZoneRef: (el: HTMLDivElement | null) => void;
  isDragOver: boolean;
}

function getNativeFilePath(file: File): string | undefined {
  const withPath = file as File & { path?: string };
  return typeof withPath.path === "string" && withPath.path.length > 0
    ? withPath.path
    : undefined;
}

function getFileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function isPositionInsideElement(
  position: { x: number; y: number },
  element: HTMLElement,
): boolean {
  const pixelRatio = window.devicePixelRatio || 1;
  const x = position.x / pixelRatio;
  const y = position.y / pixelRatio;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function looksLikeImportUrl(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("s3://") ||
    trimmed.startsWith("gs://") ||
    trimmed.startsWith("az://") ||
    trimmed.startsWith("azure://") ||
    trimmed.startsWith("r2://") ||
    trimmed.startsWith("hf://")
  );
}

function extractDroppedUrl(dt: DataTransfer): string | null {
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const firstLine = uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (firstLine && looksLikeImportUrl(firstLine)) return firstLine;
  }
  const plain = dt.getData("text/plain").trim();
  if (plain && looksLikeImportUrl(plain)) return plain;
  return null;
}

/**
 * Attach drag-and-drop listeners to the DuckDB sidebar region.
 * Handles OS file drops (with native paths) and URL drops (from browser links / copied URLs).
 * Uses a callback ref so listeners attach when the drop target mounts, even if it mounts
 * after the hook's first render (e.g. after loading skeletons resolve).
 */
export function useDuckDbSidebarDrop({
  enabled,
  onFilesDropped,
  onUrlDropped,
}: UseDuckDbSidebarDropOptions): UseDuckDbSidebarDropResult {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropZoneEl, setDropZoneEl] = useState<HTMLDivElement | null>(null);
  const depthRef = useRef(0);
  const attachedElRef = useRef<HTMLDivElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const enabledRef = useRef(enabled);

  const callbacksRef = useRef({ onFilesDropped, onUrlDropped });
  useEffect(() => {
    callbacksRef.current = { onFilesDropped, onUrlDropped };
  }, [onFilesDropped, onUrlDropped]);

  const attach = useCallback((el: HTMLDivElement) => {
    const hasDropPayload = (e: DragEvent): boolean => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      return dataTransferHasAnyType(dt, [
        "Files",
        "text/uri-list",
        "text/plain",
      ]);
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasDropPayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current += 1;
      if (depthRef.current === 1) setIsDragOver(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasDropPayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasDropPayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsDragOver(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasDropPayload(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current = 0;
      setIsDragOver(false);

      const dt = e.dataTransfer;
      if (!dt) return;

      if (dt.files.length > 0) {
        const files: DroppedFile[] = [];
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files.item(i);
          if (!f) continue;
          const path = getNativeFilePath(f);
          files.push(path ? { path, name: f.name } : { name: f.name });
        }
        if (files.length > 0) {
          callbacksRef.current.onFilesDropped(files);
          return;
        }
      }

      const url = extractDroppedUrl(dt);
      if (url) {
        callbacksRef.current.onUrlDropped(url);
      }
    };

    el.addEventListener("dragenter", onDragEnter, { capture: true });
    el.addEventListener("dragover", onDragOver, { capture: true });
    el.addEventListener("dragleave", onDragLeave, { capture: true });
    el.addEventListener("drop", onDrop, { capture: true });

    return () => {
      el.removeEventListener("dragenter", onDragEnter, { capture: true });
      el.removeEventListener("dragover", onDragOver, { capture: true });
      el.removeEventListener("dragleave", onDragLeave, { capture: true });
      el.removeEventListener("drop", onDrop, { capture: true });
      depthRef.current = 0;
      setIsDragOver(false);
    };
  }, []);

  const dropZoneRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el === attachedElRef.current) return;
      if (detachRef.current) {
        detachRef.current();
        detachRef.current = null;
      }
      attachedElRef.current = el;
      setDropZoneEl(el);
      if (el && enabledRef.current) {
        detachRef.current = attach(el);
      }
    },
    [attach],
  );

  useEffect(() => {
    enabledRef.current = enabled;
    const el = attachedElRef.current;
    if (enabled && el && !detachRef.current) {
      detachRef.current = attach(el);
    } else if (!enabled && detachRef.current) {
      detachRef.current();
      detachRef.current = null;
    }
  }, [enabled, attach]);

  useEffect(() => {
    if (!enabled || !dropZoneEl) return;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    const setNativeDragOver = (over: boolean) => {
      depthRef.current = over ? 1 : 0;
      setIsDragOver(over);
    };

    let webview: ReturnType<typeof getCurrentWebview>;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }

    void webview
      .onDragDropEvent((event: TauriEvent<DragDropEvent>) => {
        if (cancelled) return;

        const payload = event.payload;
        if (payload.type === "leave") {
          setNativeDragOver(false);
          return;
        }

        if (payload.type === "enter") {
          setNativeDragOver(isPositionInsideElement(payload.position, dropZoneEl));
          return;
        }

        if (payload.type === "over") {
          setNativeDragOver(isPositionInsideElement(payload.position, dropZoneEl));
          return;
        }

        const isInside = isPositionInsideElement(payload.position, dropZoneEl);
        setNativeDragOver(false);
        if (!isInside || payload.paths.length === 0) return;

        callbacksRef.current.onFilesDropped(
          payload.paths.map((path) => ({
            name: getFileNameFromPath(path),
            path,
          })),
        );
      })
      .then((off) => {
        if (cancelled) {
          off();
        } else {
          unlisten = off;
        }
      })
      .catch(() => {
        // Tauri's native drag-drop API is only available in the desktop runtime.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, dropZoneEl]);

  useEffect(() => {
    return () => {
      if (detachRef.current) {
        detachRef.current();
        detachRef.current = null;
      }
    };
  }, []);

  return { dropZoneRef, isDragOver };
}
