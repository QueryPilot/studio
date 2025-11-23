import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconChevronDown, IconChevronRight, IconStar } from '@tabler/icons-react';

interface SidebarSectionProps {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  stickyClass?: string;
  onAdd?: () => void;
  addTooltip?: string;
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
}: SidebarSectionProps) {
  return (
    <div>
      <div className={cn(stickyClass, "group/section")}>
        <div className="flex items-center bg-muted/50 rounded text-xs text-foreground/80 dark:text-foreground/70">
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
      </div>
      {isExpanded && (
        <div className="ml-3.5 mt-0.5 space-y-0.5 px-2 overflow-x-hidden">
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
  isSelected?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
  isSelected = false,
  onMouseDown,
  onMouseEnter,
  onContextMenu,
}: SidebarItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 p-1 hover:bg-muted/50 cursor-pointer overflow-hidden border-l-2",
        isActive
          ? "bg-primary/10 border-l-primary rounded-r"
          : isSelected
          ? "bg-primary/20 border-l-primary/70 rounded-r"
          : "rounded border-l-transparent",
        className,
      )}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onContextMenu={onContextMenu}
    >
      {hasPendingChanges ? (
        <span className="relative flex h-2 w-2 flex-shrink-0 ml-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
        </span>
      ) : (
        icon
      )}
      <span className="text-xs truncate flex-1 min-w-0 text-foreground/80 dark:text-foreground/70">
        {name}
      </span>
      {rowCount != null && rowCount > 0 && (
        <span className="text-xs text-muted-foreground flex-shrink-0 transition-all duration-200 ease-out">
          ~{rowCount.toLocaleString()}
        </span>
      )}
      <div className="flex items-center gap-0.5 flex-shrink-0 transition-all delay-150 duration-200 ease-out -mr-14 opacity-0 group-hover:opacity-100 group-hover:mr-1">
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
