# Inspector Tree View Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inspector's two-line tree view with a syntax-highlighted JSON view that supports inline editing for primitives and CodeEditor expansion for objects/arrays.

**Architecture:** Create two new components — `JsonTreeNode` (recursive JSON renderer with collapse/expand and inline primitive editing) and `JsonSubtreeEditor` (CodeEditor wrapper for object/array editing). Rewrite `InspectorTreeView` to compose these instead of the current `NestedTreeNode`/`MergedFieldRow` components.

**Tech Stack:** React 19, CodeEditor (CodeMirror), Tailwind CSS, existing inspector utils/types

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/DataGrid/components/inspector/JsonTreeNode.tsx` | Create | Recursive JSON node renderer with collapse, type coloring, inline primitive editing |
| `src/components/DataGrid/components/inspector/JsonSubtreeEditor.tsx` | Create | Inline CodeEditor for editing object/array values with save/cancel/error |
| `src/components/DataGrid/components/inspector/InspectorTreeView.tsx` | Rewrite | Compose JsonTreeNode + search + multi-row merge using new JSON display |

---

## Chunk 1: JsonTreeNode — The Core Renderer

### Task 1: Create JsonTreeNode component

**Files:**
- Create: `src/components/DataGrid/components/inspector/JsonTreeNode.tsx`

- [ ] **Step 1: Create the component file**

This component renders a single key-value pair in JSON syntax and recurses for objects/arrays.

```tsx
import { memo, useState, useCallback, useRef, useEffect } from "react";
import { IconPencil } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toSearchableText } from "./utils";

// ============================================================================
// Constants
// ============================================================================

const MAX_DEPTH = 20;
const DEFAULT_EXPAND_DEPTH = 2;
const INDENT_PX = 16;

// Type colors (Catppuccin-inspired, works in both light/dark)
const TYPE_COLORS = {
  string: "text-green-600 dark:text-green-400",
  number: "text-orange-600 dark:text-orange-400",
  boolean: "text-yellow-600 dark:text-yellow-400",
  null: "text-muted-foreground italic",
  key: "text-blue-600 dark:text-blue-400",
  bracket: "text-muted-foreground/70",
  punctuation: "text-muted-foreground/50",
} as const;

// ============================================================================
// Props
// ============================================================================

export interface JsonTreeNodeProps {
  /** The field key. Undefined for root-level rendering. */
  fieldKey?: string;
  /** The value to render. */
  value: unknown;
  /** Current nesting depth (0 = top level). */
  depth: number;
  /** Dot-separated path for search matching. */
  path: string;
  /** Pre-normalized search string. Empty = no filter. */
  normalizedSearch: string;
  /** Whether this is the last sibling (controls trailing comma). */
  isLast: boolean;
  /** Called when a primitive value is edited. `path` is the dot-path of the field. */
  onEditPrimitive?: (path: string, value: unknown) => void;
  /** Called when an object/array edit is requested. */
  onEditSubtree?: (path: string, value: unknown) => void;
  /** Set of dot-paths with pending edits. */
  pendingEditPaths?: Set<string>;
  /** Called to undo a pending edit at the given path. */
  onUndoEdit?: (path: string) => void;
}

// ============================================================================
// Inline Primitive Editor
// ============================================================================

function InlinePrimitiveEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        committedRef.current = true;
        onCommit(value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        committedRef.current = true;
        onCancel();
      }
    },
    [value, onCommit, onCancel],
  );

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => { setValue(e.target.value); }}
      onBlur={() => {
        if (!committedRef.current) {
          committedRef.current = true;
          onCancel();
        }
      }}
      onKeyDown={handleKeyDown}
      className="h-5 text-xs font-mono px-1 py-0 inline-flex w-auto min-w-[60px] max-w-[200px]"
    />
  );
}

// ============================================================================
// Value Rendering Helpers
// ============================================================================

function rawValueForInlineEdit(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return String(value);
}

