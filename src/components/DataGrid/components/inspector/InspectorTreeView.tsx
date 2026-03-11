import {
  memo,
  useMemo,
  useDeferredValue,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { IconArrowBackUp, IconPencil } from "@tabler/icons-react";
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
  parseLiteralValue,
} from "./utils";
import type { InspectorDocument, MergedFieldValue } from "./types";
import { JsonTreeNode } from "./JsonTreeNode";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorTreeViewProps {
  documents: InspectorDocument[];
  /** Map from display label → column data type (e.g. "VARCHAR(255)", "INT"). */
  dataTypeMap?: Map<string, string>;
  onCellEdit?: (field: string, value: unknown) => void;
  /** Display labels of fields with pending (staged) edits. */
  pendingEditLabels?: Set<string>;
  /** Undo (unstage) all pending edits for the given display label. */
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
// Shared nested-path edit helper
// ---------------------------------------------------------------------------

/**
 * Apply an edit at a nested dot-separated path inside a top-level document value.
 * Returns `{ topKey, topValue }` with the cloned+mutated top-level value,
 * or `null` if the path walk fails (intermediate node is null/non-object).
 */
function applyNestedEdit(
  documents: InspectorDocument[],
  path: string,
  newValue: unknown,
): { topKey: string; topValue: unknown } | null {
  const doc = documents[0];
  if (!doc) return null;

  const dotIndex = path.indexOf(".");
  if (dotIndex === -1) {
    return { topKey: path, topValue: newValue };
  }

  const topKey = path.slice(0, dotIndex);
  const restPath = path.slice(dotIndex + 1);
  const topValue = structuredClone(doc[topKey]);

  const segments = restPath.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep clone mutation
  let cursor: any = topValue;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor?.[segments[i]!];
    if (next == null || typeof next !== "object") return null;
    cursor = next;
  }

  const lastSegment = segments[segments.length - 1]!;
  if (cursor && typeof cursor === "object") {
    cursor[lastSegment] = newValue;
  } else {
    return null;
  }

  return { topKey, topValue };
}

// ---------------------------------------------------------------------------
// MergedFieldBadges — rendered when multiple rows have different values
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline editor for MergedFieldBadges primitive edits
// ---------------------------------------------------------------------------

function MergedFieldInlineEditor({
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

  return (
    <div className="flex items-center gap-1 pl-5 mt-0.5">
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
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            committedRef.current = true;
            onCommit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            onCancel();
          }
        }}
        spellCheck={false}
        className="h-6 text-xs font-mono flex-1 min-w-0"
        placeholder="New value for all rows…"
      />
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        className="text-[10px] text-primary hover:text-primary/80 font-medium px-1 rounded cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault();
          committedRef.current = true;
          onCommit(value);
        }}
      >
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MergedFieldBadges — rendered when multiple rows have different values
// ---------------------------------------------------------------------------

