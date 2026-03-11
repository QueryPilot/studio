import { memo, useState, useRef, useEffect } from "react";
import { IconPencil, IconArrowBackUp } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toSearchableText, rawValueForEdit, parseLiteralValue } from "./utils";

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
  /** Data type string for tooltip (only meaningful at this node). */
  dataType?: string;
  /** Map from field name → data type, passed to depth-1 children for tooltip display. */
  dataTypeMap?: Map<string, string>;
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

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
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
          onCommit((e.target as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      className="h-5 text-xs font-mono px-1 py-0 inline-flex w-auto min-w-[60px] max-w-[200px]"
    />
  );
}

// ============================================================================
// Shared Subcomponents (eliminates copy-paste)
// ============================================================================

/** Renders a JSON field key with optional data-type tooltip. */
function FieldKeyLabel({
  fieldKey,
  dataType,
}: {
  fieldKey: string;
  dataType?: string;
}) {
  const keySpan = (
    <span className={cn("font-mono text-xs", TYPE_COLORS.key)}>
      &quot;{fieldKey}&quot;
    </span>
  );

  return (
    <>
      {dataType ? (
        <Tooltip>
          <TooltipTrigger>{keySpan}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs font-mono">
            {dataType}
          </TooltipContent>
        </Tooltip>
      ) : (
        keySpan
      )}
      <span
        className={cn("font-mono text-xs mx-0.5", TYPE_COLORS.punctuation)}
      >
        :
      </span>
    </>
  );
}

/** Renders an undo button for fields with pending edits. */
function UndoEditButton({
  onUndo,
}: {
  onUndo: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          type="button"
          className="inline-flex items-center justify-center h-4 w-4 ml-0.5 rounded-sm hover:bg-amber-200/60 dark:hover:bg-amber-800/40 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
        >
          <IconArrowBackUp className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Revert edit
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// Value Rendering Helper
// ============================================================================

function renderPrimitiveValue(value: unknown): {
  display: string;
  colorClass: string;
} {
  if (value === null) return { display: "null", colorClass: TYPE_COLORS.null };
  if (value === undefined)
    return { display: "undefined", colorClass: TYPE_COLORS.null };
  if (typeof value === "string")
    return { display: `"${value}"`, colorClass: TYPE_COLORS.string };
  if (typeof value === "number")
    return { display: String(value), colorClass: TYPE_COLORS.number };
  if (typeof value === "boolean")
    return { display: String(value), colorClass: TYPE_COLORS.boolean };
  return { display: JSON.stringify(value), colorClass: TYPE_COLORS.string };
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
  dataType,
  dataTypeMap,
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
  const isPrimitive =
    value === null || value === undefined || typeof value !== "object";

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
          <FieldKeyLabel fieldKey={fieldKey} dataType={dataType} />
        )}

        {editing ? (
          <InlinePrimitiveEditor
            initialValue={rawValueForEdit(value)}
            onCommit={(raw) => {
              setEditing(false);
              onEditPrimitive?.(path, parseLiteralValue(raw));
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : (
          <span
            className={cn(
              "font-mono text-xs cursor-default truncate",
              colorClass,
              onEditPrimitive &&
                "cursor-pointer hover:underline decoration-dotted",
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

        {hasPendingEdit && onUndoEdit && (
          <UndoEditButton onUndo={() => { onUndoEdit(path); }} />
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
            <span className={TYPE_COLORS.key}>
              &quot;{fieldKey}&quot;
            </span>
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
        return toSearchableText(childValue)
          .toLowerCase()
          .includes(normalizedSearch);
      })
    : entries.length > 0;

  if (!matchSelf && !hasVisibleChildren) return null;

  const toggleCollapse = () => {
    setCollapsed((prev) => !prev);
  };

  // Edit callbacks are only passed to direct children of the root (depth 0→1).
  // Deeper nodes are read-only because onCellEdit expects a top-level field
  // key and a complete replacement value — editing a nested primitive would
  // overwrite the parent object.
  const childEditPrimitive = depth === 0 ? onEditPrimitive : undefined;
  const childEditSubtree = depth === 0 ? onEditSubtree : undefined;

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
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          aria-expanded={!isCollapsed}
          className="w-4 shrink-0 flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
          onClick={toggleCollapse}
        >
          <span className="text-[10px] leading-none select-none">
            {isCollapsed ? "\u25B6" : "\u25BC"}
          </span>
        </button>

        {fieldKey !== undefined && (
          <FieldKeyLabel fieldKey={fieldKey} dataType={dataType} />
        )}

        <span className={cn("font-mono text-xs", TYPE_COLORS.bracket)}>
          {openBracket}
        </span>

        {isCollapsed && (
          <>
            <span className="font-mono text-xs text-muted-foreground/50 mx-0.5">
              {itemCount}{" "}
              {isArray
                ? itemCount === 1
                  ? "item"
                  : "items"
                : itemCount === 1
                  ? "field"
                  : "fields"}
            </span>
            <span className={cn("font-mono text-xs", TYPE_COLORS.bracket)}>
              {closeBracket}
            </span>
            <span
              className={cn("font-mono text-xs", TYPE_COLORS.punctuation)}
            >
              {comma}
            </span>
          </>
        )}

        {/* Edit button for object/array (visible on hover) */}
        {onEditSubtree && (
          <button
            type="button"
            aria-label="Edit value"
            className="inline-flex items-center justify-center cursor-pointer"
            onClick={() => {
              onEditSubtree(path, value);
            }}
          >
            <IconPencil className="h-3 w-3 ml-1 shrink-0 text-muted-foreground/0 group-hover/line:text-muted-foreground/50 transition-colors" />
          </button>
        )}

        {hasPendingEdit && onUndoEdit && (
          <UndoEditButton onUndo={() => { onUndoEdit(path); }} />
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
                fieldKey={key}
                value={childValue}
                depth={depth + 1}
                path={childPath}
                normalizedSearch={normalizedSearch}
                isLast={index === entries.length - 1}
                onEditPrimitive={childEditPrimitive}
                onEditSubtree={childEditSubtree}
                pendingEditPaths={pendingEditPaths}
                onUndoEdit={onUndoEdit}
                dataType={dataTypeMap?.get(key)}
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
            <span
              className={cn("font-mono text-xs", TYPE_COLORS.punctuation)}
            >
              {comma}
            </span>
          </div>
        </>
      )}
    </>
  );
});
