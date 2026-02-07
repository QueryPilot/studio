import { memo, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { GridColumnV2, GridRowModel } from "../types";

interface DocumentInspectorPanelProps {
  selectedRow: GridRowModel | null;
  columns: GridColumnV2[];
  baselineRow?: GridRowModel | null;
  onSetBaseline?: (row: GridRowModel | null) => void;
}

function extractCellValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

function rowToDocument(row: GridRowModel, columns: GridColumnV2[]): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const column of columns) {
    doc[column.field] = extractCellValue(row[column.field]);
  }
  return doc;
}

function computeDiffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) {
    return [];
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return [prefix || "(root)"];
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  const diffs: string[] = [];

  for (const key of keys) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    diffs.push(...computeDiffPaths(aObj[key], bObj[key], nextPrefix));
  }

  return diffs;
}

function toSearchableText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function JsonTreeNode({
  label,
  value,
  path,
  search,
  depth = 0,
}: {
  label: string;
  value: unknown;
  path: string;
  search: string;
  depth?: number;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const matchSelf =
    !normalizedSearch ||
    path.toLowerCase().includes(normalizedSearch) ||
    toSearchableText(value).toLowerCase().includes(normalizedSearch);

  if (value === null || value === undefined || typeof value !== "object") {
    if (!matchSelf) return null;
    return (
      <div className="text-xs leading-6" style={{ paddingLeft: `${depth * 14}px` }}>
        <span className="text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono">{String(value)}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value as Record<string, unknown>);

  const children = entries
    .map(([key, childValue]) => (
      <JsonTreeNode
        key={`${path}.${key}`}
        label={key}
        value={childValue}
        path={path ? `${path}.${key}` : key}
        search={search}
        depth={depth + 1}
      />
    ))
    .filter(Boolean);

  if (!matchSelf && children.length === 0) {
    return null;
  }

  const summary = Array.isArray(value)
    ? `[${value.length} items]`
    : `{${Object.keys(value as Record<string, unknown>).length} fields}`;

  return (
    <details open={depth < 2} className="text-xs">
      <summary className="cursor-pointer leading-6">
        <span className="text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono">{summary}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

export const DocumentInspectorPanel = memo(function DocumentInspectorPanel({
  selectedRow,
  columns,
  baselineRow = null,
  onSetBaseline,
}: DocumentInspectorPanelProps) {
  const [search, setSearch] = useState("");

  const selectedDocument = useMemo(() => {
    if (!selectedRow) return null;
    return rowToDocument(selectedRow, columns);
  }, [selectedRow, columns]);

  const baselineDocument = useMemo(() => {
    if (!baselineRow) return null;
    return rowToDocument(baselineRow, columns);
  }, [baselineRow, columns]);

  const diffPaths = useMemo(() => {
    if (!selectedDocument || !baselineDocument) return [];
    return computeDiffPaths(selectedDocument, baselineDocument);
  }, [selectedDocument, baselineDocument]);

  if (!selectedDocument) {
    return (
      <div className="h-full w-full border-l bg-background p-4 text-xs text-muted-foreground">
        Select a document cell to inspect structured JSON details.
      </div>
    );
  }

  return (
    <div className="h-full w-full border-l bg-background flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Inspector</span>
          {baselineDocument && <Badge variant="secondary">Compare enabled</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {onSetBaseline && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                onSetBaseline(selectedRow);
              }}
            >
              Set Baseline
            </Button>
          )}
          {baselineDocument && onSetBaseline && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => {
                onSetBaseline(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="tree" className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-2">
          <TabsList className="h-8">
            <TabsTrigger value="tree" className="text-[11px]">
              Tree
            </TabsTrigger>
            <TabsTrigger value="raw" className="text-[11px]">
              Raw
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-[11px]">
              Diff
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tree" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search path or value"
            className="h-8 text-xs mb-2"
          />
          <ScrollArea className="h-[calc(100%-2.5rem)] rounded border p-2">
            {Object.entries(selectedDocument).map(([key, value]) => (
              <JsonTreeNode
                key={key}
                label={key}
                value={value}
                path={key}
                search={search}
              />
            ))}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="raw" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          <ScrollArea className="h-full rounded border p-2">
            <pre className="text-xs whitespace-pre-wrap break-all font-mono">
              {JSON.stringify(selectedDocument, null, 2)}
            </pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="diff" className="flex-1 min-h-0 mt-2 px-3 pb-3">
          {!baselineDocument ? (
            <div className="text-xs text-muted-foreground border rounded p-3">
              Set a baseline document to compare changes.
            </div>
          ) : (
            <ScrollArea className="h-full rounded border p-2">
              {diffPaths.length === 0 ? (
                <div className="text-xs text-muted-foreground">No differences.</div>
              ) : (
                <ul className="space-y-1">
                  {diffPaths.map((path) => (
                    <li key={path} className="text-xs font-mono">
                      {path}
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
});
