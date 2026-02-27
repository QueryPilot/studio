import { memo, useMemo, useDeferredValue, useState, useCallback, useRef, useEffect } from "react";
import { IconPencil, IconArrowBackUp } from "@tabler/icons-react";
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
  toSearchableText,
  formatValueForDisplay,
  rawValueForEdit,
} from "./utils";
import type { InspectorDocument, MergedFieldValue } from "./types";

const MAX_NESTED_DEPTH = 20;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorTreeViewProps {
  documents: InspectorDocument[];
  onCellEdit?: (field: string, value: unknown) => void;
  /** Display labels of fields with pending (staged) edits. */
  pendingEditLabels?: Set<string>;
  /** Undo (unstage) all pending edits for the given display label. */
  onUndoCellEdit?: (label: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Inline edit state
// ---------------------------------------------------------------------------

interface EditState {
  field: string;
  value: string;
}

// ---------------------------------------------------------------------------
// InlineEditInput — small controlled input shown when editing a field
// ---------------------------------------------------------------------------

function InlineEditInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    // Auto-focus and select when the inline editor appears
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

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    if (!committedRef.current) {
      committedRef.current = true;
      onCancel();
    }
  }, [onCancel]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="h-6 text-xs font-mono w-full px-1 py-0"
    />
  );
}

// ---------------------------------------------------------------------------
// NestedTreeNode — recursive renderer for objects / arrays (read-only)
// ---------------------------------------------------------------------------

const NestedTreeNode = memo(function NestedTreeNode({
  label,
  value,
  path,
  normalizedSearch,
  depth = 0,
}: {
  label: string;
  value: unknown;
  path: string;
  /** Pre-normalized (trimmed + lowercased) search string. Empty = no filter. */
  normalizedSearch: string;
  depth?: number;
}) {
  const matchSelf =
    !normalizedSearch ||
    path.toLowerCase().includes(normalizedSearch) ||
    toSearchableText(value).toLowerCase().includes(normalizedSearch);

  // Leaf value (primitive / null / undefined)
  if (value === null || value === undefined || typeof value !== "object") {
    if (!matchSelf) return null;
    return (
      <div
        className="py-1"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <div className="text-[11px] text-muted-foreground font-medium">{label}</div>
        <div className="text-xs font-mono pl-2 mt-0.5">{formatValueForDisplay(value)}</div>
      </div>
    );
  }

  // Depth limit to prevent stack overflow on deeply nested / circular structures
  if (depth >= MAX_NESTED_DEPTH) {
    return (
      <div
        className="text-xs text-muted-foreground italic py-1"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {label}: [max depth reached]
      </div>
    );
  }

  // Object or array — render recursively
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value as Record<string, unknown>);

  // When searching, check if any child branch has visible content.
  const hasVisibleChildren = normalizedSearch
    ? entries.some(([key, childValue]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (childPath.toLowerCase().includes(normalizedSearch)) return true;
        const childText = toSearchableText(childValue).toLowerCase();
        return childText.includes(normalizedSearch);
      })
    : entries.length > 0;

  if (!matchSelf && !hasVisibleChildren) {
    return null;
  }

  const summary = Array.isArray(value)
    ? `[${value.length} items]`
    : `{${Object.keys(value as Record<string, unknown>).length} fields}`;

  return (
    <details
      key={normalizedSearch ? "s" : "d"}
      open={depth < 2 || !!normalizedSearch || undefined}
      style={{ paddingLeft: `${depth * 14}px` }}
    >
      <summary className="cursor-pointer text-[11px] leading-6 py-0.5">
        <span className="text-muted-foreground font-medium">{label}</span>{" "}
        <span className="font-mono text-muted-foreground/70">{summary}</span>
      </summary>
      <div>
        {entries.map(([key, childValue]) => {
          const childPath = path ? `${path}.${key}` : key;
          return (
            <NestedTreeNode
              key={childPath}
              label={key}
              value={childValue}
              path={childPath}
              normalizedSearch={normalizedSearch}
              depth={depth + 1}
            />
          );
        })}
      </div>
    </details>
  );
});

