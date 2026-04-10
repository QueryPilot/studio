import { memo, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconCopy,
  IconChevronRight,
  IconChevronDown,
  IconClock,
  IconX,
} from "@tabler/icons-react";
import { writeClipboardText } from "@/lib/clipboard";
import { toast } from "sonner";
import type { DuckDbQueryPlan } from "@/services/backend";

interface DuckDbQueryPlanPanelProps {
  plan: DuckDbQueryPlan;
  onClose?: () => void;
  className?: string;
}

const HIGHLIGHT_KEYWORDS: Record<string, string> = {
  UNGROUPED_AGGREGATE: "text-pink-500",
  HASH_GROUP_BY: "text-pink-500",
  PERFECT_HASH_GROUP_BY: "text-pink-500",
  SEQ_SCAN: "text-orange-500",
  TABLE_SCAN: "text-orange-500",
  FILTER: "text-yellow-500",
  PROJECTION: "text-blue-400",
  HASH_JOIN: "text-cyan-500",
  PIECEWISE_MERGE_JOIN: "text-cyan-500",
  NESTED_LOOP_JOIN: "text-cyan-500",
  CROSS_PRODUCT: "text-cyan-500",
  ORDER_BY: "text-blue-500",
  TOP_N: "text-blue-500",
  LIMIT: "text-gray-400",
  STREAMING_LIMIT: "text-gray-400",
  UNION: "text-purple-500",
  EXCEPT: "text-purple-500",
  INTERSECT: "text-purple-500",
  INDEX_SCAN: "text-green-500",
  CREATE_TABLE: "text-amber-500",
  INSERT: "text-amber-500",
  UPDATE: "text-amber-500",
  DELETE: "text-amber-500",
  WINDOW: "text-violet-500",
  DISTINCT: "text-teal-500",
  CTE_SCAN: "text-amber-400",
  RECURSIVE_CTE: "text-amber-400",
  DELIM_SCAN: "text-gray-400",
  COLUMN_DATA_SCAN: "text-orange-400",
  CHUNK_SCAN: "text-orange-400",
};

function highlightPlanLine(line: string): React.ReactNode {
  const timingMatch = line.match(/(\d+\.\d+)\s*s?\s*$/);
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  for (const [keyword, colorClass] of Object.entries(HIGHLIGHT_KEYWORDS)) {
    const idx = remaining.toUpperCase().indexOf(keyword);
    if (idx !== -1) {
      if (idx > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
      }
      parts.push(
        <span key={key++} className={cn("font-semibold", colorClass)}>
          {remaining.slice(idx, idx + keyword.length)}
        </span>,
      );
      remaining = remaining.slice(idx + keyword.length);
      break;
    }
  }

  if (parts.length === 0) {
    if (timingMatch?.[1]) {
      const timeStr = timingMatch[0];
      const timeVal = parseFloat(timingMatch[1]);
      const beforeTime = line.slice(0, line.length - timeStr.length);
      const timeColor =
        timeVal > 1.0
          ? "text-red-500 font-bold"
          : timeVal > 0.1
            ? "text-orange-400 font-medium"
            : timeVal > 0.01
              ? "text-yellow-500"
              : "text-muted-foreground";
      return (
        <>
          <span>{beforeTime}</span>
          <span className={timeColor}>{timeStr}</span>
        </>
      );
    }
    return <span>{line}</span>;
  }

  if (remaining) {
    if (timingMatch?.[1] && remaining.endsWith(timingMatch[0])) {
      const timeStr = timingMatch[0];
      const timeVal = parseFloat(timingMatch[1]);
      const beforeTime = remaining.slice(0, remaining.length - timeStr.length);
      const timeColor =
        timeVal > 1.0
          ? "text-red-500 font-bold"
          : timeVal > 0.1
            ? "text-orange-400 font-medium"
            : timeVal > 0.01
              ? "text-yellow-500"
              : "text-muted-foreground";
      parts.push(<span key={key}>{beforeTime}</span>);
      parts.push(
        <span key={key + 1} className={timeColor}>
          {timeStr}
        </span>,
      );
    } else {
      parts.push(<span key={key}>{remaining}</span>);
    }
  }

  return <>{parts}</>;
}

function JsonTreeNode({
  label,
  value,
  depth = 0,
}: {
  label: string;
  value: unknown;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const isObject =
    value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isExpandable = isObject || isArray;

  if (!isExpandable) {
    return (
      <div className="flex gap-1 py-0.5" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground">{label}:</span>
        <span className="text-foreground">
          {value === null
            ? "null"
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value as string | number | boolean)}
        </span>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <button
        className="flex items-center gap-0.5 py-0.5 hover:bg-muted/50 w-full text-left text-xs"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => { setExpanded(!expanded); }}
      >
        {expanded ? (
          <IconChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <IconChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/60 ml-1">
          {isArray ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {expanded &&
        entries.map(([k, v]) => (
          <JsonTreeNode key={k} label={k} value={v} depth={depth + 1} />
        ))}
    </div>
  );
}

export const DuckDbQueryPlanPanel = memo(function DuckDbQueryPlanPanel({
  plan,
  onClose,
  className,
}: DuckDbQueryPlanPanelProps) {
  const [viewMode, setViewMode] = useState<"text" | "json">(
    plan.planJson ? "json" : "text",
  );

  const handleCopy = useCallback(() => {
    void writeClipboardText(plan.planText).then(() => {
      toast.success("Plan copied to clipboard");
    });
  }, [plan.planText]);

  const lines = useMemo(() => plan.planText.split("\n"), [plan.planText]);

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            Query Plan
          </span>
          {plan.totalTimeMs != null && (
            <Badge variant="secondary" className="text-[10px] h-4 gap-1">
              <IconClock className="h-2.5 w-2.5" />
              {plan.totalTimeMs < 1
                ? `${(plan.totalTimeMs * 1000).toFixed(0)}μs`
                : plan.totalTimeMs < 1000
                  ? `${plan.totalTimeMs.toFixed(1)}ms`
                  : `${(plan.totalTimeMs / 1000).toFixed(2)}s`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {plan.planJson && (
            <div className="flex items-center rounded-md border text-[10px]">
              <button
                className={cn(
                  "px-2 py-0.5 rounded-l-md transition-colors",
                  viewMode === "text"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
                onClick={() => { setViewMode("text"); }}
              >
                Text
              </button>
              <button
                className={cn(
                  "px-2 py-0.5 rounded-r-md transition-colors",
                  viewMode === "json"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
                onClick={() => { setViewMode("json"); }}
              >
                JSON
              </button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="!h-5 !w-5 !p-0"
            onClick={handleCopy}
            title="Copy plan text"
          >
            <IconCopy className="h-3 w-3" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="!h-5 !w-5 !p-0"
              onClick={onClose}
              title="Close"
            >
              <IconX className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {viewMode === "text" ? (
          <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre overflow-x-auto">
            {lines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "hover:bg-muted/30 transition-colors",
                  line.trim() === "" && "h-2",
                )}
              >
                {highlightPlanLine(line)}
              </div>
            ))}
          </pre>
        ) : plan.planJson ? (
          <div className="p-3 text-[11px] font-mono">
            <JsonTreeNode label="plan" value={plan.planJson} />
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">
            No JSON plan available
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
