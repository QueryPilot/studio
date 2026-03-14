import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { MongoResultViewer } from "@/components/MongoQueryPanel/MongoResultViewer";
import { normalizeMongoResult } from "@/components/MongoQueryPanel/mongo-result-state";
import type { MongoResultViewMode } from "@/components/MongoQueryPanel/MongoQueryToolbar";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type {
  DocumentFieldStat,
  DocumentSchemaSample,
  MongoCollectionMetadata,
  MongoIndexInfo,
  MongoIndexOptions,
} from "@/adapters/types/mongodb";

import { useCrudStore } from "@/stores/crudStore";

import type {
  CrudCommand,
  CrudCommandPayload,
  CrudCommandTarget,
  DocumentIndexCreatePayload,
  DocumentIndexDropPayload,
  JsonValue,
} from "@/types/crud";
import {
  type MongoWorkbenchState,
} from "@/types/mongoWorkbench";


type ValidatorOverlay = {
  required?: boolean;
  bsonType?: string | string[];
};

type SchemaTreeNode = {
  key: string;
  path: string;
  label: string;
  children: SchemaTreeNode[];
  field?: DocumentFieldStat;
  overlay?: ValidatorOverlay;
};

type AggregationParseResult =
  | { ok: true; pipeline: object[] }
  | { ok: false; error: string };

const EMPTY_COMMANDS: CrudCommand[] = [];
const DEFAULT_STAGE_TEMPLATES: Record<string, string> = {
  Match: JSON.stringify({ $match: {} }, null, 2),
  Group: JSON.stringify({ $group: { _id: "$field", count: { $sum: 1 } } }, null, 2),
  Sort: JSON.stringify({ $sort: { createdAt: -1 } }, null, 2),
  Project: JSON.stringify({ $project: { _id: 0 } }, null, 2),
  Limit: JSON.stringify({ $limit: 50 }, null, 2),
};

export function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2 bg-muted/20">
      <CardHeader className="gap-0.5">
        <CardDescription className="text-[11px] uppercase tracking-wide">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}


function normalizeSamplePath(path: string): string {
  return path
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "[]" : segment))
    .join(".");
}

function formatPercent(value: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatTypes(
  field?: DocumentFieldStat,
  overlay?: ValidatorOverlay,
): string {
  const types = new Set<string>(field?.types ?? []);
  const overlayTypes = Array.isArray(overlay?.bsonType)
    ? overlay.bsonType
    : overlay?.bsonType
      ? [overlay.bsonType]
      : [];
  for (const type of overlayTypes) {
    types.add(type);
  }
  return Array.from(types).join(", ");
}

function formatSampleValues(values: unknown[] | undefined): string {
  if (!values || values.length === 0) {
    return "No samples";
  }

  return values
    .slice(0, 3)
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value);
    })
    .join(" | ");
}

function buildValidatorOverlayMap(
  validator: Record<string, unknown> | undefined,
): Map<string, ValidatorOverlay> {
  const result = new Map<string, ValidatorOverlay>();
  const root =
    validator && typeof validator.$jsonSchema === "object" && validator.$jsonSchema
      ? (validator.$jsonSchema as Record<string, unknown>)
      : validator;

  const visit = (schema: unknown, path: string): void => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      return;
    }

    const schemaRecord = schema as Record<string, unknown>;
    if (path) {
      const current = result.get(path) ?? {};
      if (schemaRecord.bsonType !== undefined) {
        current.bsonType = schemaRecord.bsonType as string | string[];
      }
      result.set(path, current);
    }

    const requiredFields = new Set(
      Array.isArray(schemaRecord.required)
        ? schemaRecord.required.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const properties =
      schemaRecord.properties &&
      typeof schemaRecord.properties === "object" &&
      !Array.isArray(schemaRecord.properties)
        ? (schemaRecord.properties as Record<string, unknown>)
        : undefined;

    if (properties) {
      for (const [key, child] of Object.entries(properties)) {
        const childPath = path ? `${path}.${key}` : key;
        const current = result.get(childPath) ?? {};
        if (requiredFields.has(key)) {
          current.required = true;
        }
        result.set(childPath, current);
        visit(child, childPath);
      }
    }

    if (
      schemaRecord.items &&
      typeof schemaRecord.items === "object" &&
      !Array.isArray(schemaRecord.items)
    ) {
      const itemPath = path ? `${path}.[]` : "[]";
      visit(schemaRecord.items, itemPath);
    }
  };

  visit(root, "");
  return result;
}

