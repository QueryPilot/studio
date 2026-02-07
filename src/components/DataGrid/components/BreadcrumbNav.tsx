import { memo, useCallback, useMemo } from "react";
import {
  IconChevronRight,
  IconHome,
  IconBrackets,
  IconList,
  IconArrowUp,
  IconCopy,
  IconFileDescription,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { PathSegment } from "../sources/types";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";

interface BreadcrumbNavProps {
  path: PathSegment[];
  collectionName: string;
  documentId?: unknown;
  onNavigate: (pathIndex: number) => void;
  onNavigateToRoot: () => void;
  onStepOut?: () => void;
  className?: string;
}

type BreadcrumbItem =
  | { kind: "segment"; segment: PathSegment; originalIndex: number }
  | { kind: "ellipsis" };

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
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
  documentId,
  onNavigate,
  onNavigateToRoot,
  onStepOut,
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

  const formatDocumentId = useCallback((id: unknown): string => {
    if (id === null || id === undefined) return "unknown";
    const raw = typeof id === "string" ? id : JSON.stringify(id);
    if (raw.length <= 18) return raw;
    return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
  }, []);

  const fullPathText = [
    collectionName,
    ...(documentId !== null && documentId !== undefined
      ? [`document:${toDisplayString(documentId)}`]
      : []),
    ...path.map((segment) => segment.label),
  ].join(" / ");

  const handleCopyPath = useCallback(async () => {
    try {
      await writeClipboardText(fullPathText);
      toast.success("Path copied");
    } catch {
      toast.error("Failed to copy path");
    }
  }, [fullPathText]);

  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    if (path.length <= 4) {
      return path.map((segment, index) => ({
        kind: "segment",
        segment,
        originalIndex: index,
      }));
    }

    const first = path[0];
    if (!first) return [];

    const tailStart = Math.max(path.length - 2, 1);
    const tail = path.slice(tailStart).map((segment, index) => ({
      kind: "segment" as const,
      segment,
      originalIndex: tailStart + index,
    }));

    return [
      { kind: "segment", segment: first, originalIndex: 0 },
      { kind: "ellipsis" },
      ...tail,
    ];
  }, [path]);

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

      {documentId !== null && documentId !== undefined && (
        <div className="flex items-center gap-1">
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground bg-muted/60"
            title={toDisplayString(documentId)}
          >
            <IconFileDescription className="h-3 w-3" />
            <span>{`Document(${formatDocumentId(documentId)})`}</span>
          </span>
        </div>
      )}

      {breadcrumbItems.map((item, itemIndex) => {
        if (item.kind === "ellipsis") {
          return (
            <div key={`ellipsis-${itemIndex}`} className="flex items-center gap-1">
              <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="px-1 text-muted-foreground/70">…</span>
            </div>
          );
        }
        const { segment, originalIndex } = item;
        return (
        <div
          key={`${String(segment.key)}-${originalIndex}-${itemIndex}`}
          className="flex items-center gap-1"
        >
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          <button
            type="button"
            onClick={() => {
              handleSegmentClick(originalIndex);
            }}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md",
              "hover:bg-accent transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              originalIndex === path.length - 1
                ? "text-foreground font-medium bg-accent/50"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={segment.label}
          >
            <SegmentIcon type={segment.type} />
            <span className="truncate max-w-[100px]">{segment.label}</span>
          </button>
        </div>
      )})}

      {path.length > 0 && (
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {onStepOut && (
            <button
              type="button"
              onClick={onStepOut}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Step out one level"
            >
              <IconArrowUp className="h-3.5 w-3.5" />
              <span>Up</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleRootClick}
            className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back to collection root"
          >
            Root
          </button>
          <button
            type="button"
            onClick={() => void handleCopyPath()}
            className="px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Copy current path"
          >
            <IconCopy className="h-3.5 w-3.5" />
          </button>
          <div className="text-xs text-muted-foreground/70">
            Depth: {path.length}
          </div>
        </div>
      )}
    </nav>
  );
});
