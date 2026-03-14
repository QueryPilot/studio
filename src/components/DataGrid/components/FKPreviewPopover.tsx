import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFKPreviewData } from "@/hooks/useFKPreviewData";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import {
  IconX,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconPlus,
} from "@tabler/icons-react";
import type { RawCellValue } from "@/services/backend";
import type { EmbeddedFKConfig } from "@/adapters/types";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useEmbeddedFKPreferencesStore } from "../stores";
import { useShallow } from "zustand/shallow";
import { writeClipboardText } from "@/lib/clipboard";

interface FKPreviewPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fkReference: {
    referenced_schema: string;
    referenced_table: string;
    referenced_column: string;
  };
  fkValue: unknown;
  connectionId: string;
  database: string;
  cellBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  onOpenReference?: () => void;
  sourceColumnName?: string;
  sourceTable?: string;
  sourceSchema?: string;
}

/** Regex matching backend type placeholders like <tsvector>, <tsquery>, etc. */
const TYPE_PLACEHOLDER_RE = /^<[a-z_]+>$/;

function formatCellValue(value: RawCellValue): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string") {
    if (value.length > 100) return `${value.slice(0, 100)}...`;
    return value;
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isTypePlaceholder(value: string): boolean {
  return TYPE_PLACEHOLDER_RE.test(value);
}

const POPOVER_WIDTH = 400;
const POPOVER_PADDING = 16; // Padding from viewport edges

