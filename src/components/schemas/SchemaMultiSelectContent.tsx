/**
 * SchemaMultiSelectContent.tsx
 *
 * Reusable popover body for selecting visible schemas.
 * Extracted from SchemaDropdown so that SchemaPill can reuse the same UI.
 *
 * Changes auto-apply immediately on toggle, drag-reorder, or set-primary.
 * Click a visible schema's label to set it as PRIMARY (index 0).
 */

import { logger } from "@/lib/logger";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  IconLoader2,
  IconSearch,
  IconGripVertical,
} from "@tabler/icons-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { databaseService } from "@/services/databaseService";
import { PrimaryBadge } from "@/components/badges/PrimaryBadge";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

export interface SchemaMultiSelectContentProps {
  connectionId: string;
  database: string;
  /** Initial selection and order; component manages local draft state. */
  initialSchemas: string[];
  /** Called with the ordered list when selection changes. Auto-applied on every change. */
  onApply: (schemas: string[]) => void | Promise<void>;
  /** Optional footer slot; used by the tab pill to render
   *  "Apply to connection instead". */
  footerSlot?: React.ReactNode;
  /** Label at the popover header (e.g. "This tab" vs "Connection"). */
  scopeLabel: string;
  /**
   * When true, empty selection is allowed.
   * Used for Trino, which allows an empty visible_schemas list (catalog-only visibility).
   */
  allowEmptySelection?: boolean;
}

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

interface SortableRowProps {
  id: string;
  schema: string;
  isPrimary: boolean;
  onRemove: (schema: string) => void;
  onSetPrimary: (schema: string) => void;
}

function SortableRow({ id, schema, isPrimary, onRemove, onSetPrimary }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground shrink-0"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${schema}`}
      >
        <IconGripVertical className="h-3.5 w-3.5" />
      </button>
      <Checkbox
        id={`sel-${schema}`}
        checked
        onCheckedChange={() => {
          onRemove(schema);
        }}
        aria-label={schema}
      />
      <button
        type="button"
        className="text-xs flex-1 cursor-pointer truncate text-left hover:underline"
        onClick={() => onSetPrimary(schema)}
        title={isPrimary ? "Primary schema" : "Click to set as primary"}
      >
        {schema}
      </button>
      {isPrimary && <PrimaryBadge className="shrink-0" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function SchemaMultiSelectContent({
  connectionId,
  database,
  initialSchemas,
  onApply,
  footerSlot,
  scopeLabel,
  allowEmptySelection = false,
}: SchemaMultiSelectContentProps) {
  const [searchText, setSearchText] = useState("");
  const [allSchemas, setAllSchemas] = useState<string[]>([]);
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [selected, setSelected] = useState<string[]>(initialSchemas);
  const applyingRef = useRef(false);

  // Re-sync local draft when initialSchemas prop changes (e.g. popover re-opens)
  useEffect(() => {
    setSelected(initialSchemas);
  }, [initialSchemas]);

  // Load all available schemas
  useEffect(() => {
    if (!database) return;
    setIsLoadingSchemas(true);
    databaseService
      .listSchemas(connectionId, database)
      .then((schemas) => {
        setAllSchemas(schemas);
      })
      .catch((err: unknown) => {
        logger.error("SchemaMultiSelectContent: failed to load schemas", err);
        setAllSchemas([]);
      })
      .finally(() => {
        setIsLoadingSchemas(false);
      });
  }, [connectionId, database]);

  // Auto-apply helper — debounce-free, fire-and-forget with error toast
  const doApply = useCallback(
    (next: string[]) => {
      if (next.length === 0 && !allowEmptySelection) return;
      if (applyingRef.current) return; // skip if a previous apply is still in-flight
      applyingRef.current = true;
      const result = onApply(next);
      if (result && typeof result.then === "function") {
        result
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : "Failed to apply schemas";
            logger.error("SchemaMultiSelectContent: auto-apply failed", err);
            toast.error(message);
          })
          .finally(() => {
            applyingRef.current = false;
          });
      } else {
        applyingRef.current = false;
      }
    },
    [onApply, allowEmptySelection],
  );

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setSelected((prev) => {
          const oldIndex = prev.indexOf(active.id as string);
          const newIndex = prev.indexOf(over.id as string);
          const next = arrayMove(prev, oldIndex, newIndex);
          doApply(next);
          return next;
        });
      }
    },
    [doApply],
  );

  const toggleSchema = useCallback(
    (schema: string) => {
      setSelected((prev) => {
        const next = prev.includes(schema)
          ? prev.filter((s) => s !== schema)
          : [...prev, schema];
        doApply(next);
        return next;
      });
    },
    [doApply],
  );

  const removeSelected = useCallback(
    (schema: string) => {
      setSelected((prev) => {
        const next = prev.filter((s) => s !== schema);
        if (next.length === 0 && !allowEmptySelection) return prev; // prevent empty
        doApply(next);
        return next;
      });
    },
    [doApply, allowEmptySelection],
  );

  const setPrimary = useCallback(
    (schema: string) => {
      setSelected((prev) => {
        if (prev[0] === schema) return prev; // already primary
        const next = [schema, ...prev.filter((s) => s !== schema)];
        doApply(next);
        return next;
      });
    },
    [doApply],
  );

  const searchLower = searchText.toLowerCase().trim();
  const unselected = allSchemas.filter(
    (s) =>
      !selected.includes(s) &&
      (searchLower === "" || s.toLowerCase().includes(searchLower)),
  );
  const selectedFiltered = selected.filter(
    (s) => searchLower === "" || s.toLowerCase().includes(searchLower),
  );

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* Scope header */}
      <p className="px-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        {scopeLabel}
      </p>

      {/* Search */}
      <div className="relative">
        <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search schemas…"
          className="h-7 pl-6 text-xs"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
        />
      </div>

      {/* Selected (sortable) */}
      {selectedFiltered.length > 0 && (
        <div className="mt-1">
          <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
            Visible
          </p>
          <div className="max-h-[160px] overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={selectedFiltered}
              strategy={verticalListSortingStrategy}
            >
              {selectedFiltered.map((schema, idx) => (
                <SortableRow
                  key={schema}
                  id={schema}
                  schema={schema}
                  isPrimary={idx === 0 && selected[0] === schema}
                  onRemove={removeSelected}
                  onSetPrimary={setPrimary}
                />
              ))}
            </SortableContext>
          </DndContext>
          </div>
        </div>
      )}

      {/* Unselected */}
      {isLoadingSchemas ? (
        <div className="flex items-center justify-center py-3">
          <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : unselected.length === 0 && selectedFiltered.length === 0 && searchLower !== "" ? (
        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
          No schemas matching &ldquo;{searchText.trim()}&rdquo;
        </div>
      ) : unselected.length > 0 ? (
        <div className="mt-1">
          <p className="px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
            Available
          </p>
          <div className="max-h-[160px] overflow-y-auto">
            {unselected.map((schema) => (
              <div
                key={schema}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50"
              >
                <Checkbox
                  id={`avail-${schema}`}
                  checked={false}
                  onCheckedChange={() => {
                    toggleSchema(schema);
                  }}
                  aria-label={schema}
                />
                <label
                  htmlFor={`avail-${schema}`}
                  className="text-xs flex-1 cursor-pointer truncate"
                >
                  {schema}
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Optional footer slot (e.g. "Apply to connection instead") */}
      {footerSlot && <div className="mt-1">{footerSlot}</div>}
    </div>
  );
}
