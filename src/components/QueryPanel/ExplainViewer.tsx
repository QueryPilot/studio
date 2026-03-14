import React, { memo, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  IconClock,
  IconChevronRight,
  IconChevronDown,
  IconTable,
  IconDatabase,
  IconFilter,
  IconArrowsSort,
  IconStack2,
  IconLayersIntersect,
  IconCopy,
  IconRocket,
  IconBookmark,
  IconGitCompare,
  IconX,
} from "@tabler/icons-react";
import { useTabStateStore } from "@/stores/tabStateStore";
import { PlanDiff } from "./PlanDiff";
import { writeClipboardText } from "@/lib/clipboard";
import type { ExplainNode } from "./explain/types";
import { buildExplainFallbackText } from "./explain/fallback";
import { parseExplain } from "./explain/parseExplain";

interface ExplainViewerProps {
  result: {
    columns: string[];
    rows: unknown[][];
  };
  databaseType?: string;
  className?: string;
  viewMode?: "explain" | "raw" | "stats";
  tabId?: string;
  currentQuery?: string;
}

// ============================================================================
// COLORS & ICONS
// ============================================================================

function getNodeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("seq scan") || t.includes("parallel seq")) return "#f97316"; // orange - expensive
  if (t.includes("bitmap heap")) return "#84cc16"; // lime
  if (t.includes("bitmap") || t.includes("index")) return "#22c55e"; // green - efficient
  if (t.includes("sort") || t.includes("incremental sort")) return "#3b82f6"; // blue
  if (t.includes("hash")) return "#8b5cf6"; // purple
  if (t.includes("join") || t.includes("nested") || t.includes("merge"))
    return "#06b6d4"; // cyan
  if (t.includes("aggregate") || t.includes("group")) return "#ec4899"; // pink
  if (t.includes("gather")) return "#14b8a6"; // teal - parallel
  if (t.includes("limit") || t.includes("result")) return "#6b7280"; // gray
  if (t.includes("cte") || t.includes("subquery")) return "#f59e0b"; // amber
  if (t.includes("materialize") || t.includes("memoize")) return "#a855f7"; // violet
  return "#64748b"; // slate
}

function getNodeIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("seq scan") || t.includes("parallel seq")) return IconTable;
  if (t.includes("index")) return IconDatabase;
  if (t.includes("filter") || t.includes("bitmap")) return IconFilter;
  if (t.includes("sort")) return IconArrowsSort;
  if (t.includes("hash") || t.includes("aggregate")) return IconStack2;
  if (t.includes("join") || t.includes("nested") || t.includes("merge"))
    return IconLayersIntersect;
  return IconTable;
}

// ============================================================================
// TREE VIEW COMPONENTS
// ============================================================================

interface TreeNodeProps {
  node: ExplainNode;
  totalCost: number;
  totalActualTime?: number;
  depth?: number;
  defaultExpanded?: boolean;
}

