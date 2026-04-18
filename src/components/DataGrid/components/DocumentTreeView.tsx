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
  createContext,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  IconChevronRight,
  IconPencil,
  IconCheck,
  IconX,
  IconLoader2,
  IconRefresh,
  IconCopy,
  IconCode,
  IconArrowBackUp,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CodeMirror from "@uiw/react-codemirror";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { writeClipboardText } from "@/lib/clipboard";
import { useTheme } from "@/components/theme-provider";
import { getThemeExtensions } from "@/components/CodeEditor/themes";
import { JSON_EXTENSIONS } from "@/components/shared/codemirrorJsonExtensions";

// ============================================================================
// Types
// ============================================================================

export interface DocumentTreeViewProps {
  documents: Record<string, unknown>[];
  className?: string;
  /** Grid ID for persisting expand state across tab switches (session storage) */
  gridId?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Unstage all pending edits for a document by index */
  onDocumentUndo?: (docIndex: number) => void;
  /** Insert a new document (receives the full document to insert) */
  onInsertDocument?: (doc: Record<string, unknown>) => void;
  /** Delete a document by index */
  onDeleteDocument?: (docIndex: number) => void;
  /** Set of document IDs (string) that have staged edits */
  stagedDocIds?: Set<string>;
  /** Field names to use as row identifier in card headers (e.g. PK columns for SQL) */
  identifierFields?: string[];
  onFieldEdit?: (
    docIndex: number,
    fieldPath: string,
    newValue: unknown,
  ) => void;
  editable?: boolean;
  /** Callback to get expand/collapse all handlers for external UI (status bar) */
  onExpandCollapseRef?: React.MutableRefObject<{
    expandAll: () => void;
    collapseAll: () => void;
  } | null>;
  /** Allow adding/removing fields via JSON editor. False for SQL (fixed schema). Default: true */
  allowStructuralEdits?: boolean;
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
  return String(value);
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
// Expanded Paths Store (granular subscriptions via useSyncExternalStore)
// ============================================================================

interface ExpandedPathsStore {
  subscribe: (listener: () => void) => () => void;
  has: (path: string) => boolean;
  toggle: (path: string) => void;
  expandAll: (paths: string[]) => void;
  collapseAll: () => void;
  getAll: () => Set<string>;
  getVersion: () => number;
}

function createExpandedPathsStore(initial?: Set<string>): ExpandedPathsStore {
  let paths = initial ?? new Set<string>();
  let version = 0;
  const listeners = new Set<() => void>();

  function emit() {
    version++;
    for (const l of listeners) l();
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has: (path) => paths.has(path),
    toggle: (path) => {
      const next = new Set(paths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      paths = next;
      emit();
    },
    expandAll: (newPaths) => {
      paths = new Set([...paths, ...newPaths]);
      emit();
    },
    collapseAll: () => {
      paths = new Set();
      emit();
    },
    getAll: () => paths,
    getVersion: () => version,
  };
}

/** Hook for granular subscription — only re-renders when THIS path's expanded state changes */
function useIsExpanded(store: ExpandedPathsStore, path: string): boolean {
  const subscribe = store.subscribe;
  const getSnapshot = useCallback(() => store.has(path), [store, path]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const ExpandStoreContext = createContext<ExpandedPathsStore | null>(null);

function useExpandStore(): ExpandedPathsStore {
  const store = useContext(ExpandStoreContext);
  if (!store)
    throw new Error("useExpandStore must be used within ExpandStoreContext");
  return store;
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

/** Build a template document from an existing document, replacing values with defaults */
function buildInsertTemplate(
  sample: Record<string, unknown> | undefined,
  isDocument: boolean,
): Record<string, unknown> {
  const doc: Record<string, unknown> = isDocument
    ? { _id: generateObjectId() }
    : {};
  if (!sample) return doc;

  for (const [key, value] of Object.entries(sample)) {
    if (key === "_id") continue;
    doc[key] = getDefaultValue(value);
  }
  return doc;
}

function getDefaultValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return "";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return [];
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return generateObjectId();
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = getDefaultValue(v);
    }
    return result;
  }
  return null;
}

/** Generate a random MongoDB-style ObjectId (24-char hex) */
function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0");
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return timestamp + random;
}

/** Inline editor for ObjectId values — input + generate button */
const InlineObjectIdEdit = memo(function InlineObjectIdEdit({
  value,
  onSave,
  onCancel,
}: Omit<InlineEditProps, "type">) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const raw = formatObjectId(value);
  const [draft, setDraft] = useState(raw);

  const save = useCallback(() => {
    if (cancelledRef.current) return;
    const trimmed = draft.trim();
    if (trimmed === raw) {
      onCancel();
      return;
    }
    if (/^[a-fA-F0-9]{24}$/.test(trimmed)) {
      onSave(trimmed);
    } else {
      // Invalid ObjectId — cancel instead of trapping user in edit mode (#5 fix)
      onCancel();
    }
  }, [draft, raw, onSave, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelledRef.current = true;
        onCancel();
      }
    },
    [save, onCancel],
  );

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const isValid = /^[a-fA-F0-9]{24}$/.test(draft.trim());

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
        className={cn(
          "h-5 text-xs font-mono px-1 py-0 inline w-[220px]",
          !isValid && draft.trim() && "border-destructive/50",
        )}
        maxLength={24}
        placeholder="24-char hex ObjectId"
      />
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          const newId = generateObjectId();
          setDraft(newId);
          onSave(newId);
        }}
        className="text-muted-foreground hover:text-foreground p-0.5"
        title="Generate new ObjectId"
      >
        <IconRefresh className="size-3" />
      </button>
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

