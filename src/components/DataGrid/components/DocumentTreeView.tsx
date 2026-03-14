/**
 * DocumentTreeView - Expandable tree view for MongoDB documents
 *
 * Renders documents as collapsible cards with BSON type color coding.
 * Nested objects and arrays are rendered as expandable sub-trees.
 *
 * Features:
 * - Theme-aware design system colors (Tailwind classes, no hardcoded hex)
 * - Virtualized document cards via @tanstack/react-virtual
 * - Infinite scroll (load more) support
 * - Inline editing for leaf values and structured JSON editing for objects/arrays
 */

import {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import {
  IconChevronRight,
  IconChevronDown,
  IconPencil,
  IconCheck,
  IconX,
  IconLoader2,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CodeMirror from "@uiw/react-codemirror";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { JSON_EXTENSIONS } from "@/components/shared/codemirrorJsonExtensions";

// ============================================================================
// Types
// ============================================================================

export interface DocumentTreeViewProps {
  documents: Record<string, unknown>[];
  className?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onFieldEdit?: (
    docIndex: number,
    fieldPath: string,
    newValue: unknown,
  ) => void;
  editable?: boolean;
}

// ============================================================================
// BSON type detection & Tailwind classes
// ============================================================================

type BsonColorType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array"
  | "objectId";

/** Theme-aware Tailwind classes for each BSON type */
const BSON_TEXT_CLASSES: Record<BsonColorType, string> = {
  string: "text-emerald-600 dark:text-emerald-400/80",
  number: "text-blue-600 dark:text-blue-400/80",
  boolean: "text-rose-600 dark:text-rose-400/80",
  null: "text-muted-foreground",
  object: "text-orange-600 dark:text-orange-400/70",
  array: "text-amber-600 dark:text-amber-400/70",
  objectId: "text-violet-600 dark:text-violet-400/80",
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
  return typeof value === "object"
    ? JSON.stringify(value)
    : String(value as string | number | boolean);
}

function truncateId(value: unknown): string {
  const id = formatObjectId(value);
  if (id.length > 12) return `${id.slice(0, 12)}...`;
  return id;
}

/** Convert a raw string back to a typed value based on the detected BSON type */
function parseEditedValue(raw: string, type: BsonColorType): unknown {
  if (type === "null") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "null" || trimmed === "") return null;
  }
  if (type === "boolean") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return raw;
  }
  if (type === "number") {
    const num = Number(raw);
    if (!Number.isNaN(num)) return num;
    return raw;
  }
  // string and objectId stay as strings
  return raw;
}

/** Format a value for display in an edit input */
function valueToEditString(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

// ============================================================================
// Inline Edit Component
// ============================================================================

interface InlineEditProps {
  value: unknown;
  type: BsonColorType;
  onSave: (newValue: unknown) => void;
  onCancel: () => void;
}

const InlineEdit = memo(function InlineEdit({
  value,
  type,
  onSave,
  onCancel,
}: InlineEditProps) {
  const isStructured = type === "object" || type === "array";

  if (isStructured) {
    return (
      <InlineJsonEdit value={value} onSave={onSave} onCancel={onCancel} />
    );
  }

  return (
    <InlinePrimitiveEdit
      value={value}
      type={type}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
});

/** Inline editor for primitive values (string, number, boolean, null, objectId) */
const InlinePrimitiveEdit = memo(function InlinePrimitiveEdit({
  value,
  type,
  onSave,
  onCancel,
}: InlineEditProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => valueToEditString(value));

  const save = useCallback(() => {
    const parsed = parseEditedValue(draft, type);
    onSave(parsed);
  }, [draft, onSave, type]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [save, onCancel],
  );

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={save}
        className="h-5 text-xs font-mono px-1 py-0 inline w-auto min-w-[100px] max-w-[300px]"
      />
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          save();
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <IconCheck className="size-3" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <IconX className="size-3" />
      </button>
    </span>
  );
});