// ---------------------------------------------------------------------------
// MergedFieldRow — renders one top-level field in the merged tree
// Two-line layout: label on first line, value(s) on second line
// ---------------------------------------------------------------------------

const MergedFieldRow = memo(function MergedFieldRow({
  field,
  merged,
  normalizedSearch,
  editState,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  hasEditHandler,
  hasPendingEdit,
  onUndoEdit,
}: {
  field: string;
  merged: MergedFieldValue;
  /** Pre-normalized search for nested tree nodes. */
  normalizedSearch: string;
  editState: EditState | null;
  onStartEdit: (field: string, currentValue: string) => void;
  onCommitEdit: (field: string, value: string) => void;
  onCancelEdit: () => void;
  hasEditHandler: boolean;
  hasPendingEdit: boolean;
  onUndoEdit?: (field: string) => void;
}) {
  const isEditing = editState?.field === field;

  // If the value is a nested object/array (only possible when kind === "same"),
  // render recursively instead of inline.
  if (
    merged.kind === "same" &&
    merged.value !== null &&
    merged.value !== undefined &&
    typeof merged.value === "object"
  ) {
    return (
      <NestedTreeNode
        label={field}
        value={merged.value}
        path={field}
        normalizedSearch={normalizedSearch}
        depth={0}
      />
    );
  }

  // "same" — two-line layout: label on top, value below
  if (merged.kind === "same") {
    return (
      <div className={cn(
        "py-1.5 border-b border-border/40 last:border-b-0",
        hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20 rounded-sm -mx-1 px-1",
      )}>
        <div className="flex items-center gap-1 mb-1">
          <span className="text-muted-foreground font-medium text-[11px]">{field}</span>
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
        {isEditing ? (
          <InlineEditInput
            initialValue={editState.value}
            onCommit={(v) => {
              onCommitEdit(field, v);
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <div
            className={cn(
              "group/val text-xs font-mono pl-2 flex items-center gap-1",
              hasEditHandler && "cursor-pointer hover:bg-muted/50 rounded px-1.5 py-0.5 -mx-0.5",
            )}
            onClick={() => {
              if (hasEditHandler) {
                onStartEdit(field, rawValueForEdit(merged.value));
              }
            }}
          >
            <span className="truncate">{formatValueForDisplay(merged.value)}</span>
            {hasEditHandler && (
              <IconPencil className="h-3 w-3 shrink-0 text-muted-foreground/0 group-hover/val:text-muted-foreground transition-colors" />
            )}
          </div>
        )}
      </div>
    );
  }

  // "multiple" — two-line layout: label on top, badges below
  // Clicking any badge pre-fills the editor with that value.
  // Committing sets the same value for all selected rows.
  const maxBadges = 5;
  const shown = merged.distinctValues.slice(0, maxBadges);
  const remaining = merged.distinctValues.length - maxBadges;

  return (
    <div className={cn(
      "py-1.5 border-b border-border/40 last:border-b-0",
      hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20 rounded-sm -mx-1 px-1",
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground font-medium text-[11px]">{field}</span>
        <span className="text-muted-foreground/70 italic text-[11px]">
          &lt;multiple&gt;
        </span>
        {hasEditHandler && (
          <IconPencil
            className="h-3 w-3 shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-pointer transition-colors"
            onClick={() => {
              if (!isEditing) {
                onStartEdit(field, rawValueForEdit(merged.distinctValues[0]));
              }
            }}
          />
        )}
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
      {isEditing ? (
        <InlineEditInput
          initialValue={editState.value}
          onCommit={(v) => {
            onCommitEdit(field, v);
          }}
          onCancel={onCancelEdit}
        />
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap pl-2">
          {shown.map((v) => {
            const display = formatValueForDisplay(v);
            return (
              <Tooltip key={`${field}-${display}`}>
                <TooltipTrigger>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "max-w-[120px] truncate text-xs px-1.5 py-0",
                      hasEditHandler && "cursor-pointer hover:bg-muted",
                    )}
                    onClick={() => {
                      if (hasEditHandler) {
                        onStartEdit(field, rawValueForEdit(v));
                      }
                    }}
                  >
                    {display}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[300px] break-all font-mono text-xs">
                  {display}
                </TooltipContent>
              </Tooltip>
            );
          })}
          {remaining > 0 && (
            <span className="text-muted-foreground text-[11px]">
              +{remaining} more
            </span>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// InspectorTreeView — main export
// ---------------------------------------------------------------------------

export const InspectorTreeView = memo(function InspectorTreeView({
  documents,
  onCellEdit,
  pendingEditLabels,
  onUndoCellEdit,
  className,
}: InspectorTreeViewProps) {
  const [search, setSearch] = useState("");
  // Defer expensive filtering so the input stays responsive during typing
  const deferredSearch = useDeferredValue(search);
  const [editState, setEditState] = useState<EditState | null>(null);

  // Collect all top-level keys across every document, preserving insertion order
  const allKeys = useMemo(() => {
    const keySet = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        keySet.add(key);
      }
    }
    return Array.from(keySet);
  }, [documents]);

  // Pre-filter visible keys in the parent — avoids rendering MergedFieldRow
  // components that would immediately return null, saving React reconciliation work.
  const visibleKeys = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    if (!normalizedSearch) return allKeys;
    return allKeys.filter((key) => {
      if (key.toLowerCase().includes(normalizedSearch)) return true;
      for (const doc of documents) {
        const text = toSearchableText(doc[key]);
        if (text.toLowerCase().includes(normalizedSearch)) return true;
      }
      return false;
    });
  }, [allKeys, documents, deferredSearch]);

  // Derive a valid edit state — if the field no longer exists in the current
  // document set, the edit is stale and should be discarded at render time.
  const validEditState = useMemo((): EditState | null => {
    if (!editState) return null;
    return allKeys.includes(editState.field) ? editState : null;
  }, [editState, allKeys]);

  // Merge each field's values across documents
  const mergedFields = useMemo(() => {
    const map = new Map<string, MergedFieldValue>();
    for (const key of allKeys) {
      const values = documents.map((doc) => doc[key]);
      map.set(key, mergeFieldValues(values));
    }
    return map;
  }, [allKeys, documents]);

  const handleStartEdit = useCallback((field: string, currentValue: string) => {
    setEditState({ field, value: currentValue });
  }, []);

  const handleCommitEdit = useCallback(
    (field: string, rawValue: string) => {
      setEditState(null);
      if (onCellEdit) {
        // Only parse explicit null/undefined/boolean literals.
        // Do NOT auto-convert numeric strings — the CRUD pipeline knows
        // the column type and will handle coercion correctly. Auto-converting
        // here would corrupt leading-zero strings (zip codes, padded IDs),
        // large integers beyond Number.MAX_SAFE_INTEGER, and intentionally
        // string-typed numeric fields.
        let parsed: unknown = rawValue;
        if (rawValue === "null") {
          parsed = null;
        } else if (rawValue === "undefined") {
          parsed = undefined;
        } else if (rawValue === "true") {
          parsed = true;
        } else if (rawValue === "false") {
          parsed = false;
        }
        onCellEdit(field, parsed);
      }
    },
    [onCellEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditState(null);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  // Pre-normalize once for all child NestedTreeNode components
  const normalizedSearch = useMemo(
    () => deferredSearch.trim().toLowerCase(),
    [deferredSearch],
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Input
        value={search}
        onChange={handleSearchChange}
        placeholder="Search fields or values..."
        className="h-7 text-xs mb-2 shrink-0"
      />
      <ScrollArea className="flex-1 rounded px-3 py-2">
        {visibleKeys.map((key) => {
          const merged = mergedFields.get(key);
          if (!merged) return null;
          return (
            <MergedFieldRow
              key={key}
              field={key}
              merged={merged}
              normalizedSearch={normalizedSearch}
              editState={validEditState}
              onStartEdit={handleStartEdit}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={handleCancelEdit}
              hasEditHandler={!!onCellEdit}
              hasPendingEdit={pendingEditLabels?.has(key) ?? false}
              onUndoEdit={onUndoCellEdit}
            />
          );
        })}
      </ScrollArea>
    </div>
  );
});
