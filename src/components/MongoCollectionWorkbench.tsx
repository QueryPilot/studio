import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentDataGrid } from "@/components/DataGrid";
import { MongoResultViewer } from "@/components/MongoQueryPanel/MongoResultViewer";
import { normalizeMongoResult } from "@/components/MongoQueryPanel/mongo-result-state";
import type { MongoResultViewMode } from "@/components/MongoQueryPanel/MongoQueryToolbar";
import { useGridPreferencesStore } from "@/components/DataGrid/stores/gridPreferencesStore";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type {
  DocumentFieldStat,
  DocumentSchemaSample,
  MongoCollectionMetadata,
  MongoExplainRequest,
  MongoExplainResult,
  MongoIndexInfo,
  MongoIndexOptions,
} from "@/adapters/types/mongodb";
import { parseDocumentFilter } from "@/utils/documentFilterParser";
import { useTabStateStore } from "@/stores/tabStateStore";
import useWorkbenchStore from "@/stores/workbenchStore";
import { useCrudStore } from "@/stores/crudStore";
import type { TabMetadata } from "@/types/workbench";
import type {
  CrudCommand,
  CrudCommandPayload,
  CrudCommandTarget,
  DocumentIndexCreatePayload,
  DocumentIndexDropPayload,
  DocumentValidationUpdatePayload,
  JsonValue,
} from "@/types/crud";
import {
  DEFAULT_MONGO_WORKBENCH_STATE,
  type MongoCollectionViewType,
  type MongoWorkbenchState,
} from "@/types/mongoWorkbench";

interface MongoCollectionWorkbenchProps {
  panelId: string;
  tabId: string;
  metadata: TabMetadata;
  focused?: boolean;
}

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

function perTabSortGridId(
  baseGridId: string,
  tabId: string,
  syncSort: boolean | undefined,
): string | undefined {
  return syncSort === false ? `${baseGridId}:::tab:::${tabId}` : undefined;
}

