/**
 * DocumentTreeView - Expandable tree view for MongoDB documents
 *
 * Renders documents as collapsible cards with BSON type color coding.
 * Nested objects and arrays are rendered as expandable sub-trees.
 */

import { memo, useState, useCallback } from "react";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface DocumentTreeViewProps {
  documents: Record<string, unknown>[];
  className?: string;
}

// ============================================================================
// BSON type color coding
// ============================================================================

type BsonColorType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array"
  | "objectId";

const BSON_COLORS: Record<BsonColorType, string> = {
  string: "#4ade80",
  number: "#60a5fa",
  boolean: "#f87171",
  null: "#888888",
  object: "#f97316",
  array: "#fbbf24",
  objectId: "#a78bfa",
};

function detectBsonType(value: unknown): BsonColorType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    // ObjectId-like: 24-char hex string
    if (/^[a-fA-F0-9]{24}$/.test(value)) return "objectId";
    return "string";
  }
  if (typeof value === "object") {
    // Check for MongoDB extended JSON ObjectId format
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj && typeof obj.$oid === "string") return "objectId";
    return "object";
  }
  return "string";
}

function getTypeColor(type: BsonColorType): string {
  return BSON_COLORS[type];
}

// ============================================================================
// Value formatting
// ============================================================================

function formatObjectId(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "$oid" in (value as Record<string, unknown>)
  ) {
    return String((value as Record<string, unknown>).$oid);
  }
  return JSON.stringify(value);
}

function formatValuePreview(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if ("$oid" in (value as Record<string, unknown>)) {
      const oid = formatObjectId(value);
      return `ObjectId("${oid}")`;
    }
    return `{${keys.length} fields}`;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | number | boolean);
}

function truncateId(value: unknown): string {
  const id = formatObjectId(value);
  if (id.length > 12) return `${id.slice(0, 12)}...`;
  return id;
}

// ============================================================================
// Sub-components
// ============================================================================

/** Renders a single key-value pair within the tree */
const TreeValueNode = memo(function TreeValueNode({
  fieldKey,
  value,
  depth,
}: {
  fieldKey: string;
  value: unknown;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const type = detectBsonType(value);
  const color = getTypeColor(type);
  const isExpandable = type === "object" || type === "array";

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (isExpandable) {
    const entries =
      type === "array"
        ? (value as unknown[]).map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);

    return (
      <div className="select-text" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex items-center gap-1 py-0.5 hover:bg-muted/50 rounded w-full text-left"
        >
          {expanded ? (
            <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="font-mono text-[11px] text-foreground/80">
            {fieldKey}
          </span>
          <span className="text-[11px] text-muted-foreground">:</span>
          {!expanded && (
            <span
              className="font-mono text-[11px] truncate"
              style={{ color }}
            >
              {formatValuePreview(value)}
            </span>
          )}
        </button>
        {expanded && (
          <div className="border-l border-border/40 ml-1.5">
            {entries.map(([k, v]) => (
              <TreeValueNode
                key={k}
                fieldKey={k}
                value={v}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Leaf node
  return (
    <div
      className="flex items-baseline gap-1 py-0.5 select-text"
      style={{ paddingLeft: depth > 0 ? 16 : 0 }}
    >
      <span className="ml-4 font-mono text-[11px] text-foreground/80 shrink-0">
        {fieldKey}
      </span>
      <span className="text-[11px] text-muted-foreground">:</span>
      <span className="font-mono text-[11px] truncate" style={{ color }}>
        {type === "objectId"
          ? `ObjectId("${formatObjectId(value)}")`
          : formatValuePreview(value)}
      </span>
    </div>
  );
});

/** A single document card */
const DocumentCard = memo(function DocumentCard({
  document,
  index,
}: {
  document: Record<string, unknown>;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const idValue = document._id;
  const displayId = idValue ? truncateId(idValue) : `Doc ${index + 1}`;

  const entries = Object.entries(document);

  // One-line preview: show top-level field names and abbreviated values
  const previewText = entries
    .slice(0, 6)
    .map(([key, val]) => `${key}: ${formatValuePreview(val)}`)
    .join(", ");

  return (
    <div className="rounded-lg border bg-card text-card-foreground ring-1 ring-foreground/5 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className="font-mono text-xs font-medium shrink-0"
          style={{ color: BSON_COLORS.objectId }}
        >
          {displayId}
        </span>
        {!expanded && (
          <span className="font-mono text-[11px] text-muted-foreground truncate">
            {previewText}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-3 py-2">
          {entries.map(([key, value]) => (
            <TreeValueNode key={key} fieldKey={key} value={value} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const DocumentTreeView = memo(function DocumentTreeView({
  documents,
  className,
}: DocumentTreeViewProps) {
  if (documents.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground",
          className,
        )}
      >
        No documents to display
      </div>
    );
  }

  return (
    <div className={cn("overflow-auto p-2 space-y-1.5", className)}>
      {documents.map((doc, index) => (
        <DocumentCard
          key={
            doc._id
              ? formatObjectId(doc._id)
              : `doc-${String(index)}`
          }
          document={doc}
          index={index}
        />
      ))}
    </div>
  );
});
