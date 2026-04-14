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
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { DuckDbAttachCatalogRequest } from "@/services/backend";

type CatalogType = "iceberg" | "delta" | "ducklake";

interface CatalogTypeOption {
  value: CatalogType;
  label: string;
  description: string;
  emoji: string;
}

const CATALOG_TYPES: CatalogTypeOption[] = [
  {
    value: "iceberg",
    label: "Iceberg",
    description: "Apache Iceberg tables via REST, Glue, or S3 catalog",
    emoji: "\u{1F9CA}",
  },
  {
    value: "delta",
    label: "Delta Lake",
    description: "Delta Lake tables via Unity Catalog",
    emoji: "\u{1F4D0}",
  },
  {
    value: "ducklake",
    label: "DuckLake",
    description: "DuckDB-native lakehouse backed by any metadata store",
    emoji: "\u{1F986}",
  },
];

const ALIAS_PATTERN = /^[a-zA-Z0-9_]+$/;

interface DuckDbAttachCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (request: DuckDbAttachCatalogRequest) => void | Promise<void>;
}

function buildPreviewSql(
  catalogType: CatalogType,
  alias: string,
  catalogUri: string,
  readOnly: boolean,
  extraOptions: Record<string, string>,
): string {
  const ext = catalogType;
  const lines: string[] = [];
  lines.push(`INSTALL '${ext}'; LOAD '${ext}';`);
  lines.push("");

  const attachPath =
    catalogType === "ducklake" ? `ducklake:${catalogUri}` : catalogUri;
  const optParts = [`TYPE ${catalogType.toUpperCase()}`];

  if (catalogType !== "ducklake" && catalogUri) {
    optParts.push(`CATALOG_URI '${catalogUri}'`);
  }

  for (const [k, v] of Object.entries(extraOptions)) {
    if (v) optParts.push(`${k} '${v}'`);
  }

  if (readOnly) {
    optParts.push("READ_ONLY");
  }

  lines.push(
    `ATTACH '${attachPath}' AS "${alias}" (${optParts.join(", ")});`,
  );
  return lines.join("\n");
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 justify-center mb-4">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? "w-6 bg-primary"
              : i < current
                ? "w-1.5 bg-primary/50"
                : "w-1.5 bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

function DuckDbAttachCatalogForm({
  onClose,
  onSubmit,
}: Omit<DuckDbAttachCatalogDialogProps, "open">) {
  const [step, setStep] = useState(0);
  const [catalogType, setCatalogType] = useState<CatalogType>("iceberg");
  const [alias, setAlias] = useState("");
  const [catalogUri, setCatalogUri] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [icebergCatalogType, setIcebergCatalogType] = useState("REST");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [deltaToken, setDeltaToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliasError =
    alias.length > 0 && !ALIAS_PATTERN.test(alias)
      ? "Only letters, numbers, and underscores allowed"
      : null;

  const extraOptions = useMemo(() => {
    const opts: Record<string, string> = {};
    if (catalogType === "iceberg") {
      if (icebergCatalogType !== "REST") {
        opts["CATALOG_TYPE"] = icebergCatalogType;
      }
      if (extraHeaders.trim()) {
        opts["EXTRA_HTTP_HEADERS"] = extraHeaders.trim();
      }
    } else if (catalogType === "delta") {
      if (deltaToken.trim()) {
        opts["TOKEN"] = deltaToken.trim();
      }
    }
    return opts;
  }, [catalogType, icebergCatalogType, extraHeaders, deltaToken]);

  const canGoToStep2 = catalogType.length > 0;
  const canGoToStep3 =
    alias.trim().length > 0 &&
    !aliasError &&
    (catalogType === "ducklake" || catalogUri.trim().length > 0);

  const previewSql = useMemo(
    () =>
      buildPreviewSql(
        catalogType,
        alias || "my_catalog",
        catalogUri,
        readOnly,
        extraOptions,
      ),
    [catalogType, alias, catalogUri, readOnly, extraOptions],
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const allOptions = { ...extraOptions };
    if (readOnly) {
      allOptions["READ_ONLY"] = "true";
    }

    try {
      await onSubmit({
        catalogType,
        alias: alias.trim(),
        catalogUri: catalogUri.trim(),
        extraOptions: allOptions,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    catalogType,
    alias,
    catalogUri,
    readOnly,
    extraOptions,
    onSubmit,
  ]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attach Catalog</DialogTitle>
        <DialogDescription>
          {step === 0 && "Choose a lakehouse catalog type to attach."}
          {step === 1 && "Configure connection details for the catalog."}
          {step === 2 && "Review the generated SQL and attach."}
        </DialogDescription>
      </DialogHeader>

      <StepIndicator current={step} total={3} />

      {step === 0 && (
        <div className="grid gap-2">
          {CATALOG_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => {
                setCatalogType(ct.value);
              }}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                catalogType === ct.value
                  ? "border-primary bg-primary/5"
                  : "border-border"
              }`}
            >
              <span className="text-2xl leading-none mt-0.5">{ct.emoji}</span>
              <div className="min-w-0">
                <div className="font-medium text-sm">{ct.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {ct.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-alias">Alias</Label>
            <Input
              id="catalog-alias"
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
              }}
              placeholder="my_catalog"
              autoFocus
            />
            {aliasError && (
              <p className="text-xs text-destructive">{aliasError}</p>
            )}
          </div>

          {catalogType === "iceberg" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-uri">Catalog URI</Label>
                <Input
                  id="catalog-uri"
                  value={catalogUri}
                  onChange={(e) => {
                    setCatalogUri(e.target.value);
                  }}
                  placeholder="http://rest-catalog:8181"
                  className="font-mono text-[11px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iceberg-catalog-type">Catalog Type</Label>
                <Select
                  value={icebergCatalogType}
                  onValueChange={(v) => {
                    setIcebergCatalogType(v ?? "REST");
                  }}
                >
                  <SelectTrigger id="iceberg-catalog-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REST">REST</SelectItem>
                    <SelectItem value="GLUE">AWS Glue</SelectItem>
                    <SelectItem value="S3">S3 Tables</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iceberg-headers">
                  Extra HTTP Headers{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="iceberg-headers"
                  value={extraHeaders}
                  onChange={(e) => {
                    setExtraHeaders(e.target.value);
                  }}
                  placeholder='{"Authorization": "Bearer ..."}'
                  className="font-mono text-[11px]"
                />
              </div>
            </>
          )}

          {catalogType === "delta" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-uri">Catalog URI</Label>
                <Input
                  id="catalog-uri"
                  value={catalogUri}
                  onChange={(e) => {
                    setCatalogUri(e.target.value);
                  }}
                  placeholder="https://accounts.cloud.databricks.com"
                  className="font-mono text-[11px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="delta-token">
                  Token{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional, for Unity Catalog auth)
                  </span>
                </Label>
                <Input
                  id="delta-token"
                  type="password"
                  value={deltaToken}
                  onChange={(e) => {
                    setDeltaToken(e.target.value);
                  }}
                  placeholder="dapi..."
                  className="font-mono text-[11px]"
                />
              </div>
            </>
          )}

          {catalogType === "ducklake" && (
            <div className="space-y-1.5">
              <Label htmlFor="catalog-uri">Metadata Database</Label>
              <Input
                id="catalog-uri"
                value={catalogUri}
                onChange={(e) => {
                  setCatalogUri(e.target.value);
                }}
                placeholder="postgres://user:pass@host/db  or  /path/to/meta.duckdb"
                className="font-mono text-[11px]"
              />
              <p className="text-xs text-muted-foreground">
                Connection string or file path to the metadata store.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="catalog-readonly"
              checked={readOnly}
              onCheckedChange={(checked) => { setReadOnly(checked === true); }}
            />
            <Label htmlFor="catalog-readonly" className="text-sm font-normal">
              Read-only
            </Label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <Label>Generated SQL</Label>
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {previewSql}
          </pre>
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
              {error}
            </p>
          )}
        </div>
      )}

      <DialogFooter className="flex justify-between sm:justify-between">
        <div>
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
              disabled={isSubmitting}
            >
              <IconChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          {step === 0 && (
            <Button onClick={() => { setStep(1); }} disabled={!canGoToStep2}>
              Next
              <IconChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 1 && (
            <Button onClick={() => { setStep(2); }} disabled={!canGoToStep3}>
              Review
              <IconChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => { void handleSubmit(); }} disabled={isSubmitting}>
              {isSubmitting ? "Attaching..." : "Attach"}
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}

export function DuckDbAttachCatalogDialog({
  open,
  onClose,
  onSubmit,
}: DuckDbAttachCatalogDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(openValue) => {
        if (!openValue) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {open && (
          <DuckDbAttachCatalogForm onClose={onClose} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}
