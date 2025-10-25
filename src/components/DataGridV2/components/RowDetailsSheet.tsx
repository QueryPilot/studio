import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { CodeEditor } from "@/components/CodeEditor";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Copy, Check } from "lucide-react";
import type { GridColumnV2, GridRowModel } from "../types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export interface RowDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: GridRowModel[];
  columns: GridColumnV2[];
}

type ViewMode = "summary" | "json";

interface ColumnSummary {
  columnName: string;
  columnType: string;
  hasMultipleValues: boolean;
  uniqueCount: number;
  displayValue: string | null;
  rawValue: unknown;
  isJSON: boolean;
  values: unknown[];
  displayValues: string[];
}

export function RowDetailsSheet({
  open,
  onOpenChange,
  rows,
  columns,
}: RowDetailsSheetProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetWidth, setSheetWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const { toast } = useToast();

  // Calculate column summaries
  const columnSummaries = useMemo<ColumnSummary[]>(() => {
    return columns.map((col) => {
      const values = rows.map((row) => {
        const cellValue = row[col.field];
        return cellValue &&
          typeof cellValue === "object" &&
          "value" in cellValue
          ? (cellValue.value as unknown)
          : null;
      });

      const uniqueValues = Array.from(
        new Set(values.map((v) => JSON.stringify(v))),
      );
      const hasMultipleValues = uniqueValues.length > 1;
      const uniqueCount = uniqueValues.length;

      let displayValue: string | null = null;
      let rawValue: unknown = null;
      let isJSON = false;
      const displayValues: string[] = [];

      if (!hasMultipleValues && values.length > 0) {
        const val = values[0];
        rawValue = val;
        isJSON = isJSONValue(val);
        displayValue = formatDisplayValue(val, isJSON);
      } else if (hasMultipleValues) {
        // Get unique values and format them
        const uniqueVals = Array.from(
          new Map(values.map((v) => [JSON.stringify(v), v])).values(),
        );

        for (const val of uniqueVals) {
          const formatted = formatDisplayValueShort(val);
          displayValues.push(formatted);
        }
      }

      return {
        columnName: col.name,
        columnType: col.type || "unknown",
        hasMultipleValues,
        uniqueCount,
        displayValue,
        rawValue,
        isJSON,
        values,
        displayValues,
      };
    });
  }, [columns, rows]);

  // Fuzzy search filter
  const filteredSummaries = useMemo(() => {
    if (!searchQuery.trim()) {
      return columnSummaries;
    }

    const query = searchQuery.toLowerCase();
    return columnSummaries.filter((summary) => {
      // Search in column name
      const nameMatch = summary.columnName.toLowerCase().includes(query);

      // Search in column type
      const typeMatch = summary.columnType.toLowerCase().includes(query);

      // Search in display value
      const valueMatch = summary.displayValue?.toLowerCase().includes(query);

      // Search in multiple display values
      const multiValueMatch = summary.displayValues.some((val) =>
        val.toLowerCase().includes(query),
      );

      return nameMatch || typeMatch || valueMatch || multiValueMatch;
    });
  }, [columnSummaries, searchQuery]);

  // Format rows as JSON
  const jsonContent = useMemo(() => {
    const data = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col) => {
        const cellValue = row[col.field];
        obj[col.field] =
          cellValue && typeof cellValue === "object" && "value" in cellValue
            ? cellValue.value
            : null;
      });
      return obj;
    });
    return JSON.stringify(data, null, 2);
  }, [rows, columns]);

  // Copy handler
  const handleCopy = useCallback(
    (columnName: string, value: string) => {
      navigator.clipboard
        .writeText(value)
        .then(() => {
          setCopiedColumn(columnName);
          toast({
            description: "Copied to clipboard",
          });
          setTimeout(() => {
            setCopiedColumn(null);
          }, 2000);
        })
        .catch(() => {
          toast({
            description: "Failed to copy",
            variant: "destructive",
          });
        });
    },
    [toast],
  );

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = sheetWidth;
    },
    [sheetWidth],
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.max(
        300,
        Math.min(window.innerWidth * 0.8, resizeStartWidth.current + delta),
      );
      setSheetWidth(newWidth);
    },
    [isResizing],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
      };
    }
    return undefined;
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col gap-0"
        style={{ width: sheetWidth, maxWidth: "80vw" }}
      >
        {/* Resize handle */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent transition-colors z-50",
            isResizing && "bg-accent",
          )}
          onMouseDown={handleResizeStart}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-border rounded-r" />
        </div>

        {/* Header */}
        <SheetHeader className="p-2 border-b space-y-1.5">
          <div className="flex items-center gap-2 justify-start">
            <div>
              <Tabs
                value={viewMode}
                onValueChange={(value) => {
                  setViewMode(value as ViewMode);
                }}
                className="w-full"
              >
                <TabsList className="!h-7 p-0.5 !w-auto">
                  <TabsTrigger value="summary" className="!text-xs h-6 px-2">
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="json" className="!text-xs h-6 px-2">
                    JSON
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Badge variant="secondary" className="h-5 px-1.5 !text-[11px]">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
            </Badge>
          </div>
          {viewMode === "summary" && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search anything"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                className="h-7 pl-7 !text-xs"
              />
            </div>
          )}
        </SheetHeader>

        {/* Content */}
        <Tabs value={viewMode} className="flex-1 overflow-hidden flex flex-col">
          <TabsContent
            value="summary"
            className="m-0 data-[state=active]:flex-1 data-[state=active]:flex data-[state=active]:flex-col data-[state=active]:overflow-hidden"
          >
            <div className="flex-1 overflow-auto p-2 bg-secondary">
              {filteredSummaries.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No columns found matching "{searchQuery}"
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSummaries.map((summary) => (
                    <div key={summary.columnName} className="space-y-1">
                      <div className="flex items-center justify-between px-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {summary.columnName}
                        </span>
                        <span className="text-xs text-muted-foreground/60 font-mono">
                          {summary.columnType}
                        </span>
                      </div>
                      {summary.hasMultipleValues ? (
                        <div className="relative group rounded bg-background">
                          <div className="flex flex-wrap gap-1 p-2">
                            {summary.displayValues
                              .slice(0, 5)
                              .map((val, idx) => (
                                <Badge
                                  key={idx}
                                  variant="secondary"
                                  className="h-5 px-1.5 text-xs font-normal font-mono"
                                >
                                  {val}
                                </Badge>
                              ))}
                            {summary.uniqueCount > 5 && (
                              <Badge
                                variant="outline"
                                className="h-5 px-1.5 text-xs font-normal"
                              >
                                +{summary.uniqueCount - 5} more
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              handleCopy(
                                summary.columnName,
                                summary.displayValues.join(", "),
                              );
                            }}
                          >
                            {copiedColumn === summary.columnName ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      ) : summary.displayValue === null ? (
                        <div className="relative group p-2 rounded bg-background">
                          <span className="text-xs text-muted-foreground italic">
                            NULL
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              handleCopy(summary.columnName, "NULL");
                            }}
                          >
                            {copiedColumn === summary.columnName ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      ) : summary.isJSON ? (
                        <div className="relative group rounded overflow-hidden bg-background">
                          <pre className="text-xs p-2 overflow-x-auto font-mono leading-relaxed">
                            {summary.displayValue}
                          </pre>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              handleCopy(
                                summary.columnName,
                                summary.displayValue ?? "",
                              );
                            }}
                          >
                            {copiedColumn === summary.columnName ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="relative group p-2 rounded bg-background">
                          <div className="text-xs font-mono break-all pr-8">
                            {summary.displayValue}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              handleCopy(
                                summary.columnName,
                                summary.displayValue ?? "",
                              );
                            }}
                          >
                            {copiedColumn === summary.columnName ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="json"
            className="m-0 p-0 data-[state=active]:flex-1 data-[state=active]:flex data-[state=active]:flex-col data-[state=active]:overflow-hidden"
          >
            <CodeEditor
              value={jsonContent}
              language="json"
              readOnly={true}
              height="100%"
              className="border-none"
              lineNumbers={true}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Check if a value is a JSON object or array
 */
function isJSONValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  // Check if it's an object or array (but not Date)
  if (typeof value === "object" && !(value instanceof Date)) {
    return true;
  }

  return false;
}

/**
 * Format a value for display in a compact badge
 */
function formatDisplayValueShort(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    // Truncate long strings
    return value.length > 30 ? value.substring(0, 30) + "..." : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    const datePart = value.toISOString().split("T")[0];
    return datePart ?? value.toISOString();
  }

  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value);
      return str.length > 30 ? str.substring(0, 30) + "..." : str;
    } catch {
      return "[Object]";
    }
  }

  // Fallback for any other type
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return "[Unknown]";
}

/**
 * Format a value for display in summary view
 */
function formatDisplayValue(value: unknown, isJSON: boolean): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isJSON && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[Object]";
    }
  }

  // Fallback for any other type
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return "[Unknown]";
}
