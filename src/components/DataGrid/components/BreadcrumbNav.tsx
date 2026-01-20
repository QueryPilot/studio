import { memo, useCallback } from "react";
import {
  IconChevronRight,
  IconHome,
  IconBrackets,
  IconList,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { PathSegment } from "../sources/types";

interface BreadcrumbNavProps {
  path: PathSegment[];
  collectionName: string;
  onNavigate: (pathIndex: number) => void;
  onNavigateToRoot: () => void;
  className?: string;
}

const SegmentIcon = memo(function SegmentIcon({
  type,
}: {
  type: PathSegment["type"];
}) {
  switch (type) {
    case "array":
      return <IconList className="h-3 w-3" />;
    case "object":
      return <IconBrackets className="h-3 w-3" />;
    default:
      return null;
  }
});

export const BreadcrumbNav = memo(function BreadcrumbNav({
  path,
  collectionName,
  onNavigate,
  onNavigateToRoot,
  className,
}: BreadcrumbNavProps) {
  const handleRootClick = useCallback(() => {
    onNavigateToRoot();
  }, [onNavigateToRoot]);

  const handleSegmentClick = useCallback(
    (index: number) => {
      onNavigate(index);
    },
    [onNavigate],
  );

  return (
    <nav
      className={cn(
        "flex items-center gap-1 text-xs font-mono overflow-x-auto",
        className,
      )}
      aria-label="Document path"
    >
      <button
        type="button"
        onClick={handleRootClick}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md",
          "hover:bg-accent transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          path.length === 0
            ? "text-foreground font-medium bg-accent/50"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <IconHome className="h-3.5 w-3.5" />
        <span className="truncate max-w-[120px]" title={collectionName}>
          {collectionName}
        </span>
      </button>

      {path.map((segment, index) => (
        <div
          key={`${segment.key}-${index}`}
          className="flex items-center gap-1"
        >
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <button
            type="button"
            onClick={() => {
              handleSegmentClick(index);
            }}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md",
              "hover:bg-accent transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              index === path.length - 1
                ? "text-foreground font-medium bg-accent/50"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={segment.label}
          >
            <SegmentIcon type={segment.type} />
            <span className="truncate max-w-[100px]">{segment.label}</span>
          </button>
        </div>
      ))}

      {path.length > 0 && (
        <div className="ml-auto text-xs text-muted-foreground/70 shrink-0">
          Depth: {path.length}
        </div>
      )}
    </nav>
  );
});