const InlineEdit = memo(function InlineEdit({
  value,
  type,
  onSave,
  onCancel,
}: InlineEditProps) {
  const isStructured = type === "object" || type === "array";

  if (isStructured) {
    return <InlineJsonEdit value={value} onSave={onSave} onCancel={onCancel} />;
  }

  if (type === "objectId") {
    return (
      <InlineObjectIdEdit value={value} onSave={onSave} onCancel={onCancel} />
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
  const cancelledRef = useRef(false);
  const [draft, setDraft] = useState(() => valueToEditString(value));
  const originalStr = valueToEditString(value);

  const save = useCallback(() => {
    if (cancelledRef.current) return;
    // Only stage if value actually changed
    if (draft === originalStr) {
      onCancel();
      return;
    }
    const parsed = parseEditedValue(draft, type);
    onSave(parsed);
  }, [draft, originalStr, onSave, onCancel, type]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelledRef.current = true;
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
  const [error, setError] = useState<string | null>(null);

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...getThemeExtensions(themeMode)],
    [themeMode],
  );

  // Auto-size editor height based on content lines (min 80px, max 320px)
  const editorHeight = useMemo(() => {
    const lineCount = draft.split("\n").length;
    const lineHeight = 18; // approximate px per line
    const padding = 12;
    return `${Math.min(Math.max(lineCount * lineHeight + padding, 80), 320)}px`;
  }, [draft]);

  const save = useCallback(() => {
    try {
      const parsed: unknown = JSON.parse(draft);
      setError(null);
      onSave(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
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
          key={themeMode}
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (error) setError(null);
          }}
          extensions={extensions}
          theme="none"
          basicSetup={false}
          height={editorHeight}
          autoFocus
        />
      </div>
      {error && <div className="text-xs text-destructive mt-1">{error}</div>}
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          onClick={save}
          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted"
        >
          Save (Cmd+Enter)
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted"
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
  expandKeyPrefix: string;
  editable: boolean;
  onFieldEdit?: (fieldPath: string, newValue: unknown) => void;
}

/** Renders a single key-value pair within the tree */
const TreeValueNode = memo(function TreeValueNode({
  fieldKey,
  value,
  depth,
  fieldPath,
  expandKeyPrefix,
  editable,
  onFieldEdit,
}: TreeValueNodeProps) {
  const store = useExpandStore();
  // expandKey is used for expand/collapse state (scoped per document)
  // fieldPath is the actual dotted path used for edits (e.g. "address.city")
  const expandKey = `${expandKeyPrefix}:${fieldPath}`;
  const expanded = useIsExpanded(store, expandKey);
  const [editing, setEditing] = useState(false);
  const type = detectBsonType(value);
  const colorClass = BSON_TEXT_CLASSES[type];
  const isExpandable = type === "object" || type === "array";

  const toggleExpanded = useCallback(() => {
    store.toggle(expandKey);
  }, [expandKey, store]);

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

  const handleCopyValue = useCallback(() => {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    writeClipboardText(text).catch(() => {});
  }, [value]);

  if (isExpandable) {
    const entries =
      type === "array"
        ? (value as unknown[]).map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);

    return (
      <div className="select-text" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <ContextMenu>
          <ContextMenuTrigger
            className="flex items-center gap-1 py-0.5 rounded hover:bg-muted/30 group/node"
            onContextMenu={(e: React.MouseEvent) => {
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={toggleExpanded}
              className="flex items-center gap-1 flex-1 text-left min-w-0"
            >
              <IconChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-90",
                )}
              />
              <span className="font-mono text-xs text-foreground/80 shrink-0">
                {fieldKey}
              </span>
              <span className="text-[11px] text-muted-foreground/60 shrink-0">
                {type}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                :
              </span>
              {!expanded && (
                <span
                  className={cn("font-mono text-xs truncate min-w-0", colorClass)}
                >
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
                className="opacity-0 group-hover/node:opacity-100 text-muted-foreground hover:text-foreground p-0.5 shrink-0"
              >
                <IconPencil className="size-3.5" />
              </button>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={handleCopyValue}>
              <IconCopy className="size-3.5" />
              Copy Value
            </ContextMenuItem>
            {editable && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  <IconCode className="size-3.5" />
                  Edit as JSON
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
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
                expandKeyPrefix={expandKeyPrefix}
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
    <ContextMenu>
      <ContextMenuTrigger
        className="flex items-baseline gap-1 py-0.5 select-text group/leaf"
        style={{ paddingLeft: depth > 0 ? 16 : 0 }}
        onContextMenu={(e: React.MouseEvent) => {
          e.stopPropagation();
        }}
      >
        <span className="ml-5 font-mono text-xs text-foreground/80 shrink-0">
          {fieldKey}
        </span>
        <span className="text-[11px] text-muted-foreground/60 shrink-0">
          {type}
        </span>
        <span className="text-xs text-muted-foreground">:</span>
        {editing ? (
          <InlineEdit
            value={value}
            type={type}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <>
            <span
              className={cn(
                "font-mono text-xs min-w-0 flex-1 whitespace-pre-wrap break-words",
                colorClass,
              )}
            >
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
                className="opacity-0 group-hover/leaf:opacity-100 text-muted-foreground hover:text-foreground p-0.5 shrink-0"
              >
                <IconPencil className="size-3.5" />
              </button>
            )}
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleCopyValue}>
          <IconCopy className="size-3.5" />
          Copy Value
        </ContextMenuItem>
        {editable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                setEditing(true);
              }}
            >
              <IconPencil className="size-3.5" />
              Edit
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

// ============================================================================
// Document Card
// ============================================================================

interface DocumentCardProps {
  document: Record<string, unknown>;
  index: number;
  editable: boolean;
  hasStagedEdits: boolean;
  identifierFields?: string[];
  allowStructuralEdits: boolean;
  onFieldEdit?: (
    docIndex: number,
    fieldPath: string,
    newValue: unknown,
  ) => void;
  onDocumentUndo?: (docIndex: number) => void;
  onDeleteDocument?: (docIndex: number) => void;
  onOpenInsertEditor?: () => void;
  docKey: string;
}

/** A single document card */
const DocumentCard = memo(function DocumentCard({
  document,
  index,
  editable,
  hasStagedEdits,
  identifierFields,
  allowStructuralEdits,
  onFieldEdit,
  onDocumentUndo,
  onDeleteDocument,
  onOpenInsertEditor,
  docKey,
}: DocumentCardProps) {
  const store = useExpandStore();
  const cardPath = `__card__${docKey}`;
  const expanded = useIsExpanded(store, cardPath);
  const [editingDoc, setEditingDoc] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);
  const themeMode = resolvedTheme === "dark" ? "dark" : "light";

  const toggleExpanded = useCallback(() => {
    store.toggle(cardPath);
  }, [cardPath, store]);

  // Stable callbacks that capture docIndex (#4 fix)
  const handleFieldEditForDoc = useCallback(
    (fieldPath: string, newValue: unknown) => {
      onFieldEdit?.(index, fieldPath, newValue);
    },
    [index, onFieldEdit],
  );

  const handleUndoForDoc = useCallback(() => {
    onDocumentUndo?.(index);
  }, [index, onDocumentUndo]);

  const handleDeleteForDoc = useCallback(() => {
    onDeleteDocument?.(index);
  }, [index, onDeleteDocument]);

  // Build display ID from identifier fields (PK for SQL, _id for MongoDB)
  const displayId = useMemo(() => {
    // Try identifierFields first (SQL PK / user-selected columns)
    if (identifierFields && identifierFields.length > 0) {
      const parts = identifierFields
        .map((f) => {
          const val = document[f];
          if (val === undefined || val === null) return null;
          return String(val);
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" · ");
    }
    // Fall back to _id (MongoDB)
    const idValue = document._id;
    if (idValue) return truncateId(idValue);
    // Last resort
    return `Row ${index + 1}`;
  }, [document, identifierFields, index]);

  // Memoize previewText (#6 fix)
  const previewText = useMemo(() => {
    return Object.entries(document)
      .slice(0, 6)
      .map(([key, val]) => `${key}: ${formatValuePreview(val)}`)
      .join(", ");
  }, [document]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      writeClipboardText(JSON.stringify(document, null, 2))
        .then(() => {
          setCopied(true);
          copyTimerRef.current = setTimeout(() => {
            setCopied(false);
          }, 1500);
        })
        .catch(() => {});
    },
    [document],
  );

  const handleUndo = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleUndoForDoc();
    },
    [handleUndoForDoc],
  );

  const handleEditDoc = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDoc(true);
  }, []);

  const handleDocSave = useCallback(
    (newDoc: Record<string, unknown>) => {
      // Fields to skip during edit (PK fields shouldn't be modified)
      const skipFields = new Set(identifierFields ?? ["_id"]);

      const oldEntries = Object.entries(document);
      const newEntries = Object.entries(newDoc);

      // Update changed fields
      for (const [key, newVal] of newEntries) {
        if (skipFields.has(key)) continue;
        const oldVal = document[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          handleFieldEditForDoc(key, newVal);
        }
      }

      // Handle removed fields (set to null — MongoDB $unset would be better but this works for staging)
      for (const [key] of oldEntries) {
        if (skipFields.has(key)) continue;
        if (!(key in newDoc)) {
          handleFieldEditForDoc(key, null);
        }
      }

      setEditingDoc(false);
    },
    [document, handleFieldEditForDoc, identifierFields],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <Collapsible
          open={expanded}
          onOpenChange={() => {
            toggleExpanded();
          }}
          className="rounded-lg border border-border/50 bg-card text-card-foreground overflow-hidden hover:border-border group/card"
        >
          {/* Header */}
          <div className="relative flex items-center">
            <CollapsibleTrigger className="flex items-center gap-2 px-3 py-2 flex-1 min-w-0 text-left hover:bg-muted/30">
              <IconChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                  expanded && "rotate-90",
                )}
              />
              <span
                className={cn(
                  "font-mono text-xs font-medium shrink-0",
                  BSON_TEXT_CLASSES.objectId,
                )}
              >
                {displayId}
              </span>
              {!expanded && (
                <span className="font-mono text-xs text-muted-foreground truncate pr-20">
                  {previewText}
                </span>
              )}
            </CollapsibleTrigger>

            {/* Action buttons — absolutely positioned to avoid layout shift */}
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity bg-card rounded px-1">
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Copy document as JSON"
              >
                {copied ? (
                  <IconCheck className="size-3.5" />
                ) : (
                  <IconCopy className="size-3.5" />
                )}
              </button>
              {editable && allowStructuralEdits && (
                <button
                  type="button"
                  onClick={handleEditDoc}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Edit document as JSON"
                >
                  <IconCode className="size-3.5" />
                </button>
              )}
              {hasStagedEdits && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="Undo changes"
                >
                  <IconArrowBackUp className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Full-document JSON editor */}
          {editingDoc && (
            <div className="border-t border-border/50 p-2">
              <DocumentJsonEditor
                document={document}
                themeMode={themeMode}
                onSave={handleDocSave}
                onCancel={() => {
                  setEditingDoc(false);
                }}
              />
            </div>
          )}

          {/* Animated field tree */}
          {!editingDoc && (
            <CollapsibleContent>
              <div className="border-t border-border/50 px-3 py-2">
                {Object.entries(document).map(([key, value]) => (
                  <TreeValueNode
                    key={key}
                    fieldKey={key}
                    value={value}
                    depth={0}
                    fieldPath={key}
                    expandKeyPrefix={docKey}
                    editable={editable}
                    onFieldEdit={handleFieldEditForDoc}
                  />
                ))}
              </div>
            </CollapsibleContent>
          )}
        </Collapsible>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            writeClipboardText(JSON.stringify(document, null, 2)).catch(
              () => {},
            );
          }}
        >
          <IconCopy className="size-3.5" />
          Copy Document
        </ContextMenuItem>
        {"_id" in document && (
          <ContextMenuItem
            onClick={() => {
              const id = document._id;
              const idStr = id ? formatObjectId(id) : "";
              writeClipboardText(idStr).catch(() => {});
            }}
          >
            <IconCopy className="size-3.5" />
            Copy _id
          </ContextMenuItem>
        )}
        {editable && (
          <>
            {(allowStructuralEdits ||
              onOpenInsertEditor ||
              hasStagedEdits ||
              onDeleteDocument) && <ContextMenuSeparator />}
            {allowStructuralEdits && (
              <ContextMenuItem
                onClick={() => {
                  setEditingDoc(true);
                }}
              >
                <IconCode className="size-3.5" />
                Edit as JSON
              </ContextMenuItem>
            )}
            {onOpenInsertEditor && (
              <ContextMenuItem onClick={onOpenInsertEditor}>
                <IconPlus className="size-3.5" />
                {allowStructuralEdits ? "Insert Document" : "Insert Row"}
              </ContextMenuItem>
            )}
            {hasStagedEdits && (
              <ContextMenuItem onClick={handleUndoForDoc}>
                <IconArrowBackUp className="size-3.5" />
                Undo Changes
              </ContextMenuItem>
            )}
            {onDeleteDocument && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onClick={handleDeleteForDoc}
                >
                  <IconTrash className="size-3.5" />
                  Delete Document
                </ContextMenuItem>
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

/** Full-document JSON editor (CodeMirror) shown when clicking the edit button */
const DocumentJsonEditor = memo(function DocumentJsonEditor({
  document,
  themeMode,
  onSave,
  onCancel,
}: {
  document: Record<string, unknown>;
  themeMode: "dark" | "light";
  onSave: (doc: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(document, null, 2));
  const [error, setError] = useState<string | null>(null);

  const extensions = useMemo(
    () => [...JSON_EXTENSIONS, ...getThemeExtensions(themeMode)],
    [themeMode],
  );

  // Force re-render when theme changes by using it as key
  const themeKey = themeMode;
  void themeKey;

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(draft) as Record<string, unknown>;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setError("Must be a JSON object");
        return;
      }
      setError(null);
      onSave(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [draft, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="border border-border rounded overflow-hidden">
        <CodeMirror
          key={themeMode}
          value={draft}
          onChange={setDraft}
          extensions={extensions}
          theme="none"
          basicSetup={false}
          height="240px"
          autoFocus
        />
      </div>
      {error && <div className="text-xs text-destructive mt-1">{error}</div>}
      <div className="flex items-center gap-1 mt-1.5">
        <button
          type="button"
          onClick={handleSave}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-muted/50 hover:bg-muted"
        >
          Save (Cmd+Enter)
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-muted/50 hover:bg-muted"
        >
          Cancel (Esc)
        </button>
      </div>
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
  onDocumentUndo,
  onInsertDocument,
  onDeleteDocument,
  stagedDocIds,
  identifierFields,
  gridId,
  editable = false,
  allowStructuralEdits = true,
  onExpandCollapseRef,
}: DocumentTreeViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [showInsertEditor, setShowInsertEditor] = useState(false);
  const { resolvedTheme } = useTheme();
  const insertThemeMode = resolvedTheme === "dark" ? "dark" : "light";

  // Counter to force re-mount of the editor with a fresh template after each insert
  const [insertCounter, setInsertCounter] = useState(0);

  const handleInsertSave = useCallback(
    (doc: Record<string, unknown>) => {
      onInsertDocument?.(doc);
      setInsertCounter((c) => c + 1);
    },
    [onInsertDocument],
  );

  // Expand state — using external store for granular subscriptions
  const storageKey = gridId ? `treeview-expanded:${gridId}` : undefined;

  const expandStore = useMemo(() => {
    let initial: Set<string> | undefined;
    if (storageKey) {
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) initial = new Set(JSON.parse(stored) as string[]);
      } catch {
        /* ignore */
      }
    }
    return createExpandedPathsStore(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only create once per mount
  }, []);

  // Persist to sessionStorage on changes (debounced)
  useEffect(() => {
    if (!storageKey) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsub = expandStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify([...expandStore.getAll()]),
          );
        } catch {
          /* ignore quota errors */
        }
      }, 300);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [expandStore, storageKey]);

  // Expose expand/collapse all for external UI (status bar)
  const expandAll = useCallback(() => {
    const cardPaths: string[] = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc) continue;
      let key: string;
      if (identifierFields?.length) {
        key = identifierFields.map((f) => String(doc[f] ?? "")).join("·");
      } else if (doc._id) {
        key = formatObjectId(doc._id);
      } else {
        key = `doc-${i}`;
      }
      cardPaths.push(`__card__${key}`);
    }
    expandStore.expandAll(cardPaths);
  }, [documents, identifierFields, expandStore]);

  const collapseAll = useCallback(() => {
    expandStore.collapseAll();
  }, [expandStore]);

  // Assign to ref so parent can render buttons in status bar
  useEffect(() => {
    if (onExpandCollapseRef) {
      onExpandCollapseRef.current = { expandAll, collapseAll };
    }
    return () => {
      if (onExpandCollapseRef) {
        onExpandCollapseRef.current = null;
      }
    };
  }, [expandAll, collapseAll, onExpandCollapseRef]);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
    getItemKey: (index) => {
      const doc = documents[index];
      if (!doc) return `doc-${index}`;
      // Use identifierFields (SQL PK) or _id (MongoDB) for stable keys
      if (identifierFields && identifierFields.length > 0) {
        const parts = identifierFields.map((f) => String(doc[f] ?? ""));
        if (parts.some(Boolean)) return parts.join("·");
      }
      if (doc._id) return formatObjectId(doc._id);
      return `doc-${index}`;
    },
  });

  // Infinite scroll: load more when scrolling near the bottom
  const loadMoreRef = useRef({
    hasMore,
    isLoadingMore,
    onLoadMore,
    docLen: documents.length,
  });
  loadMoreRef.current = {
    hasMore,
    isLoadingMore,
    onLoadMore,
    docLen: documents.length,
  };

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const check = () => {
      const {
        hasMore: hm,
        isLoadingMore: ilm,
        onLoadMore: olm,
        docLen,
      } = loadMoreRef.current;
      if (!hm || ilm || !olm) return;
      const items = virtualizer.getVirtualItems();
      const lastItem = items.at(-1);
      if (lastItem && lastItem.index >= docLen - 5) {
        olm();
      }
    };
    // Check on scroll
    const onScroll = () => {
      check();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Also check on mount / data changes
    check();
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [virtualizer, documents.length]);

  // Stable insert editor opener
  const handleOpenInsertEditor = useCallback(() => {
    setShowInsertEditor(true);
  }, []);

  if (documents.length === 0) {
    return null;
  }

  return (
    <ExpandStoreContext.Provider value={expandStore}>
      <ContextMenu>
        <ContextMenuTrigger
          className={cn("overflow-auto h-full block", className)}
          ref={parentRef}
        >
          {/* Insert document editor — shown at top */}
          {showInsertEditor && (
            <div className="pb-0">
              <div className="rounded-lg border border-primary/30 bg-card p-2 mb-1.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <IconPlus className="size-3.5 text-primary" />
                  <span className="text-xs font-medium flex-1">
                    {allowStructuralEdits ? "Insert Document" : "Insert Row"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInsertEditor(false);
                    }}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    title="Close"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
                <DocumentJsonEditor
                  key={insertCounter}
                  document={buildInsertTemplate(
                    documents[0],
                    allowStructuralEdits,
                  )}
                  themeMode={insertThemeMode}
                  onSave={handleInsertSave}
                  onCancel={() => {
                    setShowInsertEditor(false);
                  }}
                />
              </div>
            </div>
          )}

          <div
            className="p-2"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
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
                    identifierFields={identifierFields}
                    allowStructuralEdits={allowStructuralEdits}
                    hasStagedEdits={
                      stagedDocIds
                        ? stagedDocIds.has(String(virtualRow.key))
                        : false
                    }
                    onFieldEdit={onFieldEdit}
                    onDocumentUndo={onDocumentUndo}
                    onDeleteDocument={onDeleteDocument}
                    onOpenInsertEditor={
                      onInsertDocument ? handleOpenInsertEditor : undefined
                    }
                    docKey={String(virtualRow.key)}
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          {editable && onInsertDocument && (
            <ContextMenuItem
              onClick={() => {
                setShowInsertEditor(true);
              }}
            >
              <IconPlus className="size-3.5" />
              {allowStructuralEdits ? "Insert Document" : "Insert Row"}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </ExpandStoreContext.Provider>
  );
});
