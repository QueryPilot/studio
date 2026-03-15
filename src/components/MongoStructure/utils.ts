import type {
  DocumentFieldStat,
  DocumentSchemaSample,
  MongoCollectionMetadata,
} from "@/adapters/types/mongodb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValidatorOverlay = {
  required?: boolean;
  bsonType?: string | string[];
};

export type SchemaTreeNode = {
  key: string;
  path: string;
  label: string;
  children: SchemaTreeNode[];
  field?: DocumentFieldStat;
  overlay?: ValidatorOverlay;
};

export interface SchemaRow {
  id: string;
  field: string;
  path: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  node: SchemaTreeNode;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function normalizeSamplePath(path: string): string {
  return path
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "[]" : segment))
    .join(".");
}

export function formatPercent(value: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export function formatTypes(
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

export function formatSampleValues(values: unknown[] | undefined): string {
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

// ---------------------------------------------------------------------------
// Validator overlay
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Schema tree building
// ---------------------------------------------------------------------------

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

export function buildSchemaTree(
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

// ---------------------------------------------------------------------------
// Flatten tree for DataGrid consumption
// ---------------------------------------------------------------------------

export function flattenSchemaTree(
  root: SchemaTreeNode,
  expandedPaths: Set<string>,
): SchemaRow[] {
  const rows: SchemaRow[] = [];

  function visit(node: SchemaTreeNode, depth: number): void {
    if (node.path) {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedPaths.has(node.path);
      rows.push({
        id: node.path,
        field: node.label,
        path: node.path,
        depth,
        hasChildren,
        isExpanded,
        node,
      });
      if (!isExpanded) return;
    }
    for (const child of node.children) {
      visit(child, node.path ? depth + 1 : depth);
    }
  }

  visit(root, 0);
  return rows;
}

// ---------------------------------------------------------------------------
// BSON type color mapping for distribution bars
// ---------------------------------------------------------------------------

export const BSON_TYPE_COLORS: Record<string, string> = {
  string: "#4ade80",
  int: "#60a5fa",
  int32: "#60a5fa",
  double: "#60a5fa",
  long: "#60a5fa",
  decimal: "#60a5fa",
  objectId: "#a78bfa",
  object: "#f97316",
  array: "#fbbf24",
  bool: "#f87171",
  boolean: "#f87171",
  date: "#ec4899",
  timestamp: "#ec4899",
  null: "#888888",
  binData: "#888888",
  regex: "#888888",
};