export function FKPreviewPopover({
  open,
  onOpenChange,
  fkReference,
  fkValue,
  connectionId,
  database,
  cellBounds,
  onOpenReference,
  sourceColumnName,
  sourceTable,
  sourceSchema,
}: FKPreviewPopoverProps) {
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const storageKey = useMemo(
    () =>
      sourceTable && sourceSchema && connectionId
        ? `${connectionId}:${sourceSchema}.${sourceTable}`
        : "",
    [connectionId, sourceSchema, sourceTable],
  );

  const setEmbeddedColumns = useEmbeddedFKPreferencesStore(
    (state) => state.setEmbeddedColumns,
  );
  const clearEmbeddedColumn = useEmbeddedFKPreferencesStore(
    (state) => state.clearEmbeddedColumn,
  );

  // Use useShallow to prevent infinite re-renders from array reference changes
  const embeddedColumns = useEmbeddedFKPreferencesStore(
    useShallow((state) => {
      if (!storageKey || !sourceColumnName) return [];
      return (
        state.preferences[storageKey]?.embeddedColumns[sourceColumnName] ?? []
      );
    }),
  );

  // Fetch referenced table structure for proper db_type and FK info
  const { structure: refTableStructure } = useTableFullStructure({
    connectionId,
    database,
    schema: fkReference.referenced_schema,
    table: fkReference.referenced_table,
    options: {
      includeConstraints: true,
      includeForeignKeys: true,
    },
    enabled: open,
  });

  // Build embedded FK config for the referenced table's own FK columns
  const refTableStorageKey = useMemo(
    () =>
      connectionId
        ? `${connectionId}:${fkReference.referenced_schema}.${fkReference.referenced_table}`
        : "",
    [connectionId, fkReference.referenced_schema, fkReference.referenced_table],
  );

  const refTableEmbeddedPrefs = useEmbeddedFKPreferencesStore(
    (state) => state.preferences[refTableStorageKey],
  );

  const refTableForeignKeys = refTableStructure?.foreignKeys;
  const refTableEmbeddedFKs = useMemo<EmbeddedFKConfig[]>(() => {
    if (!refTableEmbeddedPrefs?.embeddedColumns || !refTableForeignKeys)
      return [];

    const configs: EmbeddedFKConfig[] = [];
    const seen = new Set<string>();
    for (const fk of refTableForeignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const colName = fk.columns[i];
        const refCol = fk.foreignColumns[i];
        if (!colName || !refCol) continue;
        if (seen.has(colName)) continue;

        const refDisplayColumns =
          refTableEmbeddedPrefs.embeddedColumns[colName];
        if (refDisplayColumns && refDisplayColumns.length > 0) {
          seen.add(colName);
          configs.push({
            fkColumn: colName,
            refSchema: fk.foreignSchema ?? "public",
            refTable: fk.foreignTable,
            refPkColumn: refCol,
            refDisplayColumns,
          });
        }
      }
    }
    return configs;
  }, [refTableEmbeddedPrefs, refTableForeignKeys]);

  const handleToggleEmbed = (columnName: string) => {
    if (!storageKey || !sourceColumnName) return;
    const isCurrentlyEmbedded = embeddedColumns.includes(columnName);
    if (isCurrentlyEmbedded) {
      // Remove this column from embedded
      const updated = embeddedColumns.filter((c) => c !== columnName);
      if (updated.length === 0) {
        clearEmbeddedColumn(storageKey, sourceColumnName);
      } else {
        setEmbeddedColumns(storageKey, sourceColumnName, updated);
      }
      toast.success(`Removed "${columnName}" embedding`, {
        description: "Reload to see the change",
      });
    } else {
      // Add this column to embedded list (supports multiple)
      const updated = [...embeddedColumns, columnName];
      setEmbeddedColumns(storageKey, sourceColumnName, updated);
      toast.success(`Embedding "${columnName}" for ${sourceColumnName}`, {
        description: "Reload to see the embedded value",
      });
    }
  };

  const { data, columns, isLoading, error } = useFKPreviewData({
    connectionId,
    database,
    schema: fkReference.referenced_schema,
    table: fkReference.referenced_table,
    pkColumn: fkReference.referenced_column,
    pkValue: fkValue,
    enabled: open,
    embeddedFKs:
      refTableEmbeddedFKs.length > 0 ? refTableEmbeddedFKs : undefined,
  });

  // Build a map of embedded FK values: fkColumn → embeddedDisplayValues[]
  const embeddedFKValueMap = useMemo(() => {
    if (!data || refTableEmbeddedFKs.length === 0)
      return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const fk of refTableEmbeddedFKs) {
      const values: string[] = [];
      for (const displayCol of fk.refDisplayColumns) {
        const key = `__qp_fk__${fk.fkColumn}__${displayCol}`;
        const value = data[key];
        if (value != null) {
          values.push(formatCellValue(value as RawCellValue));
        }
      }
      if (values.length > 0) {
        map.set(fk.fkColumn, values);
      }
    }
    return map;
  }, [data, refTableEmbeddedFKs]);

  // Use table structure columns for display (proper db_type), falling back to query columns
  const refTableColumns = refTableStructure?.columns;
  const displayColumns = useMemo(() => {
    if (refTableColumns) {
      return refTableColumns.map((col) => ({
        name: col.name,
        db_type: col.db_type,
      }));
    }
    // Fallback: use query result columns, filtering out __qp_fk__ columns
    return columns
      .filter((col) => !col.name.startsWith("__qp_fk__"))
      .map((col) => ({
        name: col.name,
        db_type: col.db_type || "",
      }));
  }, [refTableColumns, columns]);

  const handleCopy = (columnName: string, value: string) => {
    writeClipboardText(value)
      .then(() => {
        setCopiedColumn(columnName);
        setTimeout(() => {
          setCopiedColumn(null);
        }, 2000);
      })
      .catch(() => {
        toast.error("Failed to copy");
      });
  };

  // Calculate optimal position relative to cell bounds
  // Tries: bottom, top, right, left - in that order
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const calculatePosition = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 300;
      const gap = 4; // Gap between cell and popover

      // Cell bounds (viewport coordinates)
      const cellLeft = cellBounds.x;
      const cellTop = cellBounds.y;
      const cellRight = cellBounds.x + cellBounds.width;
      const cellBottom = cellBounds.y + cellBounds.height;

      // Try bottom first
      const bottomSpace = viewportHeight - cellBottom - POPOVER_PADDING;
      if (bottomSpace >= popoverHeight) {
        const left = Math.min(
          Math.max(cellLeft, POPOVER_PADDING),
          viewportWidth - POPOVER_WIDTH - POPOVER_PADDING,
        );
        return { top: cellBottom + gap, left };
      }

      // Try top
      const topSpace = cellTop - POPOVER_PADDING;
      if (topSpace >= popoverHeight) {
        const left = Math.min(
          Math.max(cellLeft, POPOVER_PADDING),
          viewportWidth - POPOVER_WIDTH - POPOVER_PADDING,
        );
        return { top: cellTop - popoverHeight - gap, left };
      }

      // Try right
      const rightSpace = viewportWidth - cellRight - POPOVER_PADDING;
      if (rightSpace >= POPOVER_WIDTH) {
        const top = Math.min(
          Math.max(cellTop, POPOVER_PADDING),
          viewportHeight - popoverHeight - POPOVER_PADDING,
        );
        return { top, left: cellRight + gap };
      }

      // Try left
      const leftSpace = cellLeft - POPOVER_PADDING;
      if (leftSpace >= POPOVER_WIDTH) {
        const top = Math.min(
          Math.max(cellTop, POPOVER_PADDING),
          viewportHeight - popoverHeight - POPOVER_PADDING,
        );
        return { top, left: cellLeft - POPOVER_WIDTH - gap };
      }

      // Fallback: position below cell, constrained to viewport
      return {
        top: Math.min(
          cellBottom + gap,
          viewportHeight - popoverHeight - POPOVER_PADDING,
        ),
        left: Math.min(
          Math.max(cellLeft, POPOVER_PADDING),
          viewportWidth - POPOVER_WIDTH - POPOVER_PADDING,
        ),
      };
    };

    // Initial position
    setPosition(calculatePosition());

    // Recalculate on resize
    const handleResize = () => {
      setPosition(calculatePosition());
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [open, cellBounds]);

  // Close on click outside
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleClickOutside, handleKeyDown]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 w-[400px] rounded-lg bg-popover text-popover-foreground shadow-lg border border-border animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <div className="border-b px-3 py-1.5 bg-muted/50 flex items-center justify-between gap-2 rounded-t-lg">
        <div className="font-medium text-xs text-muted-foreground">
          {fkReference.referenced_schema}.{fkReference.referenced_table}
        </div>
        <div className="flex items-center gap-1">
          {onOpenReference && (
            <Button
              variant="ghost"
              onClick={() => {
                onOpenReference();
                onOpenChange(false);
              }}
              title="Open referenced table"
            >
              <IconExternalLink />
              Open
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              onOpenChange(false);
            }}
            title="Close"
          >
            <IconX />
          </Button>
        </div>
      </div>

      <div className="max-h-[300px] overflow-y-auto p-2 rounded-b-lg">
        {isLoading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-xs text-destructive select-text">
            {error}
          </div>
        )}

        {!isLoading && !error && !data && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Record not found
          </div>
        )}

        {!isLoading && !error && data && (
          <div className="space-y-2">
            {displayColumns.map((col) => {
              const isEmbedded = embeddedColumns.includes(col.name);
              const embeddedFKValues = embeddedFKValueMap.get(col.name);
              const rawValue = formatCellValue(data[col.name] ?? null);
              return (
                <div key={col.name} className="space-y-1">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {col.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground/60 font-mono">
                        {col.db_type || "unknown"}
                      </span>
                      {sourceColumnName && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            handleToggleEmbed(col.name);
                          }}
                          title={
                            isEmbedded
                              ? "Click to remove embedding"
                              : "Embed this column"
                          }
                          className={isEmbedded ? "text-status-ok" : ""}
                        >
                          {isEmbedded ? (
                            <IconCheck className="h-3 w-3" />
                          ) : (
                            <IconPlus className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="relative group rounded-md bg-muted/40 border border-border">
                    <div className="text-xs font-mono break-all line-clamp-5 p-2 pr-8">
                      {rawValue === "NULL" ? (
                        <span className="text-muted-foreground/50 italic">
                          NULL
                        </span>
                      ) : isTypePlaceholder(rawValue) ? (
                        <span className="text-muted-foreground/50 italic">
                          {rawValue}
                        </span>
                      ) : (
                        rawValue
                      )}
                      {embeddedFKValues && embeddedFKValues.length > 0 && (
                        <>
                          <span className="text-muted-foreground/50">
                            {" → "}
                          </span>
                          {embeddedFKValues.map((val, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] bg-muted text-muted-foreground mr-1"
                            >
                              {val}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        handleCopy(col.name, rawValue);
                      }}
                    >
                      {copiedColumn === col.name ? (
                        <IconCheck className="text-status-ok" />
                      ) : (
                        <IconCopy />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
