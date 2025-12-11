import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFKPreviewData } from "@/hooks/useFKPreviewData";
import { IconX, IconCopy, IconCheck, IconExternalLink } from "@tabler/icons-react";
import type { CellValue } from "@/services/backend";
import { useState } from "react";
import { toast } from "sonner";

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
}

function formatCellValue(value: CellValue): string {
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

export function FKPreviewPopover({
  open,
  onOpenChange,
  fkReference,
  fkValue,
  connectionId,
  database,
  cellBounds,
  onOpenReference,
}: FKPreviewPopoverProps) {
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);

  const { data, columns, isLoading, error } = useFKPreviewData({
    connectionId,
    database,
    schema: fkReference.referenced_schema,
    table: fkReference.referenced_table,
    pkColumn: fkReference.referenced_column,
    pkValue: fkValue,
    enabled: open,
  });

  const handleCopy = (columnName: string, value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopiedColumn(columnName);
        toast("Copied to clipboard");
        setTimeout(() => {
          setCopiedColumn(null);
        }, 2000);
      })
      .catch(() => {
        toast.error("Failed to copy");
      });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverAnchor
        style={{
          position: "absolute",
          left: cellBounds.x,
          top: cellBounds.y + cellBounds.height,
          width: cellBounds.width,
          height: 0,
          pointerEvents: "none",
        }}
      />
      <PopoverContent
        className="w-[500px] max-w-[90vw] p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        onEscapeKeyDown={() => onOpenChange(false)}
        onInteractOutside={() => onOpenChange(false)}
        collisionPadding={16}
        avoidCollisions={true}
      >
        <div className="border-b px-3 py-1.5 bg-muted/40 flex items-center justify-between gap-2">
          <div className="font-medium text-xs text-muted-foreground">
            {fkReference.referenced_schema}.{fkReference.referenced_table}
          </div>
          <div className="flex items-center gap-1">
            {onOpenReference && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 hover:bg-muted text-xs"
                onClick={() => {
                  onOpenReference();
                  onOpenChange(false);
                }}
                title="Open referenced table"
              >
                <IconExternalLink className="h-3 w-3 mr-0.5" />
                Open
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-muted"
              onClick={() => onOpenChange(false)}
              title="Close"
            >
              <IconX className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto p-2 bg-secondary">
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
            <div className="p-4 text-center text-xs text-destructive">
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
              {columns.map((col) => (
                <div key={col.name} className="space-y-1">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {col.name}
                    </span>
                    <span className="text-xs text-muted-foreground/60 font-mono">
                      {col.db_type || col.type || 'unknown'}
                    </span>
                  </div>
                  <div className="relative group rounded bg-background">
                    <div className="text-xs font-mono break-all line-clamp-5 p-2 pr-8">
                      {formatCellValue(data[col.name] ?? null)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleCopy(col.name, formatCellValue(data[col.name] ?? null))}
                    >
                      {copiedColumn === col.name ? (
                        <IconCheck className="h-3 w-3 text-green-600" />
                      ) : (
                        <IconCopy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