function coerceMongoViewType(value: unknown): MongoCollectionViewType {
  switch (value) {
    case "structure":
    case "indexes":
    case "aggregation":
    case "validation":
    case "explain":
      return value;
    case "data":
    default:
      return "data";
  }
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

function toJsonValue(value: unknown): JsonValue | undefined {
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

function normalizeIndexOptionsForCrud(
  options: MongoIndexOptions,
): Record<string, JsonValue> {
  const normalized = toJsonValue(options);
  return normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? normalized
    : {};
}

function buildMongoCommand<TPayload extends CrudCommandPayload>(
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

function getSortObject(
  sortColumns: Array<{ columnId: string; direction: "asc" | "desc" }>,
): Record<string, 1 | -1> | undefined {
  if (sortColumns.length === 0) {
    return undefined;
  }

  return sortColumns.reduce<Record<string, 1 | -1>>((acc, sort) => {
    acc[sort.columnId] = sort.direction === "desc" ? -1 : 1;
    return acc;
  }, {});
}

function getExplainSummary(
  result: MongoExplainResult | null,
): Array<{ label: string; value: string }> {
  if (!result || typeof result !== "object") {
    return [];
  }

  const record = result as Record<string, unknown>;
  const stats =
    record.executionStats && typeof record.executionStats === "object"
      ? (record.executionStats as Record<string, unknown>)
      : undefined;
  const planner =
    record.queryPlanner && typeof record.queryPlanner === "object"
      ? (record.queryPlanner as Record<string, unknown>)
      : undefined;
  const winningPlan =
    planner?.winningPlan && typeof planner.winningPlan === "object"
      ? (planner.winningPlan as Record<string, unknown>)
      : undefined;

  const summary: Array<{ label: string; value: string }> = [];
  if (typeof winningPlan?.stage === "string") {
    summary.push({ label: "Winning stage", value: winningPlan.stage });
  }
  if (typeof stats?.nReturned === "number") {
    summary.push({ label: "Returned", value: String(stats.nReturned) });
  }
  if (typeof stats?.totalDocsExamined === "number") {
    summary.push({
      label: "Docs examined",
      value: String(stats.totalDocsExamined),
    });
  }
  if (typeof stats?.totalKeysExamined === "number") {
    summary.push({
      label: "Keys examined",
      value: String(stats.totalKeysExamined),
    });
  }
  if (typeof stats?.executionTimeMillis === "number") {
    summary.push({
      label: "Execution ms",
      value: String(stats.executionTimeMillis),
    });
  }

  return summary;
}

function renderExplainNode(
  label: string,
  value: unknown,
  depth = 0,
): React.ReactNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const stage =
    typeof record.stage === "string"
      ? record.stage
      : typeof record.nodeType === "string"
        ? record.nodeType
        : label;
  const children = Object.entries(record).filter(([, childValue]) =>
    childValue && typeof childValue === "object",
  );

  return (
    <div
      key={`${label}-${depth}`}
      className="rounded border bg-background/60 p-2"
      style={{ marginLeft: depth * 12 }}
    >
      <div className="text-xs font-medium text-foreground">{stage}</div>
      {children.length > 0 ? (
        <div className="mt-2 space-y-2">
          {children.map(([childKey, childValue]) =>
            renderExplainNode(childKey, childValue, depth + 1),
          )}
        </div>
      ) : null}
    </div>
  );
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

const MongoStructureView = memo(function MongoStructureView({
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span>Sample size</span>
          <input
            type="number"
            min={50}
            max={5000}
            value={sampleSize}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureSampleSize: Number(event.target.value) || 500,
              });
            }}
            className="h-8 w-24 rounded border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span>Max depth</span>
          <input
            type="number"
            min={1}
            max={12}
            value={maxDepth}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureMaxDepth: Number(event.target.value) || 4,
              });
            }}
            className="h-8 w-20 rounded border bg-background px-2 text-sm"
          />
        </label>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {metadata ? (
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <div className="rounded border bg-muted/20 p-3">
            <div className="text-[11px] uppercase text-muted-foreground">
              Sampled docs
            </div>
            <div className="text-lg font-semibold">
              {sample ? sample.scannedCount.toLocaleString() : 0}
            </div>
          </div>
          <div className="rounded border bg-muted/20 p-3">
            <div className="text-[11px] uppercase text-muted-foreground">
              Fields
            </div>
            <div className="text-lg font-semibold">
              {sample ? sample.fields.length.toLocaleString() : 0}
            </div>
          </div>
          <div className="rounded border bg-muted/20 p-3">
            <div className="text-[11px] uppercase text-muted-foreground">
              Validator
            </div>
            <div className="text-sm font-medium">
              {metadata.validator ? "Attached" : "None"}
            </div>
          </div>
          <div className="rounded border bg-muted/20 p-3">
            <div className="text-[11px] uppercase text-muted-foreground">
              Collection docs
            </div>
            <div className="text-lg font-semibold">
              {metadata.stats?.count?.toLocaleString() ?? "n/a"}
            </div>
          </div>
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

const MongoIndexesView = memo(function MongoIndexesView({
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

      <div className="mb-4 grid gap-3 rounded border bg-muted/10 p-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Index name</span>
          <input
            value={indexName}
            onChange={(event) => {
              setIndexName(event.target.value);
            }}
            className="h-9 w-full rounded border bg-background px-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Primary field</span>
          <div className="flex gap-2">
            <input
              value={fieldName}
              onChange={(event) => {
                setFieldName(event.target.value);
              }}
              className="h-9 flex-1 rounded border bg-background px-2"
            />
            <select
              value={direction}
              onChange={(event) => {
                setDirection(event.target.value as "1" | "-1" | "text");
              }}
              className="h-9 rounded border bg-background px-2"
            >
              <option value="1">Asc</option>
              <option value="-1">Desc</option>
              <option value="text">Text</option>
            </select>
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span>Secondary field</span>
          <div className="flex gap-2">
            <input
              value={secondaryFieldName}
              onChange={(event) => {
                setSecondaryFieldName(event.target.value);
              }}
              className="h-9 flex-1 rounded border bg-background px-2"
            />
            <select
              value={secondaryDirection}
              onChange={(event) => {
                setSecondaryDirection(
                  event.target.value as "1" | "-1" | "text",
                );
              }}
              className="h-9 rounded border bg-background px-2"
            >
              <option value="1">Asc</option>
              <option value="-1">Desc</option>
              <option value="text">Text</option>
            </select>
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span>TTL seconds</span>
          <input
            type="number"
            min={0}
            value={expireAfterSeconds}
            onChange={(event) => {
              setExpireAfterSeconds(event.target.value);
            }}
            className="h-9 w-full rounded border bg-background px-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Default language</span>
          <input
            value={defaultLanguage}
            onChange={(event) => {
              setDefaultLanguage(event.target.value);
            }}
            className="h-9 w-full rounded border bg-background px-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Language override</span>
          <input
            value={languageOverride}
            onChange={(event) => {
              setLanguageOverride(event.target.value);
            }}
            className="h-9 w-full rounded border bg-background px-2"
          />
        </label>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unique}
              onChange={(event) => {
                setUnique(event.target.checked);
              }}
            />
            <span>Unique</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sparse}
              onChange={(event) => {
                setSparse(event.target.checked);
              }}
            />
            <span>Sparse</span>
          </label>
          <Button size="sm" onClick={stageCreate}>
            Stage Create
          </Button>
        </div>
      </div>

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
              <div key={index.name} className="rounded border bg-background/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-medium">{index.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {Object.entries(index.keys)
                        .map(([key, value]) => `${key}:${value}`)
                        .join(", ")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {index.unique ? <span>unique</span> : null}
                      {index.sparse ? <span>sparse</span> : null}
                      {typeof index.expireAfterSeconds === "number" ? (
                        <span>ttl {index.expireAfterSeconds}s</span>
                      ) : null}
                      {usageByName[index.name] !== undefined ? (
                        <span>usage {usageByName[index.name]}</span>
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
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

const MongoAggregationView = memo(function MongoAggregationView({
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
        <div className="space-y-2">
          <div className="text-sm font-semibold">Pipeline stages</div>
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
                  <textarea
                    value={stage}
                    onChange={(event) => {
                      const nextStages = [...stages];
                      nextStages[index] = event.target.value;
                      updateStages(nextStages);
                    }}
                    className="min-h-[132px] w-full rounded border bg-background p-2 font-mono text-xs"
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Combined pipeline</div>
          <pre className="min-h-[220px] overflow-auto rounded border bg-muted/20 p-3 text-xs">
            {parsed.ok
              ? JSON.stringify(parsed.pipeline, null, 2)
              : parsed.error}
          </pre>
          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden rounded border">
        <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
          <div className="text-sm font-semibold">Results</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={resultViewMode === "data" ? "secondary" : "outline"}
              onClick={() => {
                setResultViewMode("data");
              }}
            >
              Data
            </Button>
            <Button
              size="sm"
              variant={resultViewMode === "json" ? "secondary" : "outline"}
              onClick={() => {
                setResultViewMode("json");
              }}
            >
              JSON
            </Button>
          </div>
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

const MongoValidationView = memo(function MongoValidationView({
  target,
  workbenchState,
  onWorkbenchStateChange,
}: {
  target: CrudCommandTarget;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}) {
  const [metadata, setMetadata] = useState<MongoCollectionMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedFromMetadataRef = useRef(false);

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
      const nextMetadata = await adapter.getCollectionMetadata(
        target.table ?? "",
        target.database,
      );
      setMetadata(nextMetadata);

      if (!initializedFromMetadataRef.current && !workbenchState.validationJson) {
        onWorkbenchStateChange({
          validationJson: nextMetadata.validator
            ? JSON.stringify(nextMetadata.validator, null, 2)
            : "",
          validationLevel: nextMetadata.validationLevel ?? "strict",
          validationAction: nextMetadata.validationAction ?? "error",
        });
        initializedFromMetadataRef.current = true;
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [
    onWorkbenchStateChange,
    target.connectionId,
    target.database,
    target.table,
    workbenchState.validationJson,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const stagedValidation = stagedCommands.find(
    (command) => command.type === "document.validation.update",
  );

  const stageValidation = useCallback(() => {
    const hasValidationInput = typeof workbenchState.validationJson === "string";
    const trimmedValidation = workbenchState.validationJson?.trim() ?? "";

    const command = buildMongoCommand<DocumentValidationUpdatePayload>(
      "document.validation.update",
      target,
      {
        validationJson: trimmedValidation || undefined,
        clearValidator: hasValidationInput && trimmedValidation.length === 0,
        validationLevel: workbenchState.validationLevel,
        validationAction: workbenchState.validationAction,
      },
      `Update MongoDB validation for ${target.table}`,
      target.table,
    );
    stageCommand(command);
  }, [stageCommand, target, workbenchState.validationAction, workbenchState.validationJson, workbenchState.validationLevel]);

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Validation rules</h3>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="mb-3 text-sm text-muted-foreground">Loading validation…</div>
      ) : null}
      {error ? (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {metadata ? (
        <div className="mb-3 rounded border bg-muted/10 p-3 text-sm text-muted-foreground">
          Current validator: {metadata.validator ? "present" : "none"} | level{" "}
          {metadata.validationLevel ?? "n/a"} | action{" "}
          {metadata.validationAction ?? "n/a"}
        </div>
      ) : null}

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Validation level</span>
          <select
            value={workbenchState.validationLevel ?? "strict"}
            onChange={(event) => {
              onWorkbenchStateChange({
                validationLevel: event.target.value as MongoWorkbenchState["validationLevel"],
              });
            }}
            className="h-9 w-full rounded border bg-background px-2"
          >
            <option value="off">off</option>
            <option value="strict">strict</option>
            <option value="moderate">moderate</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Validation action</span>
          <select
            value={workbenchState.validationAction ?? "error"}
            onChange={(event) => {
              onWorkbenchStateChange({
                validationAction: event.target.value as MongoWorkbenchState["validationAction"],
              });
            }}
            className="h-9 w-full rounded border bg-background px-2"
          >
            <option value="error">error</option>
            <option value="warn">warn</option>
          </select>
        </label>
      </div>

      <label className="mb-3 block space-y-1 text-sm">
        <span>Validator JSON</span>
        <textarea
          value={workbenchState.validationJson ?? ""}
          onChange={(event) => {
            onWorkbenchStateChange({ validationJson: event.target.value });
          }}
          className="min-h-[260px] w-full rounded border bg-background p-3 font-mono text-xs"
          placeholder='{"$jsonSchema":{"bsonType":"object"}}'
        />
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={stageValidation}>
          Stage Validation Update
        </Button>
        {stagedValidation ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              unstageCommand(stagedValidation.id);
            }}
          >
            Unstage
          </Button>
        ) : null}
      </div>
    </div>
  );
});

const MongoExplainView = memo(function MongoExplainView({
  connectionId,
  database,
  collection,
  workbenchState,
  sortGridId,
}: {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  sortGridId: string;
}) {
  const [result, setResult] = useState<MongoExplainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sortColumns = useGridPreferencesStore(
    (state) => state.preferences[sortGridId]?.sortColumns ?? [],
  );

  const runExplain = useCallback(async () => {
    setLoading(true);
    setError(null);

    let request: MongoExplainRequest;
    if (workbenchState.explainSource === "aggregation") {
      const parsedPipeline = parseAggregationStages(
        workbenchState.aggregationStages ?? [],
      );
      if (!parsedPipeline.ok) {
        setLoading(false);
        setError(parsedPipeline.error);
        return;
      }
      request = {
        mode: "aggregate",
        pipeline: parsedPipeline.pipeline,
      };
    } else {
      const filterText = workbenchState.filterText?.trim() ?? "";
      let filter: Record<string, unknown> | undefined;
      if (filterText) {
        const parsedFilter = parseDocumentFilter(filterText);
        if (!parsedFilter.success) {
          setLoading(false);
          setError(parsedFilter.error || "Invalid filter");
          return;
        }
        if (parsedFilter.filter?.mode === "search") {
          setLoading(false);
          setError(
            "Search-mode filters run client-side only. Convert the Data tab filter to query mode to profile it.",
          );
          return;
        }
        filter = parsedFilter.filter?.mongoQuery;
      }

      request = {
        mode: "find",
        filter,
        sort: getSortObject(sortColumns),
      };
    }

    try {
      const adapter = new MongoDBAdapter(connectionId);
      const explain = await adapter.explainCollectionOperation(
        collection,
        request,
        database,
      );
      setResult(explain);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [
    collection,
    connectionId,
    database,
    sortColumns,
    workbenchState.aggregationStages,
    workbenchState.explainSource,
    workbenchState.filterText,
  ]);

  const summary = useMemo(() => getExplainSummary(result), [result]);
  const queryPlanner =
    result && typeof result === "object" && result.queryPlanner
      ? (result.queryPlanner as Record<string, unknown>)
      : undefined;
  const executionStages =
    result && typeof result === "object" && result.executionStats
      ? (result.executionStats as Record<string, unknown>).executionStages
      : undefined;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void runExplain()} disabled={loading}>
          {loading ? "Running…" : "Run Explain"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Source: {workbenchState.explainSource ?? "data"}
        </span>
      </div>

      {error ? (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {summary.length > 0 ? (
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label} className="rounded border bg-muted/20 p-3">
              <div className="text-[11px] uppercase text-muted-foreground">
                {item.label}
              </div>
              <div className="text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-semibold">Query planner</div>
          {queryPlanner ? (
            renderExplainNode("queryPlanner", queryPlanner)
          ) : (
            <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
              No planner tree available yet.
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-sm font-semibold">Execution stages</div>
          {executionStages ? (
            renderExplainNode("executionStages", executionStages)
          ) : (
            <div className="rounded border bg-muted/20 p-3 text-sm text-muted-foreground">
              No execution stage tree available.
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 text-sm font-semibold">Raw JSON</div>
        <pre className="overflow-auto rounded border bg-muted/20 p-3 text-xs">
          {result ? JSON.stringify(result, null, 2) : "Run explain to inspect the raw response."}
        </pre>
      </div>
    </div>
  );
});

export const MongoCollectionWorkbench = memo(function MongoCollectionWorkbench({
  panelId,
  tabId,
  metadata,
  focused,
}: MongoCollectionWorkbenchProps) {
  const connectionId =
    typeof metadata.connectionId === "string" ? metadata.connectionId : "";
  const database = typeof metadata.database === "string" ? metadata.database : "";
  const collection = typeof metadata.table === "string" ? metadata.table : "";
  const sortGridId = perTabSortGridId(
    `document:${connectionId}:${database}:${collection}`,
    tabId,
    metadata.syncSort,
  ) ?? `document:${connectionId}:${database}:${collection}`;

  const updateTabMetadata = useWorkbenchStore((state) => state.updateTabMetadata);
  const loadTabStateAsync = useTabStateStore((state) => state.loadTabStateAsync);
  const setQueryState = useTabStateStore((state) => state.setQueryState);
  const persistedState = useTabStateStore(
    (state) => state.queryStates.get(tabId),
  );

  useEffect(() => {
    void loadTabStateAsync(tabId);
  }, [loadTabStateAsync, tabId]);

  const activeView = useMemo<MongoCollectionViewType>(
    () => coerceMongoViewType(metadata.viewType ?? persistedState?.tableViewType),
    [metadata.viewType, persistedState?.tableViewType],
  );

  const handleActiveViewChange = useCallback(
    (value: string) => {
      const nextView = coerceMongoViewType(value);
      if (metadata.viewType !== nextView) {
        updateTabMetadata(panelId, tabId, { viewType: nextView });
      }
      if (persistedState?.tableViewType !== nextView) {
        setQueryState(tabId, { tableViewType: nextView });
      }
    },
    [
      metadata.viewType,
      panelId,
      persistedState?.tableViewType,
      setQueryState,
      tabId,
      updateTabMetadata,
    ],
  );

  const workbenchState = useMemo<MongoWorkbenchState>(
    () => ({
      ...DEFAULT_MONGO_WORKBENCH_STATE,
      ...(persistedState?.mongoWorkbench ?? {}),
    }),
    [persistedState?.mongoWorkbench],
  );

  const updateWorkbenchState = useCallback(
    (updates: Partial<MongoWorkbenchState>) => {
      setQueryState(tabId, {
        mongoWorkbench: {
          ...workbenchState,
          ...updates,
        },
      });
    },
    [setQueryState, tabId, workbenchState],
  );

  const openExplainView = useCallback(() => {
    updateWorkbenchState({ explainSource: "aggregation" });
    handleActiveViewChange("explain");
  }, [handleActiveViewChange, updateWorkbenchState]);

  const target = useMemo<CrudCommandTarget>(
    () => ({
      connectionId,
      database,
      table: collection,
    }),
    [collection, connectionId, database],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b bg-background px-1 py-1.5">
        <div className="flex items-center justify-between">
          <Tabs
            value={activeView}
            onValueChange={handleActiveViewChange}
            enableShortcuts={true}
            tabGroupId={`mongo-views-${tabId}`}
            focused={focused}
          >
            <TabsList>
              <TabsTrigger value="data" tabIndex={0}>
                Data
              </TabsTrigger>
              <TabsTrigger value="structure" tabIndex={1}>
                Structure
              </TabsTrigger>
              <TabsTrigger value="indexes" tabIndex={2}>
                Indexes
              </TabsTrigger>
              <TabsTrigger value="aggregation" tabIndex={3}>
                Aggregation
              </TabsTrigger>
              <TabsTrigger value="validation" tabIndex={4}>
                Validation
              </TabsTrigger>
              <TabsTrigger value="explain" tabIndex={5}>
                Explain
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {activeView === "explain" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Source</span>
              <select
                value={workbenchState.explainSource ?? "data"}
                onChange={(event) => {
                  updateWorkbenchState({
                    explainSource: event.target.value as MongoWorkbenchState["explainSource"],
                  });
                }}
                className="h-8 rounded border bg-background px-2 text-xs"
              >
                <option value="data">Current Data Query</option>
                <option value="aggregation">Aggregation Draft</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeView === "data" ? (
          <DocumentDataGrid
            key={`${tabId}:${workbenchState.filterText ?? ""}`}
            gridId={`document:${connectionId}:${database}:${collection}`}
            connectionId={connectionId}
            database={database}
            collection={collection}
            className="h-full"
            focused={focused}
            sortGridId={perTabSortGridId(
              `document:${connectionId}:${database}:${collection}`,
              tabId,
              metadata.syncSort,
            )}
            initialFilterText={workbenchState.filterText}
            onAppliedFilterChange={(state) => {
              updateWorkbenchState({ filterText: state.text });
            }}
          />
        ) : null}

        {activeView === "structure" ? (
          <MongoStructureView
            connectionId={connectionId}
            database={database}
            collection={collection}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
          />
        ) : null}

        {activeView === "indexes" ? (
          <MongoIndexesView target={target} />
        ) : null}

        {activeView === "aggregation" ? (
          <MongoAggregationView
            connectionId={connectionId}
            database={database}
            collection={collection}
            tabId={tabId}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
            onOpenExplain={openExplainView}
          />
        ) : null}

        {activeView === "validation" ? (
          <MongoValidationView
            target={target}
            workbenchState={workbenchState}
            onWorkbenchStateChange={updateWorkbenchState}
          />
        ) : null}

        {activeView === "explain" ? (
          <MongoExplainView
            connectionId={connectionId}
            database={database}
            collection={collection}
            workbenchState={workbenchState}
            sortGridId={sortGridId}
          />
        ) : null}
      </div>
    </div>
  );
});

export default MongoCollectionWorkbench;