/** Inline editor for object/array values using CodeMirror JSON */
const InlineJsonEdit = memo(function InlineJsonEdit({
  value,
  onSave,
  onCancel,
}: Omit<InlineEditProps, "type">) {
  const { resolvedTheme } = useTheme();
  const themeMode = resolvedTheme === "dark" ? "dark" : "light";
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...getThemeExtensions(themeMode)],
    [themeMode],
  );

  const save = useCallback(() => {
    try {
      const parsed: unknown = JSON.parse(draft);
      onSave(parsed);
    } catch {
      // Invalid JSON — don't save
    }
  }, [draft, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [save, onCancel],
  );

  return (
    <div className="mt-1 mb-1" onKeyDown={handleKeyDown}>
      <div className="border border-border rounded overflow-hidden">
        <CodeMirror
          value={draft}
          onChange={setDraft}
          extensions={extensions}
          basicSetup={false}
          height="120px"
          autoFocus
        />
      </div>
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          onClick={save}
          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted"
        >
          Save (Cmd+Enter)
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted"
        >
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// Sub-components
// ============================================================================

interface TreeValueNodeProps {
  fieldKey: string;
  value: unknown;
  depth: number;
  fieldPath: string;
  editable: boolean;
  onFieldEdit?: (fieldPath: string, newValue: unknown) => void;
}

/** Renders a single key-value pair within the tree */
const TreeValueNode = memo(function TreeValueNode({
  fieldKey,
  value,
  depth,
  fieldPath,
  editable,
  onFieldEdit,
}: TreeValueNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const type = detectBsonType(value);
  const colorClass = BSON_TEXT_CLASSES[type];
  const isExpandable = type === "object" || type === "array";

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleSave = useCallback(
    (newValue: unknown) => {
      onFieldEdit?.(fieldPath, newValue);
      setEditing(false);
    },
    [fieldPath, onFieldEdit],
  );

  const handleCancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (isExpandable) {
    const entries =
      type === "array"
        ? (value as unknown[]).map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);

    return (
      <div
        className="select-text group/node"
        style={{ paddingLeft: depth > 0 ? 16 : 0 }}
      >
        <div className="flex items-center gap-1 py-0.5 hover:bg-muted/30 rounded">
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex items-center gap-1 flex-1 text-left min-w-0"
          >
            {expanded ? (
              <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <IconChevronRight className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="font-mono text-[11px] text-foreground/80 shrink-0">
              {fieldKey}
            </span>
            <span className="text-[10px] text-muted-foreground/60 shrink-0">
              {type}
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0">
              :
            </span>
            {!expanded && (
              <span className={cn("font-mono text-[11px] truncate", colorClass)}>
                {formatValuePreview(value)}
              </span>
            )}
          </button>
          {editable && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              className="opacity-0 group-hover/node:opacity-100 text-muted-foreground hover:text-foreground p-0.5 shrink-0 transition-opacity"
            >
              <IconPencil className="size-3" />
            </button>
          )}
        </div>
        {editing && (
          <div style={{ paddingLeft: 16 }}>
            <InlineEdit
              value={value}
              type={type}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </div>
        )}
        {expanded && !editing && (
          <div className="border-l border-border/30 ml-1.5">
            {entries.map(([k, v]) => (
              <TreeValueNode
                key={k}
                fieldKey={k}
                value={v}
                depth={depth + 1}
                fieldPath={`${fieldPath}.${k}`}
                editable={editable}
                onFieldEdit={onFieldEdit}
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
      className="flex items-baseline gap-1 py-0.5 select-text group/leaf"
      style={{ paddingLeft: depth > 0 ? 16 : 0 }}
    >
      <span className="ml-4 font-mono text-[11px] text-foreground/80 shrink-0">
        {fieldKey}
      </span>
      <span className="text-[10px] text-muted-foreground/60 shrink-0">
        {type}
      </span>
      <span className="text-[11px] text-muted-foreground">:</span>
      {editing ? (
        <InlineEdit
          value={value}
          type={type}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : (
        <>
          <span className={cn("font-mono text-[11px] truncate", colorClass)}>
            {type === "objectId"
              ? `ObjectId("${formatObjectId(value)}")`
              : formatValuePreview(value)}
          </span>
          {editable && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              className="opacity-0 group-hover/leaf:opacity-100 text-muted-foreground hover:text-foreground p-0.5 shrink-0 transition-opacity"
            >
              <IconPencil className="size-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
});

// ============================================================================
// Document Card
// ============================================================================

interface DocumentCardProps {
  document: Record<string, unknown>;
  index: number;
  editable: boolean;
  onFieldEdit?: (fieldPath: string, newValue: unknown) => void;
}

/** A single document card */
const DocumentCard = memo(function DocumentCard({
  document,
  index,
  editable,
  onFieldEdit,
}: DocumentCardProps) {
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
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground overflow-hidden transition-colors",
        expanded
          ? "border-border bg-muted/10"
          : "border-border/50 hover:border-border",
      )}
    >
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
          className={cn(
            "font-mono text-xs font-medium shrink-0",
            BSON_TEXT_CLASSES.objectId,
          )}
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
        <div className="border-t border-border/50 px-3 py-2">
          {entries.map(([key, value]) => (
            <TreeValueNode
              key={key}
              fieldKey={key}
              value={value}
              depth={0}
              fieldPath={key}
              editable={editable}
              onFieldEdit={onFieldEdit}
            />
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
  hasMore,
  isLoadingMore,
  onLoadMore,
  onFieldEdit,
  editable = false,
}: DocumentTreeViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 8,
    getItemKey: (index) => {
      const doc = documents[index];
      return doc?._id ? formatObjectId(doc._id) : `doc-${index}`;
    },
  });

  // Infinite scroll: load more when scrolling near the bottom
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    const lastItem = virtualItems.at(-1);
    if (lastItem && lastItem.index >= documents.length - 5) {
      onLoadMore();
    }
  }, [virtualItems, hasMore, isLoadingMore, onLoadMore, documents.length]);

  // Memoize per-document edit handlers so cards don't re-render unnecessarily
  const makeFieldEditHandler = useCallback(
    (docIndex: number) => {
      if (!onFieldEdit) return undefined;
      return (fieldPath: string, newValue: unknown) => {
        onFieldEdit(docIndex, fieldPath, newValue);
      };
    },
    [onFieldEdit],
  );

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
    <div
      ref={parentRef}
      className={cn("overflow-auto h-full", className)}
      style={{ contain: "strict" }}
    >
      <div
        className="p-2"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const doc = documents[virtualRow.index];
          if (!doc) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                paddingBottom: "6px",
              }}
            >
              <DocumentCard
                document={doc}
                index={virtualRow.index}
                editable={editable}
                onFieldEdit={makeFieldEditHandler(virtualRow.index)}
              />
            </div>
          );
        })}
      </div>

      {/* Loading indicator for infinite scroll */}
      {isLoadingMore && (
        <div className="flex items-center justify-center py-3 text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin mr-2" />
          <span className="text-xs">Loading more documents...</span>
        </div>
      )}
    </div>
  );
});