const MergedFieldBadges = memo(function MergedFieldBadges({
  field,
  merged,
  hasEditHandler,
  onEditPrimitive,
  onEditSubtree,
  hasPendingEdit,
  onUndoEdit,
}: {
  field: string;
  merged: MergedFieldValue & { kind: "multiple" };
  hasEditHandler: boolean;
  onEditPrimitive?: (field: string, value: unknown) => void;
  onEditSubtree?: (field: string, value: unknown) => void;
  hasPendingEdit: boolean;
  onUndoEdit?: (field: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const maxBadges = 5;
  const shown = merged.distinctValues.slice(0, maxBadges);
  const remaining = merged.distinctValues.length - maxBadges;

  // Determine if the first value is a complex type (object/array)
  const firstValue = merged.distinctValues[0];
  const isComplex =
    firstValue !== null &&
    firstValue !== undefined &&
    typeof firstValue === "object";

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isComplex && onEditSubtree) {
        // Open subtree editor for objects/arrays — use empty object/array as default
        const defaultValue = Array.isArray(firstValue) ? [] : {};
        onEditSubtree(field, defaultValue);
      } else {
        setEditing(true);
      }
    },
    [field, isComplex, firstValue, onEditSubtree],
  );

  return (
    <div
      className={cn(
        "py-1.5 px-1 border-b border-border/40 last:border-b-0",
        hasPendingEdit && "bg-amber-50/60 dark:bg-amber-950/20 rounded-sm",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span className={cn("font-mono text-xs text-blue-600 dark:text-blue-400 shrink-0")}>
          &quot;{field}&quot;
        </span>
        <span className="font-mono text-xs text-muted-foreground/50">:</span>
        <span className="text-muted-foreground/70 italic text-[11px] shrink-0">
          &lt;multiple&gt;
        </span>
        {hasEditHandler && !editing && (
          <Tooltip>
            <TooltipTrigger>
              <button
                type="button"
                className="inline-flex items-center justify-center h-4 w-4 rounded-sm hover:bg-muted transition-colors cursor-pointer"
                onClick={handleEditClick}
              >
                <IconPencil className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Edit for all selected rows
            </TooltipContent>
          </Tooltip>
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
      <div className="flex items-center gap-1.5 flex-wrap pl-5">
        {shown.map((v) => {
          const display = formatValueForDisplay(v);
          return (
            <Badge
              key={`${field}-${display}`}
              variant="secondary"
              className="max-w-[180px] shrink text-xs font-mono px-1.5 py-0"
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
      {editing && (
        <MergedFieldInlineEditor
          initialValue=""
          onCommit={(raw) => {
            setEditing(false);
            onEditPrimitive?.(field, parseLiteralValue(raw));
          }}
          onCancel={() => { setEditing(false); }}
        />
      )}
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
            typeof val === "string" ? val : JSON.stringify(val);
          if (text.toLowerCase().includes(normalizedSearch)) return true;
        }
      }
      return false;
    });
  }, [allKeys, documents, normalizedSearch]);

  // Edit callback for primitives at any depth. For nested paths (e.g.
  // "shippingAddress.city"), reconstructs the top-level value with the
  // nested edit applied, since onCellEdit expects a top-level field key.
  const handleEditPrimitive = useCallback(
    (path: string, value: unknown) => {
      if (!onCellEdit) return;
      const result = applyNestedEdit(documents, path, value);
      if (result) {
        onCellEdit(result.topKey, result.topValue);
      }
    },
    [onCellEdit, documents],
  );

  const handleEditSubtree = useCallback(
    (path: string, value: unknown) => {
      setSubtreeEdit({ path, value });
    },
    [],
  );

  const handleSubtreeSave = useCallback(
    (newValue: unknown) => {
      if (!subtreeEdit || !onCellEdit) {
        setSubtreeEdit(null);
        return;
      }

      const result = applyNestedEdit(documents, subtreeEdit.path, newValue);
      if (result) {
        onCellEdit(result.topKey, result.topValue);
      }

      setSubtreeEdit(null);
    },
    [subtreeEdit, onCellEdit, documents],
  );

  const handleSubtreeCancel = useCallback(() => {
    setSubtreeEdit(null);
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
              dataTypeMap={dataTypeMap}
              subtreeEditPath={subtreeEdit?.path}
              subtreeEditValue={subtreeEdit?.value}
              onSubtreeSave={handleSubtreeSave}
              onSubtreeCancel={handleSubtreeCancel}
            />
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
                    onEditPrimitive={onCellEdit ? handleEditPrimitive : undefined}
                    onEditSubtree={onCellEdit ? handleEditSubtree : undefined}
                    hasPendingEdit={pendingEditLabels?.has(key) ?? false}
                    onUndoEdit={onUndoCellEdit}
                  />
                );
              }

              // "same" value — render as a JSON tree node (editable, same as single-doc)
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
                  dataType={dataTypeMap?.get(key)}
                  subtreeEditPath={subtreeEdit?.path}
                  subtreeEditValue={subtreeEdit?.value}
                  onSubtreeSave={handleSubtreeSave}
                  onSubtreeCancel={handleSubtreeCancel}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