function parseInlineEdit(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "undefined") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function renderPrimitiveValue(value: unknown): { display: string; colorClass: string } {
  if (value === null) return { display: "null", colorClass: TYPE_COLORS.null };
  if (value === undefined) return { display: "undefined", colorClass: TYPE_COLORS.null };
  if (typeof value === "string") return { display: `"${value}"`, colorClass: TYPE_COLORS.string };
  if (typeof value === "number") return { display: String(value), colorClass: TYPE_COLORS.number };
  if (typeof value === "boolean") return { display: String(value), colorClass: TYPE_COLORS.boolean };
  return { display: String(value), colorClass: TYPE_COLORS.string };
}

// ============================================================================
// JsonTreeNode
// ============================================================================

export const JsonTreeNode = memo(function JsonTreeNode({
  fieldKey,
  value,
  depth,
  path,
  normalizedSearch,
  isLast,
  onEditPrimitive,
  onEditSubtree,
  pendingEditPaths,
  onUndoEdit,
}: JsonTreeNodeProps) {
  const [collapsed, setCollapsed] = useState(depth >= DEFAULT_EXPAND_DEPTH);
  const [editing, setEditing] = useState(false);

  // Expand all when searching
  const isCollapsed = normalizedSearch ? false : collapsed;

  const hasPendingEdit = pendingEditPaths?.has(path) ?? false;
  const comma = isLast ? "" : ",";
  const indent = depth * INDENT_PX;

  // Search visibility
  const matchSelf =
    !normalizedSearch ||
    path.toLowerCase().includes(normalizedSearch) ||
    toSearchableText(value).toLowerCase().includes(normalizedSearch);

  // ---- Primitive leaf ----
  const isPrimitive = value === null || value === undefined || typeof value !== "object";

  if (isPrimitive) {
    if (!matchSelf) return null;

    const { display, colorClass } = renderPrimitiveValue(value);

    return (
      <div
        className={cn(
          "group/line flex items-center min-h-[24px] hover:bg-muted/40 rounded-sm px-1 -mx-1",
          hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {/* Spacer for toggle alignment */}
        <span className="w-4 shrink-0" />

        {fieldKey !== undefined && (
          <>
            <span className={cn("font-mono text-xs", TYPE_COLORS.key)}>
              "{fieldKey}"
            </span>
            <span className={cn("font-mono text-xs mx-0.5", TYPE_COLORS.punctuation)}>
              :
            </span>
          </>
        )}

        {editing ? (
          <InlinePrimitiveEditor
            initialValue={rawValueForInlineEdit(value)}
            onCommit={(raw) => {
              setEditing(false);
              onEditPrimitive?.(path, parseInlineEdit(raw));
            }}
            onCancel={() => { setEditing(false); }}
          />
        ) : (
          <span
            className={cn(
              "font-mono text-xs cursor-default truncate",
              colorClass,
              onEditPrimitive && "cursor-pointer hover:underline decoration-dotted",
            )}
            onClick={() => {
              if (onEditPrimitive) {
                setEditing(true);
              }
            }}
          >
            {display}
          </span>
        )}

        <span className={cn("font-mono text-xs", TYPE_COLORS.punctuation)}>
          {comma}
        </span>

        {onEditPrimitive && !editing && (
          <IconPencil className="h-3 w-3 ml-1 shrink-0 text-muted-foreground/0 group-hover/line:text-muted-foreground/50 transition-colors" />
        )}
      </div>
    );
  }

  // ---- Object or Array ----
  if (depth >= MAX_DEPTH) {
    return (
      <div
        className="font-mono text-xs text-muted-foreground italic min-h-[24px] flex items-center"
        style={{ paddingLeft: `${indent}px` }}
      >
        <span className="w-4 shrink-0" />
        {fieldKey !== undefined && (
          <>
            <span className={TYPE_COLORS.key}>"{fieldKey}"</span>
            <span className={cn("mx-0.5", TYPE_COLORS.punctuation)}>:</span>
          </>
        )}
        [max depth]
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";
  const itemCount = entries.length;

  // Search: check if any descendant matches
  const hasVisibleChildren = normalizedSearch
    ? entries.some(([key, childValue]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (childPath.toLowerCase().includes(normalizedSearch)) return true;
        return toSearchableText(childValue).toLowerCase().includes(normalizedSearch);
      })
    : entries.length > 0;

  if (!matchSelf && !hasVisibleChildren) return null;

  const toggleCollapse = () => { setCollapsed((prev) => !prev); };

  return (
    <>
      {/* Opening line: key: { / key: [ */}
      <div
        className={cn(
          "group/line flex items-center min-h-[24px] hover:bg-muted/40 rounded-sm px-1 -mx-1",
          hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20",
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {/* Collapse toggle */}
        <button
          type="button"
          className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
          onClick={toggleCollapse}
        >
          <span className="text-[10px] leading-none select-none">
            {isCollapsed ? "▶" : "▼"}
          </span>
        </button>

        {fieldKey !== undefined && (
          <>
            <span className={cn("font-mono text-xs", TYPE_COLORS.key)}>
              "{fieldKey}"
            </span>
            <span className={cn("font-mono text-xs mx-0.5", TYPE_COLORS.punctuation)}>
              :
            </span>
          </>
        )}

        <span className={cn("font-mono text-xs", TYPE_COLORS.bracket)}>
          {openBracket}
        </span>

        {isCollapsed && (
          <>
            <span className="font-mono text-xs text-muted-foreground/50 mx-0.5">
              {itemCount} {isArray ? (itemCount === 1 ? "item" : "items") : (itemCount === 1 ? "field" : "fields")}
            </span>
            <span className={cn("font-mono text-xs", TYPE_COLORS.bracket)}>
              {closeBracket}
            </span>
            <span className={cn("font-mono text-xs", TYPE_COLORS.punctuation)}>
              {comma}
            </span>
          </>
        )}

        {/* Edit button for object/array (visible on hover) */}
        {onEditSubtree && (
          <IconPencil
            className="h-3 w-3 ml-1 shrink-0 text-muted-foreground/0 group-hover/line:text-muted-foreground/50 transition-colors cursor-pointer"
            onClick={() => { onEditSubtree(path, value); }}
          />
        )}
      </div>

      {/* Children (when expanded) */}
      {!isCollapsed && (
        <>
          {entries.map(([key, childValue], index) => {
            const childPath = path ? `${path}.${key}` : key;
            return (
              <JsonTreeNode
                key={childPath}
                fieldKey={isArray ? undefined : key}
                value={childValue}
                depth={depth + 1}
                path={childPath}
                normalizedSearch={normalizedSearch}
                isLast={index === entries.length - 1}
                onEditPrimitive={onEditPrimitive}
                onEditSubtree={onEditSubtree}
                pendingEditPaths={pendingEditPaths}
                onUndoEdit={onUndoEdit}
              />
            );
          })}
          {/* Closing bracket */}
          <div
            className="flex items-center min-h-[24px]"
            style={{ paddingLeft: `${indent}px` }}
          >
            <span className="w-4 shrink-0" />
            <span className={cn("font-mono text-xs", TYPE_COLORS.bracket)}>
              {closeBracket}
            </span>
            <span className={cn("font-mono text-xs", TYPE_COLORS.punctuation)}>
              {comma}
            </span>
          </div>
        </>
      )}
    </>
  );
});
```

Note for array items: `fieldKey` is `undefined` for array elements — they render as bare values without a key prefix. Array indices are implicit from position (matching JSON syntax). If we want to show array indices, we can set `fieldKey` to the index string — but pure JSON doesn't show indices, so we omit them for the JSON aesthetic.

**Update:** Actually, for arrays, showing the index helps usability. Let's set `fieldKey` to the index string for array elements too. Change the array entry mapping line in the recursive section:

In the entries mapping for children, array items should use `fieldKey={key}` (where key is the string index) so they render as `0: "value"` style. This matches Compass behavior while staying close to JSON.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/components/inspector/JsonTreeNode.tsx
git commit -m "feat(inspector): add JsonTreeNode with syntax-highlighted JSON rendering"
```

---

### Task 2: Create JsonSubtreeEditor component

**Files:**
- Create: `src/components/DataGrid/components/inspector/JsonSubtreeEditor.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { memo, useState, useCallback, useMemo } from "react";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JsonSubtreeEditorProps {
  /** The value being edited (object or array). */
  initialValue: unknown;
  /** Called with the parsed new value on save. */
  onSave: (value: unknown) => void;
  /** Called when the user cancels editing. */
  onCancel: () => void;
  className?: string;
}

export const JsonSubtreeEditor = memo(function JsonSubtreeEditor({
  initialValue,
  onSave,
  onCancel,
  className,
}: JsonSubtreeEditorProps) {
  const initialJson = useMemo(() => {
    try {
      return JSON.stringify(initialValue, null, 2);
    } catch {
      return "{}";
    }
  }, [initialValue]);

  const [jsonText, setJsonText] = useState(initialJson);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      setParseError(null);
      onSave(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [jsonText, onSave]);

  const handleChange = useCallback((value: string) => {
    setJsonText(value);
    // Clear error as user types
    setParseError(null);
  }, []);

  return (
    <div className={cn("border rounded-md overflow-hidden my-1", className)}>
      <CodeEditor
        value={jsonText}
        onChange={handleChange}
        language="json"
        lineNumbers={false}
        height="auto"
        minHeight="60px"
        maxHeight="300px"
      />
      {parseError && (
        <div className="px-2 py-1 text-[11px] text-destructive bg-destructive/10 border-t">
          {parseError}
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t bg-muted/30">
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[11px] px-2"
          onClick={handleSave}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/DataGrid/components/inspector/JsonSubtreeEditor.tsx
git commit -m "feat(inspector): add JsonSubtreeEditor for inline object/array editing"
```

---

## Chunk 2: Rewrite InspectorTreeView

### Task 3: Rewrite InspectorTreeView

**Files:**
- Modify: `src/components/DataGrid/components/inspector/InspectorTreeView.tsx`

This is a full rewrite. The component keeps the same props interface but replaces the internal rendering with `JsonTreeNode` and `JsonSubtreeEditor`.

- [ ] **Step 1: Rewrite the file**

```tsx
import {
  memo,
  useMemo,
  useDeferredValue,
  useState,
  useCallback,
} from "react";
import { IconArrowBackUp } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  mergeFieldValues,
  formatValueForDisplay,
  rawValueForEdit,
} from "./utils";
import type { InspectorDocument, MergedFieldValue } from "./types";
import { JsonTreeNode } from "./JsonTreeNode";
import { JsonSubtreeEditor } from "./JsonSubtreeEditor";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorTreeViewProps {
  documents: InspectorDocument[];
  dataTypeMap?: Map<string, string>;
  onCellEdit?: (field: string, value: unknown) => void;
  pendingEditLabels?: Set<string>;
  onUndoCellEdit?: (label: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Subtree edit state
// ---------------------------------------------------------------------------

interface SubtreeEditState {
  path: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// MergedFieldBadges — rendered when multiple rows have different values
// ---------------------------------------------------------------------------

const MergedFieldBadges = memo(function MergedFieldBadges({
  field,
  merged,
  hasEditHandler,
  onStartEdit,
  hasPendingEdit,
  onUndoEdit,
}: {
  field: string;
  merged: MergedFieldValue & { kind: "multiple" };
  hasEditHandler: boolean;
  onStartEdit: (field: string, value: string) => void;
  hasPendingEdit: boolean;
  onUndoEdit?: (field: string) => void;
}) {
  const maxBadges = 5;
  const shown = merged.distinctValues.slice(0, maxBadges);
  const remaining = merged.distinctValues.length - maxBadges;

  return (
    <div
      className={cn(
        "py-1.5 px-1 border-b border-border/40 last:border-b-0",
        hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20 rounded-sm",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span className={cn("font-mono text-xs text-blue-600 dark:text-blue-400 shrink-0")}>
          "{field}"
        </span>
        <span className="font-mono text-xs text-muted-foreground/50">:</span>
        <span className="text-muted-foreground/70 italic text-[11px] shrink-0">
          &lt;multiple&gt;
        </span>
        {hasPendingEdit && onUndoEdit && (
          <Tooltip>
            <TooltipTrigger>
              <button
                type="button"
                className="inline-flex items-center justify-center h-4 w-4 rounded-sm hover:bg-amber-200/60 dark:hover:bg-amber-800/40 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onUndoEdit(field);
                }}
              >
                <IconArrowBackUp className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Revert edit
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pl-5">
        {shown.map((v) => {
          const display = formatValueForDisplay(v);
          return (
            <Badge
              key={`${field}-${display}`}
              variant="secondary"
              className={cn(
                "max-w-[180px] shrink text-xs font-mono px-1.5 py-0",
                hasEditHandler && "cursor-pointer hover:bg-muted",
              )}
              onClick={() => {
                if (hasEditHandler) {
                  onStartEdit(field, rawValueForEdit(v));
                }
              }}
            >
              <span className="truncate">{display}</span>
            </Badge>
          );
        })}
        {remaining > 0 && (
          <span className="text-muted-foreground text-[11px]">
            +{remaining} more
          </span>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// InspectorTreeView — main export
// ---------------------------------------------------------------------------

export const InspectorTreeView = memo(function InspectorTreeView({
  documents,
  dataTypeMap,
  onCellEdit,
  pendingEditLabels,
  onUndoCellEdit,
  className,
}: InspectorTreeViewProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [subtreeEdit, setSubtreeEdit] = useState<SubtreeEditState | null>(null);

  // Single document mode: render as full JSON tree
  // Multi-document mode: render merged fields (badges for conflicts)
  const isSingleDoc = documents.length === 1;

  // Collect all top-level keys
  const allKeys = useMemo(() => {
    const keySet = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        keySet.add(key);
      }
    }
    return Array.from(keySet);
  }, [documents]);

  // Merge values for multi-doc mode
  const mergedFields = useMemo(() => {
    const map = new Map<string, MergedFieldValue>();
    for (const key of allKeys) {
      const values = documents.map((doc) => doc[key]);
      map.set(key, mergeFieldValues(values));
    }
    return map;
  }, [allKeys, documents]);

  const normalizedSearch = useMemo(
    () => deferredSearch.trim().toLowerCase(),
    [deferredSearch],
  );

  // Filter visible keys for multi-doc mode
  const visibleKeys = useMemo(() => {
    if (!normalizedSearch) return allKeys;
    return allKeys.filter((key) => {
      if (key.toLowerCase().includes(normalizedSearch)) return true;
      for (const doc of documents) {
        const val = doc[key];
        if (val !== undefined) {
          const text =
            typeof val === "string" ? val : JSON.stringify(val) ?? "";
          if (text.toLowerCase().includes(normalizedSearch)) return true;
        }
      }
      return false;
    });
  }, [allKeys, documents, normalizedSearch]);

  // Edit handlers
  const handleEditPrimitive = useCallback(
    (path: string, value: unknown) => {
      // For single-doc mode, the path is a dot-separated field path.
      // The top-level key is the first segment — that's the display label
      // the InspectorPanel uses for the onCellEdit callback.
      const topLevelKey = path.split(".")[0];
      if (topLevelKey && onCellEdit) {
        onCellEdit(topLevelKey, value);
      }
    },
    [onCellEdit],
  );

  const handleEditSubtree = useCallback(
    (path: string, value: unknown) => {
      setSubtreeEdit({ path, value });
    },
    [],
  );

  const handleSubtreeSave = useCallback(
    (newValue: unknown) => {
      if (subtreeEdit && onCellEdit) {
        const topLevelKey = subtreeEdit.path.split(".")[0];
        if (topLevelKey) {
          onCellEdit(topLevelKey, newValue);
        }
      }
      setSubtreeEdit(null);
    },
    [subtreeEdit, onCellEdit],
  );

  const handleSubtreeCancel = useCallback(() => {
    setSubtreeEdit(null);
  }, []);

  // For multi-doc inline edit (badges)
  const [inlineEditField, setInlineEditField] = useState<{ field: string; value: string } | null>(null);

  const handleBadgeStartEdit = useCallback((field: string, currentValue: string) => {
    setInlineEditField({ field, value: currentValue });
  }, []);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); }}
        placeholder="Search fields or values..."
        className="h-7 text-xs mb-2 shrink-0"
      />

      <ScrollArea className="flex-1 rounded">
        {isSingleDoc ? (
          // ---- Single document: full JSON tree ----
          <div className="py-1">
            {subtreeEdit ? (
              <JsonSubtreeEditor
                initialValue={subtreeEdit.value}
                onSave={handleSubtreeSave}
                onCancel={handleSubtreeCancel}
              />
            ) : (
              <JsonTreeNode
                value={documents[0]}
                depth={0}
                path=""
                normalizedSearch={normalizedSearch}
                isLast={true}
                onEditPrimitive={onCellEdit ? handleEditPrimitive : undefined}
                onEditSubtree={onCellEdit ? handleEditSubtree : undefined}
                pendingEditPaths={pendingEditLabels}
                onUndoEdit={onUndoCellEdit}
              />
            )}
          </div>
        ) : (
          // ---- Multiple documents: merged field rows ----
          <div className="py-1">
            {visibleKeys.map((key) => {
              const merged = mergedFields.get(key);
              if (!merged) return null;

              if (merged.kind === "multiple") {
                return (
                  <MergedFieldBadges
                    key={key}
                    field={key}
                    merged={merged}
                    hasEditHandler={!!onCellEdit}
                    onStartEdit={handleBadgeStartEdit}
                    hasPendingEdit={pendingEditLabels?.has(key) ?? false}
                    onUndoEdit={onUndoCellEdit}
                  />
                );
              }

              // "same" value — render as a JSON tree node
              return (
                <JsonTreeNode
                  key={key}
                  fieldKey={key}
                  value={merged.value}
                  depth={0}
                  path={key}
                  normalizedSearch={normalizedSearch}
                  isLast={true}
                  onEditPrimitive={onCellEdit ? handleEditPrimitive : undefined}
                  onEditSubtree={onCellEdit ? handleEditSubtree : undefined}
                  pendingEditPaths={pendingEditLabels}
                  onUndoEdit={onUndoCellEdit}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
```

Key changes from the old implementation:
- **Single-doc mode** renders the entire document as one `JsonTreeNode` tree — this gives the full JSON aesthetic with proper `{` / `}` wrapping, nested indentation, and commas
- **Multi-doc mode** renders per-field rows: "same" values use `JsonTreeNode`, "multiple" values use `MergedFieldBadges`
- The subtree editor appears as a `JsonSubtreeEditor` block replacing the tree when active
- The props interface is unchanged — `InspectorPanel` needs zero modifications

- [ ] **Step 2: Update the index.ts exports if needed**

Check that `src/components/DataGrid/components/inspector/index.ts` still exports correctly. The public API should remain the same since `InspectorTreeView` is still exported from the same file.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors in inspector files

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit`
Expected: All tests pass (the DrillableCellRenderer tests should still pass; inspector tests if any should still pass)

- [ ] **Step 6: Commit**

```bash
git add src/components/DataGrid/components/inspector/InspectorTreeView.tsx
git commit -m "feat(inspector): rewrite tree view with syntax-highlighted JSON display"
```

---

## Chunk 3: Polish and Verification

### Task 4: Verify integration and fix edge cases

**Files:**
- Possibly modify: `src/components/DataGrid/components/inspector/InspectorTreeView.tsx`
- Possibly modify: `src/components/DataGrid/components/inspector/JsonTreeNode.tsx`

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint on all changed files**

Run: `npx eslint src/components/DataGrid/components/inspector/JsonTreeNode.tsx src/components/DataGrid/components/inspector/JsonSubtreeEditor.tsx src/components/DataGrid/components/inspector/InspectorTreeView.tsx`
Expected: No errors

- [ ] **Step 3: Run tests**

Run: `pnpm test:unit`
Expected: All tests pass

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -u src/components/DataGrid/components/inspector/
git commit -m "fix(inspector): resolve lint and edge case issues"
```
