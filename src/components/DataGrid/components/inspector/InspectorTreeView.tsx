import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  mergeFieldValues,
  toSearchableText,
  formatValueForDisplay,
} from "./utils";
import type { InspectorDocument, MergedFieldValue } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorTreeViewProps {
  documents: InspectorDocument[];
  onCellEdit?: (field: string, value: unknown) => void;
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

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onBlur={() => {
        if (!committedRef.current) {
          onCommit(value);
        }
      }}
      onKeyDown={handleKeyDown}
      className="h-6 text-xs font-mono inline-flex w-auto min-w-[80px] max-w-[200px] px-1 py-0"
    />
  );
}

// ---------------------------------------------------------------------------
// NestedTreeNode — recursive renderer for objects / arrays (read-only)
// ---------------------------------------------------------------------------

function NestedTreeNode({
  label,
  value,
  path,
  search,
  depth = 0,
}: {
  label: string;
  value: unknown;
  path: string;
  search: string;
  depth?: number;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const matchSelf =
    !normalizedSearch ||
    path.toLowerCase().includes(normalizedSearch) ||
    toSearchableText(value).toLowerCase().includes(normalizedSearch);

  // Leaf value (primitive / null / undefined)
  if (value === null || value === undefined || typeof value !== "object") {
    if (!matchSelf) return null;
    return (
      <div
        className="text-xs leading-6"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <span className="text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono">{formatValueForDisplay(value)}</span>
      </div>
    );
  }

  // Object or array — render recursively
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value as Record<string, unknown>);

  const children = entries.map(([key, childValue]) => (
    <NestedTreeNode
      key={`${path}.${key}`}
      label={key}
      value={childValue}
      path={path ? `${path}.${key}` : key}
      search={search}
      depth={depth + 1}
    />
  ));

  if (!matchSelf && children.length === 0) {
    return null;
  }

  const summary = Array.isArray(value)
    ? `[${value.length} items]`
    : `{${Object.keys(value as Record<string, unknown>).length} fields}`;

  return (
    <details
      open={depth < 2 || undefined}
      className="text-xs"
      style={{ paddingLeft: `${depth * 14}px` }}
    >
      <summary className="cursor-pointer leading-6">
        <span className="text-muted-foreground">{label}:</span>{" "}
        <span className="font-mono">{summary}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// MergedFieldRow — renders one top-level field in the merged tree
// ---------------------------------------------------------------------------

function MergedFieldRow({
  field,
  merged,
  search,
  editState,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  hasEditHandler,
}: {
  field: string;
  merged: MergedFieldValue;
  search: string;
  editState: EditState | null;
  onStartEdit: (field: string, currentValue: string) => void;
  onCommitEdit: (field: string, value: string) => void;
  onCancelEdit: () => void;
  hasEditHandler: boolean;
}) {
  const normalizedSearch = search.trim().toLowerCase();

  // Search filter: match field name or any value text
  const fieldMatches = field.toLowerCase().includes(normalizedSearch);
  const valueText =
    merged.kind === "same"
      ? toSearchableText(merged.value)
      : merged.distinctValues.map(toSearchableText).join(" ");
  const valueMatches = valueText.toLowerCase().includes(normalizedSearch);

  if (normalizedSearch && !fieldMatches && !valueMatches) {
    return null;
  }

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
        search={search}
        depth={0}
      />
    );
  }

  // "same" — single-value display with click-to-edit
  if (merged.kind === "same") {
    return (
      <div className="text-xs leading-6 flex items-center gap-1">
        <span className="text-muted-foreground shrink-0">{field}:</span>
        {isEditing ? (
          <InlineEditInput
            initialValue={editState.value}
            onCommit={(v) => {
              onCommitEdit(field, v);
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <span
            className={cn(
              "font-mono truncate",
              hasEditHandler && "cursor-pointer hover:underline",
            )}
            onClick={() => {
              if (hasEditHandler) {
                onStartEdit(field, formatValueForDisplay(merged.value));
              }
            }}
          >
            {formatValueForDisplay(merged.value)}
          </span>
        )}
      </div>
    );
  }

  // "multiple" — show badges for distinct values
  const maxBadges = 3;
  const shown = merged.distinctValues.slice(0, maxBadges);
  const remaining = merged.distinctValues.length - maxBadges;

  return (
    <div className="text-xs leading-6">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-muted-foreground shrink-0">{field}:</span>
        {isEditing ? (
          <InlineEditInput
            initialValue={editState.value}
            onCommit={(v) => {
              onCommitEdit(field, v);
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <>
            <span
              className={cn(
                "text-muted-foreground italic",
                hasEditHandler && "cursor-pointer hover:underline",
              )}
              onClick={() => {
                if (hasEditHandler) {
                  onStartEdit(field, "");
                }
              }}
            >
              &lt;multiple values&gt;
            </span>
            {shown.map((v) => (
              <Badge
                key={formatValueForDisplay(v)}
                variant="secondary"
                className="max-w-[60px] truncate"
              >
                {formatValueForDisplay(v)}
              </Badge>
            ))}
            {remaining > 0 && (
              <span className="text-muted-foreground">
                +{remaining} more
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorTreeView — main export
// ---------------------------------------------------------------------------

export const InspectorTreeView = memo(function InspectorTreeView({
  documents,
  onCellEdit,
  className,
}: InspectorTreeViewProps) {
  const [search, setSearch] = useState("");
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
        // Attempt to parse as JSON (numbers, booleans, null, objects, arrays).
        // Fall back to raw string if parsing fails.
        let parsed: unknown = rawValue;
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          // keep as string
        }
        onCellEdit(field, parsed);
      }
    },
    [onCellEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditState(null);
  }, []);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
        placeholder="Search fields or values..."
        className="h-8 text-xs mb-2 shrink-0"
      />
      <ScrollArea className="flex-1 rounded border p-2">
        {allKeys.map((key) => {
          const merged = mergedFields.get(key);
          if (!merged) return null;
          return (
            <MergedFieldRow
              key={key}
              field={key}
              merged={merged}
              search={search}
              editState={editState}
              onStartEdit={handleStartEdit}
              onCommitEdit={handleCommitEdit}
              onCancelEdit={handleCancelEdit}
              hasEditHandler={!!onCellEdit}
            />
          );
        })}
      </ScrollArea>
    </div>
  );
});
