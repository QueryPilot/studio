import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Column {
  name: string;
  db_type: string;
}

interface ColumnSelectorProps {
  value: string[];
  onChange: (columns: string[]) => void;
  availableColumns: Column[];
  placeholder?: string;
  className?: string;
}

interface SortableColumnItemProps {
  column: Column;
  isSelected: boolean;
  onToggle: () => void;
}

const SortableColumnItem = memo(function SortableColumnItem({
  column,
  isSelected,
  onToggle,
}: SortableColumnItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-1 rounded hover:bg-muted/50 text-xs",
        isDragging && "opacity-50"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-move"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        className="h-3.5 w-3.5"
      />
      <span className="flex-1 whitespace-nowrap select-none">
        {column.name}
        <span className="text-muted-foreground ml-1">
          ({column.db_type})
        </span>
      </span>
    </div>
  );
});

export const ColumnSelector = memo(function ColumnSelector({
  value,
  onChange,
  availableColumns,
  placeholder = "Select columns...",
  className,
}: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const toggleColumn = (columnName: string) => {
    if (value.includes(columnName)) {
      onChange(value.filter(c => c !== columnName));
    } else {
      onChange([...value, columnName]);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // Check if we're moving between groups
    if (overId === "indexed-group" || overId === "available-group") {
      const isCurrentlySelected = value.includes(activeId);

      if (overId === "indexed-group" && !isCurrentlySelected) {
        // Moving to indexed group
        onChange([...value, activeId]);
      } else if (overId === "available-group" && isCurrentlySelected) {
        // Moving to available group
        onChange(value.filter(c => c !== activeId));
      }
    } else if (active.id !== over.id) {
      // Reordering within the same group
      const isActiveSelected = value.includes(activeId);
      const isOverSelected = value.includes(overId);

      if (isActiveSelected && isOverSelected) {
        // Both are in the selected group, reorder them
        const oldIndex = value.indexOf(activeId);
        const newIndex = value.indexOf(overId);

        if (oldIndex !== -1 && newIndex !== -1) {
          onChange(arrayMove(value, oldIndex, newIndex));
        }
      } else if (!isActiveSelected && isOverSelected) {
        // Dragging from available to indexed (on top of another indexed item)
        const targetIndex = value.indexOf(overId);
        const newValue = [...value];
        newValue.splice(targetIndex, 0, activeId);
        onChange(newValue);
      } else if (isActiveSelected && !isOverSelected) {
        // Dragging from indexed to available (on top of another available item)
        onChange(value.filter(c => c !== activeId));
      }
    }

    setActiveId(null);
  };

  const filteredColumns = availableColumns.filter(col =>
    col.name.toLowerCase().includes(search.toLowerCase()) ||
    col.db_type.toLowerCase().includes(search.toLowerCase())
  );

  const selectedColumns = value
    .map(name => availableColumns.find(c => c.name === name))
    .filter(Boolean) as Column[];

  const unselectedColumns = filteredColumns.filter(col => !value.includes(col.name));

  // Combine all columns for DnD context
  const allColumnIds = [...value, ...unselectedColumns.map(c => c.name)];

  const activeColumn = activeId
    ? availableColumns.find(c => c.name === activeId)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-5 justify-between text-xs px-1 outline-none focus:ring-0", className)}
        >
          <span className="truncate">
            {value.length > 0
              ? value.join(", ")
              : placeholder}
          </span>
          <ChevronDown className="ml-1 h-2.5 w-2.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="space-y-2">
          <Input
            placeholder="Search columns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={allColumnIds}
              strategy={verticalListSortingStrategy}
            >
              <ScrollArea className="h-64">
                <div className="space-y-3">
                  {/* Indexed Columns Group */}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Indexed columns ({selectedColumns.length})
                    </div>
                    <div
                      id="indexed-group"
                      className={cn(
                        "min-h-[32px] rounded-md border border-dashed p-1",
                        activeId && !value.includes(activeId) && "border-primary bg-primary/5"
                      )}
                    >
                      {selectedColumns.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-2">
                          Drag columns here or check them below
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {selectedColumns.map((column) => (
                            <SortableColumnItem
                              key={column.name}
                              column={column}
                              isSelected={true}
                              onToggle={() => toggleColumn(column.name)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Available Columns Group */}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Available columns ({unselectedColumns.length})
                    </div>
                    <div
                      id="available-group"
                      className={cn(
                        "min-h-[32px] rounded-md border border-dashed p-1",
                        activeId && value.includes(activeId) && "border-primary bg-primary/5"
                      )}
                    >
                      {unselectedColumns.length === 0 ? (
                        <div className="text-xs text-muted-foreground text-center py-2">
                          {search ? "No matching columns" : "All columns are indexed"}
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {unselectedColumns.map((column) => (
                            <SortableColumnItem
                              key={column.name}
                              column={column}
                              isSelected={false}
                              onToggle={() => toggleColumn(column.name)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </SortableContext>

            <DragOverlay>
              {activeColumn ? (
                <div className="flex items-center gap-2 p-1 rounded bg-background border shadow-lg text-xs">
                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                  <Checkbox
                    checked={value.includes(activeColumn.name)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="whitespace-nowrap">
                    {activeColumn.name}
                    <span className="text-muted-foreground ml-1">
                      ({activeColumn.db_type})
                    </span>
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </PopoverContent>
    </Popover>
  );
});