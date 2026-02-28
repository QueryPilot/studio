import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  IconChevronDown,
  IconChevronRight,
  IconStar,
  IconCopy,
  IconSelect,
  IconArrowsMaximize,
  IconArrowsMinimize,
} from "@tabler/icons-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDraggable } from "@dnd-kit/core";
import type { TableMeta, FunctionMeta } from "@/services/databaseService";

interface SidebarSectionProps {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  stickyClass?: string;
  onAdd?: () => void;
  addTooltip?: string;
  /** Context menu handlers */
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onSelectAll?: () => void;
  onCopyAllNames?: () => void;
}

export function SidebarSection({
  title,
  count,
  isExpanded,
  onToggle,
  children,
  stickyClass = "sticky top-0 bg-background z-20",
  onAdd,
  addTooltip,
  onExpandAll,
  onCollapseAll,
  onSelectAll,
  onCopyAllNames,
}: SidebarSectionProps) {
  const hasContextMenu = onExpandAll || onCollapseAll || onSelectAll || onCopyAllNames;

  const headerContent = (
    <div className="flex items-center bg-muted/50 rounded-l text-xs text-foreground/80 dark:text-foreground/70">
      <button
        className="flex items-center gap-1.5 flex-1 text-left p-1.5"
        onClick={onToggle}
      >
        {isExpanded ? (
          <IconChevronDown className="h-4 w-4" />
        ) : (
          <IconChevronRight className="h-4 w-4" />
        )}
        <span className="font-medium text-xs">{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {count}
        </span>
      </button>
      {onAdd && (
        <button
          className="p-1 mr-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          title={addTooltip || `Add ${title.slice(0, -1)}`}
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <div>
      <div className={cn(stickyClass, "group/section")}>
        {hasContextMenu ? (
          <ContextMenu>
            <ContextMenuTrigger render={headerContent} />
            <ContextMenuContent>
              {onExpandAll && (
                <ContextMenuItem onClick={onExpandAll}>
                  <IconArrowsMaximize className="h-4 w-4 mr-2" />
                  Expand All {title}
                </ContextMenuItem>
              )}
              {onCollapseAll && (
                <ContextMenuItem onClick={onCollapseAll}>
                  <IconArrowsMinimize className="h-4 w-4 mr-2" />
                  Collapse All {title}
                </ContextMenuItem>
              )}
              {(onExpandAll || onCollapseAll) && (onSelectAll || onCopyAllNames) && (
                <ContextMenuSeparator />
              )}
              {onSelectAll && (
                <ContextMenuItem onClick={onSelectAll}>
                  <IconSelect className="h-4 w-4 mr-2" />
                  Select All {title}
                </ContextMenuItem>
              )}
              {onCopyAllNames && (
                <ContextMenuItem onClick={onCopyAllNames}>
                  <IconCopy className="h-4 w-4 mr-2" />
                  Copy All Names
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          headerContent
        )}
      </div>
      {isExpanded && (
        <div className="ml-3.5 mt-0.5 space-y-0.5 pl-2 pr-1 overflow-x-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

interface SidebarItemProps {
  icon: ReactNode;
  name: string;
  isActive: boolean;
  onClick: (e: React.MouseEvent) => void;
  rowCount?: number | null;
  actions?: ReactNode;
  className?: string;
  isStarred?: boolean;
  onToggleStar?: (e: React.MouseEvent) => void;
  hasPendingChanges?: boolean;
  pendingChangeVariant?: "standard" | "destructive";
  isSelected?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isBeingDuplicated?: boolean; // New: indicates this table is the source of a duplicate operation
  // Expandable item props
  isExpandable?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;
  level?: number; // Nesting level (0 = top-level)
  badge?: string; // Badge text (e.g., partition type)
}

export function SidebarItem({
  icon,
  name,
  isActive,
  onClick,
  rowCount,
  actions,
  className,
  isStarred = false,
  onToggleStar,
  hasPendingChanges = false,
  pendingChangeVariant = "standard",
  isSelected = false,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
  isBeingDuplicated = false,
  isExpandable = false,
  isExpanded = false,
  onToggleExpand,
  level = 0,
  badge,
}: SidebarItemProps) {
  const paddingLeft = level > 0 ? `${level * 12}px` : undefined;
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  const isDestructivePending =
    hasPendingChanges && pendingChangeVariant === "destructive";

  return (
    <div
      ref={itemRef}
      data-testid="sidebar-item-root"
      className={cn(
        "group flex items-center gap-1.5 p-1 hover:bg-muted/50 cursor-pointer overflow-hidden border-l-2",
        isActive
          ? "bg-primary/10 border-l-primary"
          : isSelected
            ? "bg-primary/20 border-l-primary/70"
            : isBeingDuplicated
              ? "bg-blue-500/10 border-l-blue-500"
              : isDestructivePending
                ? "bg-destructive/10 border-l-destructive"
              : "border-l-transparent",
        className,
      )}
      style={{ paddingLeft }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
    >
      {hasPendingChanges ? (
        <span className="relative flex h-2 w-2 shrink-0 ml-1">
          <span
            data-testid="pending-indicator-pulse"
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              isDestructivePending ? "bg-destructive/70" : "bg-orange-400",
            )}
          ></span>
          <span
            data-testid="pending-indicator-dot"
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              isDestructivePending ? "bg-destructive" : "bg-orange-500",
            )}
          ></span>
        </span>
      ) : isBeingDuplicated ? (
        <span className="relative flex h-2 w-2 shrink-0 ml-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
        </span>
      ) : (
        icon
      )}
      <span className="text-xs truncate flex-1 min-w-0 text-foreground/80 dark:text-foreground/70">
        {name}
      </span>
      {badge && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
          {badge}
        </span>
      )}
      {/* Expand/collapse chevron on the right for expandable items */}
      {isExpandable && onToggleExpand && (
        <button
          className="p-0.5 hover:bg-muted rounded shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(e);
          }}
          title={isExpanded ? "Collapse partitions" : "Show partitions"}
        >
          {isExpanded ? (
            <IconChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <IconChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      )}
      {rowCount != null && rowCount > 0 && (
        <span className="text-xs text-muted-foreground shrink-0 transition-all duration-200 ease-out">
          ~{rowCount.toLocaleString()}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0 transition-all delay-150 duration-200 ease-out -mr-14 opacity-0 group-hover:opacity-100 group-hover:mr-1">
        {onToggleStar && (
          <button
            className="p-0.5 hover:bg-muted rounded"
            onClick={onToggleStar}
            title={isStarred ? "Unstar" : "Star"}
          >
            <IconStar
              className={cn(
                "h-3 w-3",
                isStarred
                  ? "fill-yellow-500 text-yellow-500"
                  : "text-muted-foreground hover:text-foreground",
              )}
            />
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag data type for sidebar items
// ---------------------------------------------------------------------------

export interface SidebarItemDragData {
  type: "sidebar-item";
  objectType: "table" | "view" | "function" | "procedure" | "mongo-collection" | "redis-key" | "erd" | "history";
  name: string;
  table?: TableMeta;
  func?: FunctionMeta;
  connectionId: string;
  database: string;
  schema: string;
  kind?: "Table" | "View" | "MaterializedView";
  /** Redis database number (for redis-key objectType) */
  redisDb?: number;
  /** Connection display name (for erd objectType) */
  connectionName?: string;
  /** History entry data (for history objectType) */
  historyQuery?: string;
}

// ---------------------------------------------------------------------------
// DraggableSidebarItem - wraps SidebarItem children with useDraggable
// ---------------------------------------------------------------------------

interface DraggableSidebarItemProps {
  /** Unique draggable ID for dnd-kit (must be unique across all draggables) */
  dragId: string;
  /** Drag data payload describing the sidebar object */
  dragData: SidebarItemDragData;
  children: ReactNode;
}

/**
 * Wrapper that makes a sidebar item draggable via @dnd-kit.
 * Applies `useDraggable` listeners and ref to an outer div.
 * The distance activation constraint (8px) on the PointerSensor in
 * WorkbenchDndProvider ensures clicks still work normally.
 */
export function DraggableSidebarItem({
  dragId,
  dragData,
  children,
}: DraggableSidebarItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionButton
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  icon: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
}

export function ActionButton({ icon, onClick, title }: ActionButtonProps) {
  return (
    <button
      className="p-0.5 hover:bg-muted rounded"
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}
