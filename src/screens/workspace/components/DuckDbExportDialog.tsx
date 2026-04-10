import { useState, useMemo, useCallback } from "react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IconChevronDown, IconFolder } from "@tabler/icons-react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import {
  BackendAPI,
  type DuckDbExportRequest,
  type DuckDbExportSource,
} from "@/services/backend";

type ExportFormat = "PARQUET" | "CSV" | "JSON";

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  PARQUET: "parquet",
  CSV: "csv",
  JSON: "json",
};

const FORMAT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }[]> = {
  PARQUET: [{ name: "Parquet", extensions: ["parquet"] }],
  CSV: [{ name: "CSV", extensions: ["csv", "tsv"] }],
  JSON: [{ name: "JSON", extensions: ["json", "jsonl", "ndjson"] }],
};

const PARQUET_COMPRESSIONS = ["auto", "snappy", "zstd", "gzip", "lz4", "uncompressed"] as const;
const JSON_COMPRESSIONS = ["auto", "gzip", "zstd", "uncompressed"] as const;

export type DuckDbExportSourceProp =
  | { type: "query"; sql: string }
  | { type: "table"; schema: string; name: string };

interface DuckDbExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connId: string;
  source: DuckDbExportSourceProp;
}

function buildSourceLabel(source: DuckDbExportSourceProp): string {
  if (source.type === "table") {
    return `${source.schema}.${source.name}`;
  }
  const trimmed = source.sql.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function replaceExtension(path: string, ext: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastDot > lastSep && lastDot > 0) {
    return `${path.slice(0, lastDot)}.${ext}`;
  }
  return `${path}.${ext}`;
}