const TreeNode = memo(function TreeNode({
  node,
  totalCost,
  totalActualTime,
  depth = 0,
  defaultExpanded = true,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children && node.children.length > 0;
  const Icon = getNodeIcon(node.type);

  // Calculate EXCLUSIVE time (node's own time, excluding children)
  // This shows where time is actually spent, not cumulative totals
  const nodeInclusiveTime = node.actualTime
    ? node.actualTime.total * (node.loops || 1)
    : 0;
  const childrenTotalTime =
    node.children?.reduce((sum, child) => {
      const childTime = child.actualTime
        ? child.actualTime.total * (child.loops || 1)
        : 0;
      return sum + childTime;
    }, 0) || 0;
  const nodeExclusiveTime = Math.max(0, nodeInclusiveTime - childrenTotalTime);

  // Use exclusive actual time when available (ANALYZE)
  // Fallback to estimated cost for plain EXPLAIN
  const costPct =
    totalActualTime && totalActualTime > 0 && node.actualTime
      ? (nodeExclusiveTime / totalActualTime) * 100
      : totalCost > 0
        ? ((node.cost?.total || 0) / totalCost) * 100
        : 0;
  const color = getNodeColor(node.type);
  const mysqlSelectType =
    typeof node.selectType === "string" ? node.selectType : undefined;
  const mysqlQueryBlockId =
    typeof node.queryBlockId === "string" ? node.queryBlockId : undefined;
  const mysqlFiltered =
    typeof node.filtered === "number" ? node.filtered : undefined;
  const mysqlRef = typeof node.ref === "string" ? node.ref : undefined;
  const mysqlKeyLen = typeof node.keyLen === "string" ? node.keyLen : undefined;
  const mysqlExtra = typeof node.extra === "string" ? node.extra : undefined;
  const mysqlPossibleKeys = Array.isArray(node.possibleKeys)
    ? node.possibleKeys.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : typeof node.possibleKeys === "string" && node.possibleKeys.length > 0
      ? node.possibleKeys
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex gap-1.5 py-1 px-2 rounded-md hover:bg-muted/50 cursor-pointer group",
          depth > 0 && "ml-4",
        )}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/Collapse - aligned with first line */}
        <div className="w-4 h-5 flex items-center justify-center shrink-0">
          {hasChildren ? (
            expanded ? (
              <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
          )}
        </div>

        {/* Icon - aligned with first line */}
        <div
          className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-px"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-3 w-3" style={{ color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div
            className={cn("flex items-center gap-2", {
              "mt-[3px]":
                !node.cost &&
                !node.rows &&
                !node.width &&
                !node.actualTime &&
                !node.actualRows &&
                !node.loops &&
                !node.indexName &&
                !mysqlSelectType &&
                !mysqlQueryBlockId &&
                mysqlFiltered === undefined &&
                !mysqlRef &&
                !mysqlKeyLen,
            })}
          >
            <span className="font-medium text-xs">
              {node.type}
              {node.cteName && node.type === "CTE" && (
                <span className="ml-1 font-mono text-violet-600 dark:text-violet-400">
                  {node.cteName}
                </span>
              )}
              {node.subplanName &&
                (node.type === "SubPlan" || node.type === "InitPlan") && (
                  <span className="ml-1 font-mono text-amber-600 dark:text-amber-400">
                    {node.subplanName.replace(/^(SubPlan|InitPlan)\s+/, "")}
                  </span>
                )}
            </span>
            {node.relation && (
              <span className="text-xs text-muted-foreground">
                on{" "}
                <span className="font-mono text-foreground">
                  {node.relation}
                </span>
                {node.alias && node.alias !== node.relation && (
                  <span className="text-muted-foreground"> ({node.alias})</span>
                )}
              </span>
            )}
            {node.joinType && (
              <span className="text-xs bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 px-1.5 rounded">
                {node.joinType}
              </span>
            )}
          </div>

          {/* Stats Row */}
          <div
            className={cn(
              "flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap",
              {
                hidden:
                  !node.cost &&
                  !node.rows &&
                  !node.width &&
                  !node.actualTime &&
                  !node.actualRows &&
                  !node.loops &&
                  !node.indexName,
              },
            )}
          >
            {node.cost && (
              <span>
                Cost:{" "}
                <span className="font-mono">
                  {node.cost.startup.toFixed(1)}..{node.cost.total.toFixed(1)}
                </span>
                <span
                  className="ml-1 font-medium"
                  style={{
                    color:
                      costPct > 90
                        ? "#dc2626"
                        : costPct > 50
                          ? "#ea580c"
                          : costPct > 10
                            ? "#ca8a04"
                            : "#16a34a",
                  }}
                >
                  ({costPct.toFixed(1)}%)
                </span>
              </span>
            )}
            {node.rows !== undefined && (
              <span>
                Rows:{" "}
                <span className="font-mono">{node.rows.toLocaleString()}</span>
              </span>
            )}
            {node.width !== undefined && (
              <span>
                Width: <span className="font-mono">{node.width}</span>
              </span>
            )}
            {node.actualTime && (
              <span>
                Actual:{" "}
                <span className="font-mono">
                  {node.actualTime.total.toFixed(3)}ms
                </span>
                {node.loops !== undefined && node.loops > 1 && (
                  <span className="text-muted-foreground">
                    {" "}
                    × {node.loops} ={" "}
                    <span className="font-mono text-foreground">
                      {(node.actualTime.total * node.loops).toFixed(3)}ms
                    </span>
                  </span>
                )}
              </span>
            )}
            {node.actualRows !== undefined && (
              <span>
                Actual Rows:{" "}
                <span className="font-mono">
                  {node.actualRows.toLocaleString()}
                </span>
                {node.loops !== undefined && node.loops > 1 && (
                  <span className="text-muted-foreground">
                    {" "}
                    × {node.loops} ={" "}
                    <span className="font-mono text-foreground">
                      {(node.actualRows * node.loops).toLocaleString()}
                    </span>
                  </span>
                )}
                {/* Row estimate mismatch indicator */}
                {node.rows !== undefined &&
                  node.rows > 0 &&
                  (() => {
                    const ratio = node.actualRows / node.rows;
                    if (ratio >= 10) {
                      return (
                        <span
                          className="ml-1 text-red-500 dark:text-red-400"
                          title={`Actual ${ratio.toFixed(1)}× higher than estimated`}
                        >
                          ↑{ratio >= 100 ? "100+" : ratio.toFixed(0)}×
                        </span>
                      );
                    } else if (ratio <= 0.1 && node.actualRows > 0) {
                      const invRatio = node.rows / node.actualRows;
                      return (
                        <span
                          className="ml-1 text-amber-500 dark:text-amber-400"
                          title={`Actual ${invRatio.toFixed(1)}× lower than estimated`}
                        >
                          ↓{invRatio >= 100 ? "100+" : invRatio.toFixed(0)}×
                        </span>
                      );
                    } else if (ratio >= 2) {
                      return (
                        <span
                          className="ml-1 text-orange-500 dark:text-orange-400"
                          title={`Actual ${ratio.toFixed(1)}× higher than estimated`}
                        >
                          ↑{ratio.toFixed(1)}×
                        </span>
                      );
                    } else if (ratio <= 0.5 && node.actualRows > 0) {
                      const invRatio = node.rows / node.actualRows;
                      return (
                        <span
                          className="ml-1 text-yellow-600 dark:text-yellow-400"
                          title={`Actual ${invRatio.toFixed(1)}× lower than estimated`}
                        >
                          ↓{invRatio.toFixed(1)}×
                        </span>
                      );
                    }
                    return null;
                  })()}
              </span>
            )}
            {node.loops !== undefined && node.loops > 1 && (
              <span>
                Loops: <span className="font-mono">{node.loops}</span>
              </span>
            )}
            {node.indexName && (
              <span className="text-green-600 dark:text-green-400">
                Index: <span className="font-mono">{node.indexName}</span>
                {node.scanDirection && node.scanDirection !== "Forward" && (
                  <span className="ml-1 text-amber-500">
                    ({node.scanDirection})
                  </span>
                )}
              </span>
            )}
            {mysqlSelectType && (
              <span>
                Select: <span className="font-mono">{mysqlSelectType}</span>
              </span>
            )}
            {mysqlQueryBlockId && (
              <span>
                ID: <span className="font-mono">{mysqlQueryBlockId}</span>
              </span>
            )}
            {mysqlFiltered !== undefined && (
              <span>
                Filtered:{" "}
                <span className="font-mono">{mysqlFiltered.toFixed(2)}%</span>
              </span>
            )}
            {mysqlKeyLen && (
              <span>
                Key Len: <span className="font-mono">{mysqlKeyLen}</span>
              </span>
            )}
            {mysqlRef && (
              <span>
                Ref: <span className="font-mono">{mysqlRef}</span>
              </span>
            )}
          </div>

          {/* Conditions */}
          {node.hashCond && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">
                Hash Cond:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.hashCond}
              </code>
            </div>
          )}
          {node.joinFilter && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">
                Join Filter:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.joinFilter}
              </code>
            </div>
          )}
          {node.filter && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">
                Filter:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.filter}
              </code>
            </div>
          )}
          {node.mergeCond && (
            <div className="text-xs mt-1">
              <span className="text-cyan-600 dark:text-cyan-400">
                Merge Cond:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.mergeCond}
              </code>
            </div>
          )}
          {node.indexCond && (
            <div className="text-xs mt-1">
              <span className="text-green-600 dark:text-green-400">
                Index Cond:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.indexCond}
              </code>
            </div>
          )}
          {node.recheckCond && (
            <div className="text-xs mt-1">
              <span className="text-amber-600 dark:text-amber-400">
                Recheck Cond:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.recheckCond}
              </code>
            </div>
          )}
          {node.tidCond && (
            <div className="text-xs mt-1">
              <span className="text-orange-600 dark:text-orange-400">
                TID Cond:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.tidCond}
              </code>
            </div>
          )}
          {node.oneTimeFilter && (
            <div className="text-xs mt-1">
              <span className="text-rose-600 dark:text-rose-400">
                One-Time Filter:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.oneTimeFilter}
              </code>
            </div>
          )}

          {/* Sort/Group keys */}
          {node.sortKey && node.sortKey.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-blue-600 dark:text-blue-400">
                Sort Key:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.sortKey.join(", ")}
              </code>
            </div>
          )}
          {node.groupKey && node.groupKey.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-pink-600 dark:text-pink-400">
                Group Key:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.groupKey.join(", ")}
              </code>
            </div>
          )}
          {mysqlPossibleKeys.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-emerald-600 dark:text-emerald-400">
                Possible Keys:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {mysqlPossibleKeys.join(", ")}
              </code>
            </div>
          )}
          {mysqlExtra && (
            <div className="text-xs mt-1">
              <span className="text-amber-600 dark:text-amber-400">Extra: </span>
              <code className="font-mono text-muted-foreground">{mysqlExtra}</code>
            </div>
          )}
          {node.presortedKey && node.presortedKey.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-sky-600 dark:text-sky-400">
                Presorted Key:{" "}
              </span>
              <code className="font-mono text-muted-foreground">
                {node.presortedKey.join(", ")}
              </code>
            </div>
          )}

          {/* Extra stats */}
          {node.rowsRemoved && (
            <div className="text-xs mt-1 text-red-600 dark:text-red-400">
              Rows Removed by {node.rowsRemoved.type}:{" "}
              {node.rowsRemoved.count.toLocaleString()}
            </div>
          )}
          {/* Heap Fetches (Index Only Scan) */}
          {node.heapFetches !== undefined && (
            <div className="text-xs mt-1 text-amber-600 dark:text-amber-400">
              Heap Fetches: {node.heapFetches}
            </div>
          )}
          {/* Heap Blocks (Bitmap Heap Scan) */}
          {(node.exactHeapBlocks !== undefined ||
            node.lossyHeapBlocks !== undefined) && (
            <div className="text-xs mt-1 text-amber-600 dark:text-amber-400">
              Heap Blocks:
              {node.exactHeapBlocks !== undefined &&
                ` exact=${node.exactHeapBlocks}`}
              {node.lossyHeapBlocks !== undefined && (
                <span className="text-orange-500">
                  {" "}
                  lossy={node.lossyHeapBlocks}
                </span>
              )}
            </div>
          )}
          {(node.buffers?.shared ||
            node.buffers?.local ||
            node.buffers?.temp) && (
            <div className="text-xs mt-1 text-muted-foreground">
              Buffers:
              {node.buffers?.shared && (
                <>
                  {" shared"}
                  {node.buffers.shared.hit !== undefined &&
                    ` hit=${node.buffers.shared.hit}`}
                  {node.buffers.shared.read !== undefined &&
                    ` read=${node.buffers.shared.read}`}
                  {node.buffers.shared.dirtied !== undefined &&
                    ` dirtied=${node.buffers.shared.dirtied}`}
                  {node.buffers.shared.written !== undefined &&
                    ` written=${node.buffers.shared.written}`}
                </>
              )}
              {node.buffers?.local && (
                <>
                  {" local"}
                  {node.buffers.local.hit !== undefined &&
                    ` hit=${node.buffers.local.hit}`}
                  {node.buffers.local.read !== undefined &&
                    ` read=${node.buffers.local.read}`}
                  {node.buffers.local.dirtied !== undefined &&
                    ` dirtied=${node.buffers.local.dirtied}`}
                  {node.buffers.local.written !== undefined &&
                    ` written=${node.buffers.local.written}`}
                </>
              )}
              {node.buffers?.temp && (
                <>
                  {" temp"}
                  {node.buffers.temp.read !== undefined &&
                    ` read=${node.buffers.temp.read}`}
                  {node.buffers.temp.written !== undefined &&
                    ` written=${node.buffers.temp.written}`}
                </>
              )}
            </div>
          )}
          {node.sortMethod && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Sort Method: {node.sortMethod}
              {node.sortSpaceUsed !== undefined &&
                `  ${node.sortSpaceType || "Memory"}: ${node.sortSpaceUsed}kB`}
            </div>
          )}
          {node.workersPlanned !== undefined && (
            <div className="text-xs mt-1 text-teal-600 dark:text-teal-400">
              Workers: {node.workersLaunched ?? 0}/{node.workersPlanned} planned
            </div>
          )}

          {/* Hash stats */}
          {(node.hashBuckets !== undefined ||
            node.hashBatches !== undefined ||
            node.memoryUsage !== undefined) && (
            <div className="text-xs mt-1 text-purple-600 dark:text-purple-400">
              {node.hashBuckets !== undefined && `Buckets: ${node.hashBuckets}`}
              {node.hashBatches !== undefined &&
                `  Batches: ${node.hashBatches}`}
              {node.originalHashBatches !== undefined &&
                node.originalHashBatches !== node.hashBatches &&
                ` (originally ${node.originalHashBatches})`}
              {node.memoryUsage !== undefined &&
                `  Memory Usage: ${node.memoryUsage}kB`}
              {node.peakMemoryUsage !== undefined &&
                `  Peak Memory Usage: ${node.peakMemoryUsage}kB`}
              {node.diskUsage !== undefined && (
                <span className="text-red-500">
                  {" "}
                  Disk Usage: {node.diskUsage}kB
                </span>
              )}
            </div>
          )}

          {/* Memoize cache key/mode */}
          {(node.cacheKey || node.cacheMode) && (
            <div className="text-xs mt-1 text-violet-600 dark:text-violet-400">
              {node.cacheKey && (
                <>
                  Cache Key: <code className="font-mono">{node.cacheKey}</code>
                </>
              )}
              {node.cacheMode && <> Mode: {node.cacheMode}</>}
            </div>
          )}

          {/* Memoize cache stats */}
          {(node.cacheHits !== undefined || node.cacheMisses !== undefined) && (
            <div className="text-xs mt-1 text-violet-600 dark:text-violet-400">
              Cache: Hits={node.cacheHits ?? 0} Misses={node.cacheMisses ?? 0}
              {node.cacheEvictions !== undefined &&
                node.cacheEvictions > 0 &&
                ` Evictions=${node.cacheEvictions}`}
              {node.cacheOverflows !== undefined && node.cacheOverflows > 0 && (
                <span className="text-red-500">
                  {" "}
                  Overflows={node.cacheOverflows}
                </span>
              )}
              {node.cacheMemoryUsage !== undefined &&
                ` (${node.cacheMemoryUsage}kB)`}
            </div>
          )}

          {/* Function Scan details */}
          {(node.functionName || node.functionCall) && (
            <div className="text-xs mt-1 text-emerald-600 dark:text-emerald-400">
              {node.functionName && (
                <>
                  Function:{" "}
                  <code className="font-mono">{node.functionName}</code>
                </>
              )}
              {node.functionCall && (
                <>
                  {" "}
                  Call: <code className="font-mono">{node.functionCall}</code>
                </>
              )}
            </div>
          )}

          {/* Foreign Scan remote SQL */}
          {node.remoteSql && (
            <div className="text-xs mt-1 text-sky-600 dark:text-sky-400">
              Remote SQL:{" "}
              <code className="font-mono text-[10px]">{node.remoteSql}</code>
            </div>
          )}

          {/* Single Copy (parallel) */}
          {node.singleCopy && (
            <div className="text-xs mt-1 text-teal-600 dark:text-teal-400">
              Single Copy: true
            </div>
          )}

          {/* Incremental Sort groups */}
          {node.fullSortGroups && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Full-sort Groups: {node.fullSortGroups.count} Sort Method:{" "}
              {node.fullSortGroups.memoryType} Average Memory:{" "}
              {node.fullSortGroups.memoryUsed}kB
              {node.fullSortGroups.peakMemory !== undefined &&
                `  Peak Memory: ${node.fullSortGroups.peakMemory}kB`}
            </div>
          )}
          {node.preSortedGroups && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Pre-sorted Groups: {node.preSortedGroups.count} Sort Method:{" "}
              {node.preSortedGroups.memoryType} Average Memory:{" "}
              {node.preSortedGroups.memoryUsed}kB
              {node.preSortedGroups.peakMemory !== undefined &&
                `  Peak Memory: ${node.preSortedGroups.peakMemory}kB`}
            </div>
          )}

          {/* WAL stats */}
          {node.wal && (
            <div className="text-xs mt-1 text-orange-600 dark:text-orange-400">
              WAL: records={node.wal.records} fpi={node.wal.fpi} bytes=
              {node.wal.bytes?.toLocaleString()}
            </div>
          )}

          {/* Memory stats (PG17+) */}
          {node.memory && (
            <div className="text-xs mt-1 text-emerald-600 dark:text-emerald-400">
              Memory: used={node.memory.used}kB allocated=
              {node.memory.allocated}kB
            </div>
          )}

          {/* I/O Timings */}
          {node.ioTiming && (
            <div className="text-xs mt-1 text-muted-foreground">
              I/O Timings:
              {node.ioTiming.read !== undefined &&
                ` read=${node.ioTiming.read.toFixed(3)}`}
              {node.ioTiming.write !== undefined &&
                ` write=${node.ioTiming.write.toFixed(3)}`}
            </div>
          )}

          {/* Never executed indicator */}
          {node.neverExecuted && (
            <div className="text-xs mt-1 text-muted-foreground italic">
              (never executed)
            </div>
          )}

          {/* Run Condition (PG15+ WindowAgg optimization) */}
          {node.runCondition && (
            <div className="text-xs mt-1 text-cyan-600 dark:text-cyan-400">
              Run Condition:{" "}
              <code className="font-mono">{node.runCondition}</code>
            </div>
          )}

          {/* Partition pruning info */}
          {(node.partitionsRemoved !== undefined ||
            node.plannedPartitions !== undefined) && (
            <div className="text-xs mt-1 text-indigo-600 dark:text-indigo-400">
              Partitions:
              {node.plannedPartitions !== undefined &&
                ` ${node.plannedPartitions} planned`}
              {node.partitionsRemoved !== undefined &&
                ` (${node.partitionsRemoved} removed)`}
            </div>
          )}

          {/* Subplans removed */}
          {node.subplansRemoved !== undefined && node.subplansRemoved > 0 && (
            <div className="text-xs mt-1 text-indigo-600 dark:text-indigo-400">
              Subplans Removed: {node.subplansRemoved}
            </div>
          )}

          {/* Sampling method */}
          {node.samplingMethod && (
            <div className="text-xs mt-1 text-pink-600 dark:text-pink-400">
              Sampling: {node.samplingMethod}
            </div>
          )}

          {/* Grouping Sets */}
          {node.groupingSets && node.groupingSets.length > 0 && (
            <div className="text-xs mt-1 text-fuchsia-600 dark:text-fuchsia-400">
              Grouping Sets:{" "}
              <code className="font-mono">{node.groupingSets.join(", ")}</code>
            </div>
          )}

          {/* Partial Mode (parallel aggregate) */}
          {node.partialMode && (
            <div className="text-xs mt-1 text-teal-600 dark:text-teal-400">
              Partial Mode: {node.partialMode}
            </div>
          )}

          {/* Conflict resolution */}
          {node.conflictResolution && (
            <div className="text-xs mt-1 text-amber-600 dark:text-amber-400">
              Conflict: {node.conflictResolution}
              {node.tuplesInserted !== undefined &&
                ` Inserted=${node.tuplesInserted}`}
              {node.conflictingTuples !== undefined &&
                node.conflictingTuples > 0 &&
                ` Conflicts=${node.conflictingTuples}`}
            </div>
          )}

          {/* Per-worker stats */}
          {node.workers && node.workers.length > 0 && (
            <div className="text-xs mt-1 text-teal-600 dark:text-teal-400 ml-2 border-l pl-2 border-teal-500/30">
              {node.workers.map((w) => (
                <div key={w.workerNumber}>
                  Worker {w.workerNumber}: {w.actualTime?.total.toFixed(3)}ms,{" "}
                  {w.actualRows?.toLocaleString()} rows
                  {w.buffers?.shared?.hit !== undefined &&
                    ` (buf hit=${w.buffers.shared.hit})`}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cost Bar */}
        <div className="w-16 shrink-0 mt-1">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(costPct, 100)}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="border-l border-muted ml-[22px]">
          {node.children?.map((child, idx) => (
            <TreeNode
              key={child.id || idx}
              node={child}
              totalCost={totalCost}
              totalActualTime={totalActualTime}
              depth={depth + 1}
              defaultExpanded={depth < 3}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const TreeView = memo(function TreeView({
  nodes,
  totalCost,
  totalActualTime,
}: {
  nodes: ExplainNode[];
  totalCost: number;
  totalActualTime?: number;
}) {
  return (
    <div className="p-2">
      {nodes.map((node, idx) => (
        <TreeNode
          key={node.id || idx}
          node={node}
          totalCost={totalCost}
          totalActualTime={totalActualTime}
        />
      ))}
    </div>
  );
});

// ============================================================================
// STATS VIEW COMPONENT
// ============================================================================

interface NodeTypeStats {
  type: string;
  count: number;
  totalTime: number;
  percentOfQuery: number;
}

interface TableScanStats {
  scanType: string;
  count: number;
  totalTime: number;
  percentOfTable: number;
}

interface TableStats {
  tableName: string;
  scanCount: number;
  totalTime: number;
  percentOfQuery: number;
  scans: TableScanStats[];
}

// Physical table scan types (not derived sources like CTEs or subqueries)
const PHYSICAL_TABLE_SCANS = new Set([
  "Seq Scan",
  "Index Scan",
  "Index Only Scan",
  "Bitmap Heap Scan",
  "Tid Scan",
  "Tid Range Scan",
  "Sample Scan",
]);

function collectStats(
  nodes: ExplainNode[],
  totalTime: number,
): { nodeStats: NodeTypeStats[]; tableStats: TableStats[] } {
  const nodeTypeMap = new Map<string, { count: number; time: number }>();
  const tableMap = new Map<
    string,
    {
      scans: Map<string, { count: number; time: number }>;
      totalTime: number;
      scanCount: number;
    }
  >();

  // Get inclusive time for a node, recursively summing children for wrapper nodes
  function getNodeInclusiveTime(node: ExplainNode): number {
    if (node.actualTime) {
      return node.actualTime.total * (node.loops || 1);
    }
    // For wrapper nodes (CTE, SubPlan, InitPlan) without actualTime,
    // sum descendants' inclusive times
    return (
      node.children?.reduce(
        (sum, child) => sum + getNodeInclusiveTime(child),
        0,
      ) || 0
    );
  }

  function traverse(node: ExplainNode) {
    // Calculate exclusive time for this node
    const nodeTime = node.actualTime
      ? node.actualTime.total * (node.loops || 1)
      : 0;
    // Use recursive helper to properly account for wrapper nodes
    const childrenTime =
      node.children?.reduce(
        (sum, child) => sum + getNodeInclusiveTime(child),
        0,
      ) || 0;
    const exclusiveTime = Math.max(0, nodeTime - childrenTime);

    // Aggregate by node type
    const existing = nodeTypeMap.get(node.type) || { count: 0, time: 0 };
    nodeTypeMap.set(node.type, {
      count: existing.count + 1,
      time: existing.time + exclusiveTime,
    });

    // Aggregate by table (only for physical table scans, not CTE/Subquery scans)
    if (node.relation && PHYSICAL_TABLE_SCANS.has(node.type)) {
      const tableEntry = tableMap.get(node.relation) || {
        scans: new Map(),
        totalTime: 0,
        scanCount: 0,
      };
      const scanEntry = tableEntry.scans.get(node.type) || {
        count: 0,
        time: 0,
      };
      tableEntry.scans.set(node.type, {
        count: scanEntry.count + 1,
        time: scanEntry.time + exclusiveTime,
      });
      tableEntry.totalTime += exclusiveTime;
      tableEntry.scanCount += 1;
      tableMap.set(node.relation, tableEntry);
    }

    // Recurse into children
    node.children?.forEach(traverse);
  }

  nodes.forEach(traverse);

  // Convert to arrays and sort
  const nodeStats: NodeTypeStats[] = Array.from(nodeTypeMap.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      totalTime: data.time,
      percentOfQuery: totalTime > 0 ? (data.time / totalTime) * 100 : 0,
    }))
    .sort((a, b) => b.totalTime - a.totalTime);

  const tableStats: TableStats[] = Array.from(tableMap.entries())
    .map(([tableName, data]) => ({
      tableName,
      scanCount: data.scanCount,
      totalTime: data.totalTime,
      percentOfQuery: totalTime > 0 ? (data.totalTime / totalTime) * 100 : 0,
      scans: Array.from(data.scans.entries())
        .map(([scanType, scanData]) => ({
          scanType,
          count: scanData.count,
          totalTime: scanData.time,
          percentOfTable:
            data.totalTime > 0 ? (scanData.time / data.totalTime) * 100 : 0,
        }))
        .sort((a, b) => b.totalTime - a.totalTime),
    }))
    .sort((a, b) => b.totalTime - a.totalTime);

  return { nodeStats, tableStats };
}

const StatsView = memo(function StatsView({
  nodes,
  totalActualTime,
}: {
  nodes: ExplainNode[];
  totalActualTime: number;
}) {
  const { nodeStats, tableStats } = useMemo(
    () => collectStats(nodes, totalActualTime),
    [nodes, totalActualTime],
  );
  const hasTableStats = tableStats.length > 0;

  const formatTime = (ms: number) => {
    if (ms < 0.001) return "0.000 ms";
    return `${ms.toFixed(3)} ms`;
  };

  const formatPercent = (pct: number) => `${pct.toFixed(1)} %`;

  return (
    <div className="h-full overflow-auto p-1">
      <div
        className={cn(
          "grid gap-3 auto-rows-min",
          hasTableStats
            ? "grid-cols-[repeat(auto-fit,minmax(320px,1fr))]"
            : "grid-cols-1",
        )}
      >
        {/* Node Type Stats */}
        <div className="space-y-2 min-w-0">
          <h3 className="text-xs font-semibold text-foreground">
            Node type stats
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                    node type
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                    count
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                    sum of times
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                    % of query
                  </th>
                </tr>
              </thead>
              <tbody>
                {nodeStats.map((stat) => (
                  <tr key={stat.type} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-mono">{stat.type}</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {stat.count}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {formatTime(stat.totalTime)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {formatPercent(stat.percentOfQuery)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per Table Stats */}
        {hasTableStats && (
          <div className="space-y-2 min-w-0">
            <h3 className="text-xs font-semibold text-foreground">
              Table stats
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Scan count
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      Total time
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">
                      % of query
                    </th>
                  </tr>
                  <tr className="bg-muted/30 text-[10px]">
                    <th className="text-left px-3 py-1 font-medium text-muted-foreground/70">
                      scan type
                    </th>
                    <th className="text-right px-3 py-1 font-medium text-muted-foreground/70">
                      count
                    </th>
                    <th className="text-right px-3 py-1 font-medium text-muted-foreground/70">
                      sum of times
                    </th>
                    <th className="text-right px-3 py-1 font-medium text-muted-foreground/70">
                      % of table
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableStats.map((table) => (
                    <React.Fragment key={table.tableName}>
                      <tr className="border-t bg-muted/20 font-medium">
                        <td className="px-3 py-1.5 font-mono font-semibold">
                          {table.tableName}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {table.scanCount}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {formatTime(table.totalTime)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {formatPercent(table.percentOfQuery)}
                        </td>
                      </tr>
                      {table.scans.map((scan) => (
                        <tr
                          key={`${table.tableName}-${scan.scanType}`}
                          className="text-muted-foreground"
                        >
                          <td className="px-3 py-1 pl-6 font-mono">
                            {scan.scanType}
                          </td>
                          <td className="px-3 py-1 text-right font-mono">
                            {scan.count}
                          </td>
                          <td className="px-3 py-1 text-right font-mono">
                            {formatTime(scan.totalTime)}
                          </td>
                          <td className="px-3 py-1 text-right font-mono">
                            {formatPercent(scan.percentOfTable)}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ExplainViewer = memo(function ExplainViewer({
  result,
  databaseType,
  className,
  viewMode = "explain",
  tabId,
  currentQuery,
}: ExplainViewerProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const [selectedPlan1, setSelectedPlan1] = useState<string>("");
  const [selectedPlan2, setSelectedPlan2] = useState<string>("");

  const saveExplainPlan = useTabStateStore((state) => state.saveExplainPlan);
  const getSavedExplainPlans = useTabStateStore(
    (state) => state.getSavedExplainPlans,
  );

  const savedPlans = tabId ? getSavedExplainPlans(tabId) : [];

  const parsed = useMemo(() => {
    // Only parse when actually viewing explain-related modes
    if (viewMode !== "explain" && viewMode !== "raw" && viewMode !== "stats") {
      return {
        nodes: [],
        planningTime: 0,
        executionTime: 0,
        totalCost: 0,
        raw: "",
      };
    }
    return parseExplain({
      columns: result.columns,
      rows: result.rows,
      databaseType,
    });
  }, [databaseType, result.columns, result.rows, viewMode]);

  const handleSavePlan = () => {
    if (!tabId || !currentQuery) {
      toast.error("Cannot save plan: Missing tab or query information");
      return;
    }

    const fullResult = {
      ...result,
      rowCount: result.rows.length,
    };
    saveExplainPlan(tabId, currentQuery, fullResult, saveLabel || undefined);
    toast.success("Plan saved for comparison");
    setShowSaveDialog(false);
    setSaveLabel("");
  };

  const handleComparePlans = () => {
    if (!selectedPlan1 || !selectedPlan2) {
      toast.error("Please select two plans to compare");
      return;
    }
    setShowCompare(true);
  };

  const plan1 = savedPlans.find((p) => p.id === selectedPlan1);
  const plan2 = savedPlans.find((p) => p.id === selectedPlan2);

  if (showCompare && plan1 && plan2) {
    return (
      <PlanDiff
        plan1={plan1.plan}
        plan2={plan2.plan}
        query1={plan1.query}
        query2={plan2.query}
        label1={plan1.label}
        label2={plan2.label}
        onBack={() => {
          setShowCompare(false);
          setSelectedPlan1("");
          setSelectedPlan2("");
        }}
        parseExplain={(planResult) =>
          parseExplain({
            columns: planResult.columns,
            rows: planResult.rows,
            databaseType,
          })
        }
      />
    );
  }

  // Fallback to raw text if parsing failed
  if (parsed.nodes.length === 0) {
    const rawText = buildExplainFallbackText(result.columns, result.rows);
    return (
      <div className={cn("h-full overflow-hidden", className)}>
        <CodeEditor
          value={rawText}
          language="sql"
          readOnly
          height="100%"
          lineNumbers
        />
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col overflow-hidden", className)}>
      {/* Plan comparison toolbar */}
      {viewMode === "explain" && tabId && (
        <div className="border-b bg-muted/20 px-4 py-2">
          <div className="flex items-center gap-3">
            {/* Save current plan */}
            {!showSaveDialog ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowSaveDialog(true);
                }}
                className="h-7 text-xs"
              >
                <IconBookmark className="h-3.5 w-3.5 mr-1.5" />
                Save for comparison
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={saveLabel}
                  onChange={(e) => {
                    setSaveLabel(e.target.value);
                  }}
                  placeholder="Label (optional)"
                  className="h-7 text-xs w-40"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSavePlan();
                    if (e.key === "Escape") {
                      setShowSaveDialog(false);
                      setSaveLabel("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSavePlan}
                  className="h-7 text-xs"
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowSaveDialog(false);
                    setSaveLabel("");
                  }}
                  className="h-7 w-7 p-0"
                >
                  <IconX className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Compare plans */}
            {savedPlans.length >= 2 && (
              <>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedPlan1 || null}
                    onValueChange={(val) => {
                      setSelectedPlan1(val || "");
                    }}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedPlans.map((plan) => (
                        <SelectItem
                          key={plan.id}
                          value={plan.id}
                          className="text-xs"
                        >
                          {plan.label ||
                            new Date(plan.timestamp).toLocaleTimeString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <Select
                    value={selectedPlan2 || null}
                    onValueChange={(val) => {
                      setSelectedPlan2(val || "");
                    }}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedPlans.map((plan) => (
                        <SelectItem
                          key={plan.id}
                          value={plan.id}
                          className="text-xs"
                        >
                          {plan.label ||
                            new Date(plan.timestamp).toLocaleTimeString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleComparePlans}
                    disabled={
                      !selectedPlan1 ||
                      !selectedPlan2 ||
                      selectedPlan1 === selectedPlan2
                    }
                    className="h-7 text-xs"
                  >
                    <IconGitCompare className="h-3.5 w-3.5 mr-1.5" />
                    Compare
                  </Button>
                </div>
              </>
            )}

            {/* Saved plans count */}
            {savedPlans.length > 0 && (
              <>
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {savedPlans.length} saved plan
                  {savedPlans.length !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header with timing info */}
      {viewMode === "explain" &&
        (parsed.planningTime !== undefined ||
          parsed.executionTime !== undefined ||
          parsed.triggers?.length ||
          parsed.jit ||
          parsed.settings?.length ||
          parsed.queryIdentifier) && (
          <div className="border-b bg-gradient-to-r from-muted/30 to-muted/10">
            <div className="px-4 py-3 space-y-2">
              {/* Timing Section */}
              {(parsed.planningTime !== undefined ||
                parsed.executionTime !== undefined) && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <IconClock className="h-4 w-4" />
                    <span className="text-xs font-medium">Query Timing</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {parsed.planningTime !== undefined && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          Planning:
                        </span>
                        <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                          {parsed.planningTime.toFixed(3)}ms
                        </span>
                      </div>
                    )}
                    {parsed.executionTime !== undefined && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          Execution:
                        </span>
                        <span className="text-xs font-mono font-semibold text-green-600 dark:text-green-400">
                          {parsed.executionTime.toFixed(3)}ms
                        </span>
                      </div>
                    )}
                    {parsed.planningTime !== undefined &&
                      parsed.executionTime !== undefined && (
                        <div className="flex items-center gap-1.5 pl-2 border-l">
                          <span className="text-xs text-muted-foreground">
                            Total:
                          </span>
                          <span className="text-xs font-mono font-bold text-foreground">
                            {(
                              parsed.planningTime + parsed.executionTime
                            ).toFixed(3)}
                            ms
                          </span>
                        </div>
                      )}
                    {/* Planning Buffers */}
                    {parsed.planningBuffers?.shared && (
                      <div className="flex items-center gap-1.5 pl-2 border-l">
                        <span className="text-xs text-muted-foreground">
                          Plan Buffers:
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          shared
                          {parsed.planningBuffers.shared.hit !== undefined &&
                            ` hit=${parsed.planningBuffers.shared.hit}`}
                          {parsed.planningBuffers.shared.read !== undefined &&
                            ` read=${parsed.planningBuffers.shared.read}`}
                          {parsed.planningBuffers.shared.dirtied !==
                            undefined &&
                            ` dirtied=${parsed.planningBuffers.shared.dirtied}`}
                          {parsed.planningBuffers.shared.written !==
                            undefined &&
                            ` written=${parsed.planningBuffers.shared.written}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* JIT Section */}
              {parsed.jit && (
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
                    <IconRocket className="h-4 w-4" />
                    <span className="text-xs font-medium">JIT Compilation</span>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground">
                        {parsed.jit.functions} function
                        {parsed.jit.functions !== 1 ? "s" : ""}
                      </span>
                      {parsed.jit.timing?.total !== undefined && (
                        <span className="text-xs font-mono font-semibold text-violet-600 dark:text-violet-400">
                          {parsed.jit.timing.total.toFixed(3)}ms
                        </span>
                      )}
                      {parsed.jit.options && (
                        <div className="flex items-center gap-2 text-[11px]">
                          {[
                            { key: "inlining", label: "Inlining" },
                            { key: "optimization", label: "Optimization" },
                            { key: "expressions", label: "Expressions" },
                            { key: "deforming", label: "Deforming" },
                          ].map(({ key, label }) => {
                            const enabled =
                              parsed.jit?.options?.[
                                key as keyof typeof parsed.jit.options
                              ];
                            return (
                              <span
                                key={key}
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                  enabled
                                    ? "bg-green-500/20 text-green-700 dark:text-green-300"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {parsed.jit.timing && (
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        {parsed.jit.timing.generation !== undefined && (
                          <span>
                            Gen:{" "}
                            <span className="font-mono">
                              {parsed.jit.timing.generation.toFixed(2)}ms
                            </span>
                          </span>
                        )}
                        {parsed.jit.timing.inlining !== undefined && (
                          <span>
                            Inline:{" "}
                            <span className="font-mono">
                              {parsed.jit.timing.inlining.toFixed(2)}ms
                            </span>
                          </span>
                        )}
                        {parsed.jit.timing.optimization !== undefined && (
                          <span>
                            Opt:{" "}
                            <span className="font-mono">
                              {parsed.jit.timing.optimization.toFixed(2)}ms
                            </span>
                          </span>
                        )}
                        {parsed.jit.timing.emission !== undefined && (
                          <span>
                            Emit:{" "}
                            <span className="font-mono">
                              {parsed.jit.timing.emission.toFixed(2)}ms
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Triggers Section */}
              {parsed.triggers && parsed.triggers.length > 0 && (
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <div className="h-4 w-4 flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-amber-600 dark:bg-amber-400" />
                    </div>
                    <span className="text-xs font-medium">Triggers</span>
                  </div>
                  <div className="flex-1 flex flex-wrap gap-3">
                    {parsed.triggers.map((trigger, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20"
                      >
                        <span className="text-xs font-mono font-medium text-foreground">
                          {trigger.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {trigger.calls} call{trigger.calls !== 1 ? "s" : ""}
                        </span>
                        <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {trigger.time.toFixed(3)}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Settings Section */}
              {parsed.settings && parsed.settings.length > 0 && (
                <div className="flex items-start gap-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="h-4 w-4 flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                    </div>
                    <span className="text-xs font-medium">Settings</span>
                  </div>
                  <div className="flex-1 text-xs font-mono text-muted-foreground">
                    {parsed.settings.join(", ")}
                  </div>
                </div>
              )}

              {/* Query Identifier */}
              {parsed.queryIdentifier && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="h-4 w-4 flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                    </div>
                    <span className="text-xs font-medium">Query ID</span>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    {parsed.queryIdentifier}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "explain" ? (
          /* Tree View */
          <div className="h-full overflow-auto">
            <TreeView
              nodes={parsed.nodes}
              totalCost={parsed.totalCost}
              totalActualTime={parsed.totalActualTime}
            />
          </div>
        ) : viewMode === "stats" ? (
          /* Stats View */
          <StatsView
            nodes={parsed.nodes}
            totalActualTime={parsed.totalActualTime || 0}
          />
        ) : (
          /* Raw Output */
          <div className="h-full flex flex-col bg-muted/10">
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">
                Raw Output
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  writeClipboardText(parsed.raw)
                    .then(() => toast.success("Copied to clipboard"))
                    .catch(() => toast.error("Failed to copy"));
                }}
                title="Copy raw output"
              >
                <IconCopy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground select-text">
                {parsed.raw}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// UTILITY EXPORT
// ============================================================================

export function isExplainResult(columns: string[], rows: unknown[][]): boolean {
  if (columns.length !== 1) return false;

  const colName = columns[0]?.toLowerCase() || "";
  if (!colName.includes("query plan") && !colName.includes("explain")) {
    return false;
  }

  const firstRow = rows[0]?.[0];
  if (typeof firstRow !== "string") return false;

  // Check for JSON format
  const trimmed = firstRow.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    // Try to detect JSON EXPLAIN format
    return trimmed.includes('"Plan"') || trimmed.includes('"Node Type"');
  }

  // Text format keywords
  const explainKeywords = [
    "seq scan",
    "index scan",
    "index only scan",
    "bitmap",
    "hash join",
    "nested loop",
    "merge join",
    "sort",
    "aggregate",
    "limit",
    "gather",
    "cost=",
    "rows=",
    "result",
    "append",
    "cte scan",
  ];

  const lower = firstRow.toLowerCase();
  return explainKeywords.some((kw) => lower.includes(kw));
}
