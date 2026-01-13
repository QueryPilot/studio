/**
 * MongoDB Document Breadcrumb Component
 */

import { IconChevronRight, IconHome } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
  path: string[];
  onNavigate: (path: string[]) => void;
}

export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const handleSegmentClick = (index: number) => {
    if (index === -1) {
      onNavigate([]);
    } else {
      onNavigate(path.slice(0, index + 1));
    }
  };

  return (
    <nav
      className="flex items-center gap-1 text-sm font-mono overflow-x-auto"
      aria-label="Document path"
    >
      <button
        type="button"
        onClick={() => { handleSegmentClick(-1); }}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded hover:bg-accent transition-colors",
          path.length === 0
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <IconHome className="h-3.5 w-3.5" />
        <span>root</span>
      </button>

      {path.map((segment, index) => (
        <div key={index} className="flex items-center gap-1">
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <button
            type="button"
            onClick={() => { handleSegmentClick(index); }}
            className={cn(
              "px-2 py-1 rounded hover:bg-accent transition-colors truncate max-w-[150px]",
              index === path.length - 1
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            title={segment}
          >
            {segment}
          </button>
        </div>
      ))}
    </nav>
  );
}
