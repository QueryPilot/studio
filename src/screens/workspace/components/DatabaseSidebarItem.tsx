import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SidebarSectionProps {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  stickyClass?: string;
}

export function SidebarSection({
  title,
  count,
  isExpanded,
  onToggle,
  children,
  stickyClass = "sticky top-0 bg-background z-20",
}: SidebarSectionProps) {
  return (
    <div>
      <div className={stickyClass}>
        <button
          className="flex items-center gap-1.5 w-full text-left bg-muted/50 p-1.5 rounded text-xs backdrop-blur-md text-foreground/80 dark:text-foreground/70"
          onClick={onToggle}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="font-medium text-xs">{title}</span>
          <span className="text-xs text-muted-foreground ml-auto">{count}</span>
        </button>
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
  onClick: () => void;
  rowCount?: number | null;
  actions?: ReactNode;
  className?: string;
}

export function SidebarItem({
  icon,
  name,
  isActive,
  onClick,
  rowCount,
  actions,
  className,
}: SidebarItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 p-1 hover:bg-muted/50 cursor-pointer overflow-hidden border-l-2",
        isActive
          ? "bg-primary/10 border-l-primary rounded-r"
          : "rounded border-l-transparent",
        className,
      )}
      onClick={onClick}
    >
      {icon}
      <span className="text-xs truncate flex-1 min-w-0 text-foreground/80 dark:text-foreground/70">
        {name}
      </span>
      {rowCount != null && rowCount > 0 && (
        <span className="text-xs text-muted-foreground flex-shrink-0 transition-all duration-200 ease-out">
          ~{rowCount.toLocaleString()}
        </span>
      )}
      {actions && (
        <div className="flex items-center gap-0.5 flex-shrink-0 transition-all delay-150 duration-200 ease-out -mr-10 opacity-0 group-hover:opacity-100 group-hover:mr-1">
          {actions}
        </div>
      )}
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