function DuckDbExportForm({
  connId,
  source,
  onClose,
}: {
  connId: string;
  source: DuckDbExportSourceProp;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("PARQUET");
  const [destination, setDestination] = useState("");
  const [querySql, setQuerySql] = useState(
    source.type === "query" ? source.sql : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Parquet options
  const [compression, setCompression] = useState("auto");
  const [rowGroupSize, setRowGroupSize] = useState("");

  // CSV options
  const [csvHeader, setCsvHeader] = useState(true);
  const [csvDelimiter, setCsvDelimiter] = useState(",");
  const [csvQuote, setCsvQuote] = useState("");
  const [csvEscape, setCsvEscape] = useState("");
  const [csvNullValue, setCsvNullValue] = useState("");

  // JSON options
  const [jsonCompression, setJsonCompression] = useState("auto");
  const [jsonArray, setJsonArray] = useState(false);

  // Partition options
  const [partitionBy, setPartitionBy] = useState("");
  const [overwriteOrIgnore, setOverwriteOrIgnore] = useState(false);

  const handleFormatChange = useCallback(
    (newFormat: string) => {
      const f = newFormat as ExportFormat;
      setFormat(f);
      if (destination && !destination.startsWith("s3://")) {
        setDestination(replaceExtension(destination, FORMAT_EXTENSIONS[f]));
      }
    },
    [destination],
  );

  const handleBrowse = useCallback(async () => {
    const defaultName =
      source.type === "table" ? source.name : "export";
    const filePath = await save({
      filters: FORMAT_FILTERS[format],
      defaultPath: `${defaultName}.${FORMAT_EXTENSIONS[format]}`,
    });
    if (filePath) {
      setDestination(filePath);
    }
  }, [format, source]);

  const buildOptions = useCallback((): Record<string, string> => {
    const opts: Record<string, string> = {};

    if (format === "PARQUET") {
      if (compression !== "auto") opts.COMPRESSION = compression;
      if (rowGroupSize.trim()) opts.ROW_GROUP_SIZE = rowGroupSize.trim();
    } else if (format === "CSV") {
      if (!csvHeader) opts.HEADER = "FALSE";
      if (csvDelimiter && csvDelimiter !== ",") opts.DELIMITER = csvDelimiter;
      if (csvQuote.trim()) opts.QUOTE = csvQuote.trim();
      if (csvEscape.trim()) opts.ESCAPE = csvEscape.trim();
      if (csvNullValue.trim()) opts.NULL = csvNullValue.trim();
    } else {
      if (jsonCompression !== "auto") opts.COMPRESSION = jsonCompression;
      if (jsonArray) opts.ARRAY = "TRUE";
    }

    if (partitionBy.trim()) opts.PARTITION_BY = partitionBy.trim();
    if (overwriteOrIgnore) opts.OVERWRITE_OR_IGNORE = "TRUE";

    return opts;
  }, [
    format,
    compression,
    rowGroupSize,
    csvHeader,
    csvDelimiter,
    csvQuote,
    csvEscape,
    csvNullValue,
    jsonCompression,
    jsonArray,
    partitionBy,
    overwriteOrIgnore,
  ]);

  const canSubmit = useMemo(() => {
    if (isSubmitting || destination.trim().length === 0) return false;
    if (source.type === "query" && querySql.trim().length === 0) return false;
    return true;
  }, [destination, isSubmitting, source.type, querySql]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      let exportSource: DuckDbExportSource;
      if (source.type === "query") {
        exportSource = { query: querySql.trim() };
      } else {
        exportSource = { table: { schema: source.schema, name: source.name } };
      }

      const request: DuckDbExportRequest = {
        source: exportSource,
        destination: destination.trim(),
        format,
        options: buildOptions(),
      };

      const result = await BackendAPI.duckdbExportData(connId, request);
      toast.success(
        `Exported ${result.rowsExported.toLocaleString()} rows as ${result.format}`,
      );
      onClose();
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, source, destination, format, buildOptions, connId, onClose, querySql]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export Data</DialogTitle>
        <DialogDescription>
          Export <span className="font-medium">{buildSourceLabel(source)}</span>{" "}
          to a file or S3 location.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {source.type === "query" && (
          <div className="space-y-1.5">
            <Label htmlFor="export-query">Source Query</Label>
            <textarea
              id="export-query"
              value={querySql}
              onChange={(e) => {
                setQuerySql(e.target.value);
              }}
              placeholder="SELECT * FROM my_table"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[11px] font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y"
              rows={3}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="export-format">Format</Label>
          <Select value={format} onValueChange={(v) => { if (v) handleFormatChange(v); }}>
            <SelectTrigger id="export-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PARQUET">Parquet</SelectItem>
              <SelectItem value="CSV">CSV</SelectItem>
              <SelectItem value="JSON">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="export-destination">Destination</Label>
          <div className="flex gap-2">
            <Input
              id="export-destination"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
              }}
              placeholder={`/path/to/output.${FORMAT_EXTENSIONS[format]} or s3://bucket/key`}
              className="font-mono text-[11px] flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void handleBrowse();
              }}
              title="Browse..."
            >
              <IconFolder className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            render={<button type="button" />}
          >
            <IconChevronDown
              className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "" : "-rotate-90"}`}
            />
            Advanced Options
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 pt-3 pl-1">
              {format === "PARQUET" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="parquet-compression">Compression</Label>
                    <Select value={compression} onValueChange={(v) => { if (v) setCompression(v); }}>
                      <SelectTrigger id="parquet-compression">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARQUET_COMPRESSIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="parquet-row-group">Row Group Size</Label>
                    <Input
                      id="parquet-row-group"
                      value={rowGroupSize}
                      onChange={(e) => {
                        setRowGroupSize(e.target.value);
                      }}
                      placeholder="122880 (default)"
                      className="font-mono text-[11px]"
                    />
                  </div>
                </>
              )}

              {format === "CSV" && (
                <>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="csv-header"
                      checked={csvHeader}
                      onCheckedChange={setCsvHeader}
                    />
                    <Label htmlFor="csv-header" className="text-sm font-normal">
                      Include header row
                    </Label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="csv-delimiter">Delimiter</Label>
                      <Input
                        id="csv-delimiter"
                        value={csvDelimiter}
                        onChange={(e) => {
                          setCsvDelimiter(e.target.value);
                        }}
                        placeholder=","
                        className="font-mono text-[11px]"
                        maxLength={4}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="csv-quote">Quote</Label>
                      <Input
                        id="csv-quote"
                        value={csvQuote}
                        onChange={(e) => {
                          setCsvQuote(e.target.value);
                        }}
                        placeholder='"'
                        className="font-mono text-[11px]"
                        maxLength={4}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="csv-escape">Escape</Label>
                      <Input
                        id="csv-escape"
                        value={csvEscape}
                        onChange={(e) => {
                          setCsvEscape(e.target.value);
                        }}
                        placeholder='"'
                        className="font-mono text-[11px]"
                        maxLength={4}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="csv-null">NULL Value</Label>
                      <Input
                        id="csv-null"
                        value={csvNullValue}
                        onChange={(e) => {
                          setCsvNullValue(e.target.value);
                        }}
                        placeholder="(empty)"
                        className="font-mono text-[11px]"
                      />
                    </div>
                  </div>
                </>
              )}

              {format === "JSON" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="json-compression">Compression</Label>
                    <Select
                      value={jsonCompression}
                      onValueChange={(v) => { if (v) setJsonCompression(v); }}
                    >
                      <SelectTrigger id="json-compression">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JSON_COMPRESSIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="json-array"
                      checked={jsonArray}
                      onCheckedChange={setJsonArray}
                    />
                    <Label htmlFor="json-array" className="text-sm font-normal">
                      Wrap output in JSON array
                    </Label>
                  </div>
                </>
              )}

              <div className="border-t pt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="partition-by">
                    Partition By{" "}
                    <span className="text-muted-foreground text-xs font-normal">
                      (comma-separated columns)
                    </span>
                  </Label>
                  <Input
                    id="partition-by"
                    value={partitionBy}
                    onChange={(e) => {
                      setPartitionBy(e.target.value);
                    }}
                    placeholder="col1, col2"
                    className="font-mono text-[11px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="overwrite-or-ignore"
                    checked={overwriteOrIgnore}
                    onCheckedChange={setOverwriteOrIgnore}
                  />
                  <Label
                    htmlFor="overwrite-or-ignore"
                    className="text-sm font-normal"
                  >
                    Overwrite or ignore existing files
                  </Label>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void handleSubmit();
          }}
          disabled={!canSubmit}
        >
          {isSubmitting ? "Exporting..." : "Export"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DuckDbExportDialog({
  open,
  onOpenChange,
  connId,
  source,
}: DuckDbExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <DuckDbExportForm
            connId={connId}
            source={source}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
