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
          &quot;{field}&quot;
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
            typeof val === "string" ? val : JSON.stringify(val);
          if (text.toLowerCase().includes(normalizedSearch)) return true;
        }
      }
      return false;
    });
  }, [allKeys, documents, normalizedSearch]);

  // Edit handlers
  const handleEditPrimitive = useCallback(
    (path: string, value: unknown) => {
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
  const handleBadgeStartEdit = useCallback((_field: string, _currentValue: string) => {
    // Multi-doc inline edit input is not yet wired — badges set up state
    // but the actual inline input for multi-doc mode is future scope.
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
                dataTypeMap={dataTypeMap}
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
                  dataType={dataTypeMap?.get(key)}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