function ensureTreeNode(
  root: SchemaTreeNode,
  path: string,
): SchemaTreeNode {
  const parts = path.split(".").filter(Boolean);
  let current = root;
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}.${part}` : part;
    let next = current.children.find((child) => child.label === part);
    if (!next) {
      next = {
        key: currentPath,
        path: currentPath,
        label: part,
        children: [],
      };
      current.children.push(next);
    }
    current = next;
  }

  return current;
}

function buildSchemaTree(
  sample: DocumentSchemaSample | null,
  metadata: MongoCollectionMetadata | null,
): SchemaTreeNode {
  const root: SchemaTreeNode = {
    key: "root",
    path: "",
    label: "root",
    children: [],
  };

  const overlayMap = buildValidatorOverlayMap(metadata?.validator);

  for (const field of sample?.fields ?? []) {
    const normalizedPath = normalizeSamplePath(field.path);
    const node = ensureTreeNode(root, normalizedPath);
    node.field = field;
    node.overlay = overlayMap.get(normalizedPath);
  }

  for (const [path, overlay] of overlayMap.entries()) {
    if (!path) {
      continue;
    }
    const node = ensureTreeNode(root, path);
    node.overlay = overlay;
  }

  const sortNodes = (node: SchemaTreeNode): void => {
    node.children.sort((left, right) => left.label.localeCompare(right.label));
    node.children.forEach(sortNodes);
  };
  sortNodes(root);

  return root;
}

function parseAggregationStages(stages: string[]): AggregationParseResult {
  const pipeline: object[] = [];

  for (let index = 0; index < stages.length; index += 1) {
    const stageText = stages[index]?.trim() ?? "";
    if (!stageText) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stageText);
    } catch (error) {
      return {
        ok: false,
        error: `Stage ${index + 1} has invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Stage ${index + 1} must be a JSON object`,
      };
    }

    pipeline.push(parsed);
  }

  return { ok: true, pipeline };
}

export function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = toJsonValue(entry);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }

  return undefined;
}

export function normalizeIndexOptionsForCrud(
  options: MongoIndexOptions,
): Record<string, JsonValue> {
  const normalized = toJsonValue(options);
  return normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? normalized
    : {};
}

export function buildMongoCommand<TPayload extends CrudCommandPayload>(
  type:
    | "document.index.create"
    | "document.index.drop"
    | "document.validation.update",
  target: CrudCommandTarget,
  payload: TPayload,
  description: string,
  entityName?: string,
): CrudCommand<TPayload> {
  return {
    id: nanoid(),
    type,
    target: {
      ...target,
      entityName,
    },
    payload,
    metadata: {
      timestamp: new Date().toISOString(),
      description,
      source: "ui",
    },
    state: "staged",
  };
}

function swapStages(stages: string[], fromIndex: number, toIndex: number): string[] {
  const fromValue = stages[fromIndex];
  const toValue = stages[toIndex];

  if (fromValue === undefined || toValue === undefined) {
    return stages;
  }

  const nextStages = [...stages];
  nextStages[fromIndex] = toValue;
  nextStages[toIndex] = fromValue;
  return nextStages;
}


function SchemaNodeView({
  node,
  sampleSize,
}: {
  node: SchemaTreeNode;
  sampleSize: number;
}): React.ReactNode {
  const hasStats = Boolean(node.field || node.overlay);
  return (
    <div className="space-y-2">
      {node.path ? (
        <div className="rounded border bg-muted/20 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-foreground">
              {node.label}
            </span>
            {node.overlay?.required ? (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                required
              </span>
            ) : null}
            {formatTypes(node.field, node.overlay) ? (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700">
                {formatTypes(node.field, node.overlay)}
              </span>
            ) : null}
          </div>
          {hasStats ? (
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {node.field ? (
                <>
                  <span>
                    present {formatPercent(node.field.occurrences, sampleSize)}
                  </span>
                  <span>
                    null {formatPercent(node.field.nullCount, node.field.occurrences)}
                  </span>
                  <span>{formatSampleValues(node.field.sampleValues)}</span>
                </>
              ) : (
                <span>Defined by validator, not observed in sample</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {node.children.length > 0 ? (
        <div className="space-y-2 pl-4">
          {node.children.map((child) => (
            <SchemaNodeView
              key={child.key}
              node={child}
              sampleSize={sampleSize}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const MongoStructureView = memo(function MongoStructureView({
  connectionId,
  database,
  collection,
  workbenchState,
  onWorkbenchStateChange,
}: {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}) {
  const [sample, setSample] = useState<DocumentSchemaSample | null>(null);
  const [metadata, setMetadata] = useState<MongoCollectionMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sampleSize = workbenchState.structureSampleSize ?? 500;
  const maxDepth = workbenchState.structureMaxDepth ?? 4;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const [nextMetadata, nextSample] = await Promise.all([
        adapter.getCollectionMetadata(collection, database),
        adapter.sampleCollectionSchema(
          collection,
          undefined,
          {
            sampleSize,
            maxDepth,
          },
          database,
        ),
      ]);
      setMetadata(nextMetadata);
      setSample(nextSample);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [collection, connectionId, database, maxDepth, sampleSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(
    () => buildSchemaTree(sample, metadata),
    [metadata, sample],
  );

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mongo-structure-sample-size">Sample size</Label>
          <Input
            id="mongo-structure-sample-size"
            type="number"
            min={50}
            max={5000}
            value={sampleSize}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureSampleSize: Number(event.target.value) || 500,
              });
            }}
            className="h-8 w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mongo-structure-max-depth">Max depth</Label>
          <Input
            id="mongo-structure-max-depth"
            type="number"
            min={1}
            max={12}
            value={maxDepth}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureMaxDepth: Number(event.target.value) || 4,
              });
            }}
            className="h-8 w-24"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {metadata ? (
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <StatCard
            label="Sampled docs"
            value={sample ? sample.scannedCount.toLocaleString() : 0}
          />
          <StatCard
            label="Fields"
            value={sample ? sample.fields.length.toLocaleString() : 0}
          />
          <StatCard
            label="Validator"
            value={metadata.validator ? "Attached" : "None"}
          />
          <StatCard
            label="Collection docs"
            value={metadata.stats?.count?.toLocaleString() ?? "n/a"}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading structure…</div>
      ) : error ? (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : tree.children.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No sampled fields were returned.
        </div>
      ) : (
        <div className="space-y-3">
          {tree.children.map((child) => (
            <SchemaNodeView
              key={child.key}
              node={child}
              sampleSize={sample?.scannedCount ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export const MongoIndexesView = memo(function MongoIndexesView({
  target,
}: {
  target: CrudCommandTarget;
}) {
  const [indexes, setIndexes] = useState<MongoIndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexName, setIndexName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [direction, setDirection] = useState<"1" | "-1" | "text">("1");
  const [secondaryFieldName, setSecondaryFieldName] = useState("");
  const [secondaryDirection, setSecondaryDirection] = useState<"1" | "-1" | "text">("-1");
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [expireAfterSeconds, setExpireAfterSeconds] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("english");
  const [languageOverride, setLanguageOverride] = useState("language");
  const [usageByName, setUsageByName] = useState<Record<string, number>>({});

  const stageCommand = useCrudStore((state) => state.stageCommand);
  const unstageCommand = useCrudStore((state) => state.unstageCommand);
  const getTableKey = useCrudStore((state) => state.getTableKey);
  const stagedCommands =
    useCrudStore((state) => state.stagedCommands.get(getTableKey(target)) ?? EMPTY_COMMANDS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adapter = new MongoDBAdapter(target.connectionId);
      const [nextIndexes, stats] = await Promise.all([
        adapter.listIndexes(target.table ?? "", target.database),
        adapter.getIndexUsageStats(target.table ?? "", target.database),
      ]);
      setIndexes(nextIndexes);
      setUsageByName(
        stats.reduce<Record<string, number>>((acc, stat) => {
          acc[stat.name] = stat.accesses.ops;
          return acc;
        }, {}),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [target.connectionId, target.database, target.table]);

  useEffect(() => {
    void load();
  }, [load]);

  const stageCreate = useCallback(() => {
    const keys: Record<string, 1 | -1 | "text"> = {};
    if (fieldName.trim()) {
      keys[fieldName.trim()] =
        direction === "text" ? "text" : direction === "-1" ? -1 : 1;
    }
    if (secondaryFieldName.trim()) {
      keys[secondaryFieldName.trim()] =
        secondaryDirection === "text"
          ? "text"
          : secondaryDirection === "-1"
            ? -1
            : 1;
    }

    if (!indexName.trim() || Object.keys(keys).length === 0) {
      setError("Provide an index name and at least one key");
      return;
    }

    const options: MongoIndexOptions = {
      name: indexName.trim(),
      unique,
      sparse,
    };

    if (expireAfterSeconds.trim()) {
      const ttl = Number(expireAfterSeconds);
      if (!Number.isNaN(ttl) && ttl > 0) {
        options.expireAfterSeconds = ttl;
      }
    }
    if (Object.values(keys).includes("text")) {
      options.defaultLanguage = defaultLanguage;
      options.languageOverride = languageOverride;
    }

    const command = buildMongoCommand<DocumentIndexCreatePayload>(
      "document.index.create",
      target,
      {
        definition: {
          name: indexName.trim(),
          keys,
          options: normalizeIndexOptionsForCrud(options),
        },
      },
      `Create MongoDB index ${indexName.trim()}`,
      indexName.trim(),
    );
    stageCommand(command);
  }, [
    defaultLanguage,
    direction,
    expireAfterSeconds,
    fieldName,
    indexName,
    languageOverride,
    secondaryDirection,
    secondaryFieldName,
    sparse,
    stageCommand,
    target,
    unique,
  ]);

  const stageDrop = useCallback(
    (name: string) => {
      const existing = stagedCommands.find(
        (command) =>
          command.type === "document.index.drop" &&
          (command.payload as DocumentIndexDropPayload).indexName === name,
      );
      if (existing) {
        unstageCommand(existing.id);
        return;
      }

      const command = buildMongoCommand<DocumentIndexDropPayload>(
        "document.index.drop",
        target,
        { indexName: name },
        `Drop MongoDB index ${name}`,
        name,
      );
      stageCommand(command);
    },
    [stageCommand, stagedCommands, target, unstageCommand],
  );

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Indexes</h3>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <Card className="mb-4 gap-3 bg-muted/10">
        <CardHeader className="pb-0">
          <CardTitle>Create index</CardTitle>
          <CardDescription>
            Stage compound, TTL, and text indexes using the shared admin flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-name">Index name</Label>
            <Input
              id="mongo-index-name"
              value={indexName}
              onChange={(event) => {
                setIndexName(event.target.value);
              }}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-primary-field">Primary field</Label>
            <div className="flex gap-2">
              <Input
                id="mongo-index-primary-field"
                value={fieldName}
                onChange={(event) => {
                  setFieldName(event.target.value);
                }}
                className="h-9 flex-1"
              />
              <Select
                value={direction}
                onValueChange={(value) => {
                  setDirection(value as "1" | "-1" | "text");
                }}
              >
                <SelectTrigger
                  id="mongo-index-primary-direction"
                  className="h-9 w-28"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Asc</SelectItem>
                  <SelectItem value="-1">Desc</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-secondary-field">Secondary field</Label>
            <div className="flex gap-2">
              <Input
                id="mongo-index-secondary-field"
                value={secondaryFieldName}
                onChange={(event) => {
                  setSecondaryFieldName(event.target.value);
                }}
                className="h-9 flex-1"
              />
              <Select
                value={secondaryDirection}
                onValueChange={(value) => {
                  setSecondaryDirection(value as "1" | "-1" | "text");
                }}
              >
                <SelectTrigger
                  id="mongo-index-secondary-direction"
                  className="h-9 w-28"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Asc</SelectItem>
                  <SelectItem value="-1">Desc</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-ttl">TTL seconds</Label>
            <Input
              id="mongo-index-ttl"
              type="number"
              min={0}
              value={expireAfterSeconds}
              onChange={(event) => {
                setExpireAfterSeconds(event.target.value);
              }}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-default-language">Default language</Label>
            <Input
              id="mongo-index-default-language"
              value={defaultLanguage}
              onChange={(event) => {
                setDefaultLanguage(event.target.value);
              }}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mongo-index-language-override">Language override</Label>
            <Input
              id="mongo-index-language-override"
              value={languageOverride}
              onChange={(event) => {
                setLanguageOverride(event.target.value);
              }}
              className="h-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="mongo-index-unique"
                checked={unique}
                onCheckedChange={(checked) => {
                  setUnique(checked);
                }}
              />
              <Label htmlFor="mongo-index-unique">Unique</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="mongo-index-sparse"
                checked={sparse}
                onCheckedChange={(checked) => {
                  setSparse(checked);
                }}
              />
              <Label htmlFor="mongo-index-sparse">Sparse</Label>
            </div>
            <Button size="sm" onClick={stageCreate}>
              Stage Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="mb-4 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading indexes…</div>
        ) : indexes.length === 0 ? (
          <div className="text-sm text-muted-foreground">No indexes found.</div>
        ) : (
          indexes.map((index) => {
            const stagedDrop = stagedCommands.find(
              (command) =>
                command.type === "document.index.drop" &&
                (command.payload as DocumentIndexDropPayload).indexName === index.name,
            );

            return (
              <Card key={index.name} size="sm" className="bg-background/60">
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="font-mono text-sm font-medium">{index.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {Object.entries(index.keys)
                        .map(([key, value]) => `${key}:${value}`)
                        .join(", ")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {index.unique ? <Badge variant="secondary">unique</Badge> : null}
                      {index.sparse ? <Badge variant="secondary">sparse</Badge> : null}
                      {typeof index.expireAfterSeconds === "number" ? (
                        <Badge variant="secondary">
                          ttl {index.expireAfterSeconds}s
                        </Badge>
                      ) : null}
                      {usageByName[index.name] !== undefined ? (
                        <Badge variant="secondary">
                          usage {usageByName[index.name]}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={stagedDrop ? "secondary" : "outline"}
                    onClick={() => {
                      stageDrop(index.name);
                    }}
                    disabled={index.name === "_id_"}
                  >
                    {stagedDrop ? "Unstage Drop" : "Stage Drop"}
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
});

export const MongoAggregationView = memo(function MongoAggregationView({
  connectionId,
  database,
  collection,
  tabId,
  workbenchState,
  onWorkbenchStateChange,
  onOpenExplain,
}: {
  connectionId: string;
  database: string;
  collection: string;
  tabId: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
  onOpenExplain: () => void;
}) {
  const [result, setResult] = useState<ReturnType<typeof normalizeMongoResult> | null>(null);
  const [resultViewMode, setResultViewMode] = useState<MongoResultViewMode>("data");
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages = useMemo(
    () => workbenchState.aggregationStages ?? [],
    [workbenchState.aggregationStages],
  );
  const parsed = useMemo(() => parseAggregationStages(stages), [stages]);

  const updateStages = useCallback(
    (nextStages: string[]) => {
      onWorkbenchStateChange({ aggregationStages: nextStages });
    },
    [onWorkbenchStateChange],
  );

  const runAggregation = useCallback(async () => {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    const start = performance.now();
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const documents = await adapter.aggregate(
        collection,
        parsed.pipeline,
        database,
      );
      setResult(
        normalizeMongoResult({
          operation: "aggregate",
          result: documents,
          collection,
        }),
      );
      setResultViewMode("data");
      setExecutionTime(Math.round(performance.now() - start));
    } catch (runError) {
      const normalized = normalizeMongoResult({
        operation: "aggregate",
        error: runError,
        collection,
      });
      setResult(normalized);
      setResultViewMode("json");
      setExecutionTime(Math.round(performance.now() - start));
    }
  }, [collection, connectionId, database, parsed]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-3 p-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(DEFAULT_STAGE_TEMPLATES).map(([label, template]) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            onClick={() => {
              updateStages([...stages, template]);
            }}
          >
            Add {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            updateStages(stages.filter((stage) => stage.trim().length > 0));
          }}
        >
          Trim Empty
        </Button>
        <Button size="sm" onClick={() => void runAggregation()}>
          Run
        </Button>
        <Button size="sm" variant="outline" onClick={onOpenExplain}>
          Explain
        </Button>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <Card className="min-h-0">
          <CardHeader className="pb-0">
            <CardTitle>Pipeline stages</CardTitle>
            <CardDescription>
              Build and reorder stages before running the draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
          <div className="space-y-2">
            {stages.length === 0 ? (
              <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                Add a stage to begin building a pipeline.
              </div>
            ) : (
              stages.map((stage, index) => (
                <div key={`${index}-${stage.length}`} className="rounded border p-2">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Stage {index + 1}</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (index === 0) return;
                          updateStages(swapStages(stages, index, index - 1));
                        }}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (index >= stages.length - 1) return;
                          updateStages(swapStages(stages, index, index + 1));
                        }}
                      >
                        Down
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          updateStages(
                            stages.filter((_, stageIndex) => stageIndex !== index),
                          );
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={stage}
                    onChange={(event) => {
                      const nextStages = [...stages];
                      nextStages[index] = event.target.value;
                      updateStages(nextStages);
                    }}
                    className="min-h-[132px] font-mono text-xs"
                  />
                </div>
              ))
            )}
          </div>
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="pb-0">
            <CardTitle>Combined pipeline</CardTitle>
            <CardDescription>
              Review the final pipeline payload before execution or explain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <pre className="min-h-[220px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
              {parsed.ok
                ? JSON.stringify(parsed.pipeline, null, 2)
                : parsed.error}
            </pre>
          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="min-h-0 overflow-hidden rounded border">
        <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
          <div className="text-sm font-semibold">Results</div>
          <Tabs
            value={resultViewMode}
            onValueChange={(value) => {
              setResultViewMode(value as MongoResultViewMode);
            }}
          >
            <TabsList className="h-6 p-0.5">
              <TabsTrigger value="data" className="h-5 px-2 text-xs">
                Data
              </TabsTrigger>
              <TabsTrigger value="json" className="h-5 px-2 text-xs">
                JSON
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <MongoResultViewer
          result={result}
          viewMode={resultViewMode}
          connectionId={connectionId}
          database={database}
          gridId={`mongo-aggregation:${tabId}`}
          executionTime={executionTime}
          onClearResults={() => {
            setResult(null);
            setExecutionTime(null);
          }}
          className="h-full"
        />
      </div>
    </div>
  );
});

// MongoCollectionWorkbench shell has moved to ./index.tsx
// MongoExplainView has moved to @/components/MongoExplain
