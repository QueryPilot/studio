import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconTrendingUp,
  IconTrendingDown,
  IconEqual,
  IconAlertTriangle,
} from "@tabler/icons-react";
import type { QueryResult } from "@/stores/tabStateStore";

interface ExplainNode {
  id: string;
  type: string;
  relation?: string;
  alias?: string;
  schema?: string;
  cost?: { startup: number; total: number };
  rows?: number;
  width?: number;
  actualTime?: { startup: number; total: number };
  actualRows?: number;
  loops?: number;
  filter?: string;
  hashCond?: string;
  joinFilter?: string;
  mergeCond?: string;
  indexCond?: string;
  recheckCond?: string;
  tidCond?: string;
  oneTimeFilter?: string;
  sortKey?: string[];
  groupKey?: string[];
  presortedKey?: string[];
  output?: string[];
  indexName?: string;
  scanDirection?: string;
  joinType?: string;
  innerUnique?: boolean;
  workersPlanned?: number;
  workersLaunched?: number;
  parallelAware?: boolean;
  asyncCapable?: boolean;
  workers?: Array<{
    workerNumber: number;
    actualTime?: { startup: number; total: number };
    actualRows?: number;
    loops?: number;
    buffers?: ExplainNode["buffers"];
    wal?: ExplainNode["wal"];
  }>;
  rowsRemoved?: { type: string; count: number };
  heapFetches?: number;
  exactHeapBlocks?: number;
  lossyHeapBlocks?: number;
  sortMethod?: string;
  sortSpaceUsed?: number;
  sortSpaceType?: string;
  fullSortGroups?: { count: number; memoryUsed: number; memoryType: string };
  preSortedGroups?: { count: number; memoryUsed: number; memoryType: string };
  hashBuckets?: number;
  hashBatches?: number;
  originalHashBatches?: number;
  peakMemoryUsage?: number;
  diskUsage?: number;
  cacheHits?: number;
  cacheMisses?: number;
  cacheEvictions?: number;
  cacheOverflows?: number;
  cacheMemoryUsage?: number;
  buffers?: {
    shared?: {
      hit?: number;
      read?: number;
      dirtied?: number;
      written?: number;
    };
    local?: { hit?: number; read?: number; dirtied?: number; written?: number };
    temp?: { read?: number; written?: number };
  };
  ioTiming?: { read?: number; write?: number };
  wal?: { records?: number; fpi?: number; bytes?: number };
  memory?: { used?: number; allocated?: number };
  conflictResolution?: string;
  conflictArbiterIndexes?: string[];
  tuplesInserted?: number;
  conflictingTuples?: number;
  cteName?: string;
  subplanName?: string;
  runCondition?: string;
  neverExecuted?: boolean;
  subplansRemoved?: number;
  partitionsRemoved?: number;
  plannedPartitions?: number;
  samplingMethod?: string;
  groupingSets?: string[];
  partialMode?: string;
  children?: ExplainNode[];
  raw?: string;
  [key: string]: unknown;
}

interface ParsedExplain {
  nodes: ExplainNode[];
  planningTime?: number;
  executionTime?: number;
  totalCost: number;
  totalActualTime?: number;
  raw: string;
}

interface PlanDiffProps {
  plan1: QueryResult;
  plan2: QueryResult;
  query1: string;
  query2: string;
  label1?: string;
  label2?: string;
  onBack: () => void;
  parseExplain: (rows: unknown[][]) => ParsedExplain;
}

interface DiffSummary {
  costChange: number;
  costChangePercent: number;
  rowsChange?: number;
  rowsChangePercent?: number;
  planningTimeChange?: number;
  executionTimeChange?: number;
  nodeTypeChanges: Array<{ from: string; to: string; path: string }>;
  newNodes: Array<{ type: string; path: string }>;
  removedNodes: Array<{ type: string; path: string }>;
}

function calculateNodePath(
  node: ExplainNode,
  index: number,
  parentPath = "",
): string {
  const path = parentPath ? `${parentPath} > ${node.type}` : node.type;
  if (node.relation) {
    return `${path} (${node.relation})`;
  }
  return `${path} #${index}`;
}

function flattenNodes(
  nodes: ExplainNode[],
  parentPath = "",
): Array<ExplainNode & { path: string }> {
  const result: Array<ExplainNode & { path: string }> = [];

  nodes.forEach((node, index) => {
    const path = calculateNodePath(node, index, parentPath);
    result.push({ ...node, path });

    if (node.children && node.children.length > 0) {
      result.push(...flattenNodes(node.children, path));
    }
  });

  return result;
}

function calculateDiff(
  parsed1: ParsedExplain,
  parsed2: ParsedExplain,
): DiffSummary {
  const costChange = parsed2.totalCost - parsed1.totalCost;
  const costChangePercent =
    parsed1.totalCost > 0 ? (costChange / parsed1.totalCost) * 100 : 0;

  const rowsChange =
    parsed2.nodes[0]?.rows && parsed1.nodes[0]?.rows
      ? parsed2.nodes[0].rows - parsed1.nodes[0].rows
      : undefined;
  const rowsChangePercent =
    rowsChange && parsed1.nodes[0]?.rows
      ? (rowsChange / parsed1.nodes[0].rows) * 100
      : undefined;

  const planningTimeChange =
    parsed2.planningTime && parsed1.planningTime
      ? parsed2.planningTime - parsed1.planningTime
      : undefined;

  const executionTimeChange =
    parsed2.executionTime && parsed1.executionTime
      ? parsed2.executionTime - parsed1.executionTime
      : undefined;

  const flat1 = flattenNodes(parsed1.nodes);
  const flat2 = flattenNodes(parsed2.nodes);

  const nodeTypeChanges: DiffSummary["nodeTypeChanges"] = [];
  const newNodes: DiffSummary["newNodes"] = [];
  const removedNodes: DiffSummary["removedNodes"] = [];

  const map1 = new Map(flat1.map((n) => [n.path, n]));
  const map2 = new Map(flat2.map((n) => [n.path, n]));

  flat1.forEach((node1) => {
    const node2 = map2.get(node1.path);
    if (!node2) {
      removedNodes.push({ type: node1.type, path: node1.path });
    } else if (node1.type !== node2.type) {
      nodeTypeChanges.push({
        from: node1.type,
        to: node2.type,
        path: node1.path,
      });
    }
  });

  flat2.forEach((node2) => {
    if (!map1.has(node2.path)) {
      newNodes.push({ type: node2.type, path: node2.path });
    }
  });

  return {
    costChange,
    costChangePercent,
    rowsChange,
    rowsChangePercent,
    planningTimeChange,
    executionTimeChange,
    nodeTypeChanges,
    newNodes,
    removedNodes,
  };
}

function formatTime(ms: number): string {
  return `${ms.toFixed(3)}ms`;
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatCost(cost: number): string {
  return cost.toFixed(2);
}

interface NodeDiffProps {
  node1?: ExplainNode;
  node2?: ExplainNode;
  depth: number;
}

const NodeDiff = memo(function NodeDiff({
  node1,
  node2,
  depth,
}: NodeDiffProps) {
  const isNew = !node1 && node2;
  const isRemoved = node1 && !node2;
  const isChanged = node1 && node2 && node1.type !== node2.type;

  const costChange =
    node1?.cost && node2?.cost
      ? node2.cost.total - node1.cost.total
      : undefined;

  const rowsChange =
    node1?.rows && node2?.rows ? node2.rows - node1.rows : undefined;

  const bgClass = isNew
    ? "bg-green-50 dark:bg-green-950/20"
    : isRemoved
      ? "bg-red-50 dark:bg-red-950/20"
      : isChanged
        ? "bg-amber-50 dark:bg-amber-950/20"
        : "";

  return (
    <div
      className={cn("border-b py-2 px-3 text-xs font-mono", bgClass)}
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {isNew && (
            <div className="flex items-center gap-2">
              <span className="text-green-600 dark:text-green-400 font-semibold">
                NEW:
              </span>
              <span className="text-foreground">{node2?.type}</span>
              {node2?.relation && (
                <span className="text-muted-foreground">
                  on {node2.relation}
                </span>
              )}
            </div>
          )}
          {isRemoved && (
            <div className="flex items-center gap-2">
              <span className="text-red-600 dark:text-red-400 font-semibold">
                REMOVED:
              </span>
              <span className="text-foreground line-through">
                {node1?.type}
              </span>
              {node1?.relation && (
                <span className="text-muted-foreground line-through">
                  on {node1.relation}
                </span>
              )}
            </div>
          )}
          {isChanged && (
            <div className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                CHANGED:
              </span>
              <span className="text-red-600 dark:text-red-400 line-through">
                {node1?.type}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-green-600 dark:text-green-400">
                {node2?.type}
              </span>
            </div>
          )}
          {!isNew && !isRemoved && !isChanged && (
            <div className="flex items-center gap-2">
              <span className="text-foreground">
                {node1?.type || node2?.type}
              </span>
              {(node1?.relation || node2?.relation) && (
                <span className="text-muted-foreground">
                  on {node1?.relation || node2?.relation}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {costChange !== undefined && Math.abs(costChange) > 0.01 && (
            <div className="flex items-center gap-1">
              {costChange > 0 ? (
                <IconTrendingUp className="h-3 w-3 text-red-500" />
              ) : (
                <IconTrendingDown className="h-3 w-3 text-green-500" />
              )}
              <span
                className={cn(
                  "font-semibold",
                  costChange > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400",
                )}
              >
                {costChange > 0 ? "+" : ""}
                {formatCost(costChange)}
              </span>
            </div>
          )}
          {rowsChange !== undefined && rowsChange !== 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-[10px]">rows:</span>
              <span
                className={cn(
                  "font-semibold",
                  rowsChange > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-blue-600 dark:text-blue-400",
                )}
              >
                {rowsChange > 0 ? "+" : ""}
                {rowsChange}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const PlanDiff = memo(function PlanDiff({
  plan1,
  plan2,
  query1,
  query2,
  label1,
  label2,
  onBack,
  parseExplain,
}: PlanDiffProps) {
  const parsed1 = useMemo(
    () => parseExplain(plan1.rows),
    [plan1.rows, parseExplain],
  );
  const parsed2 = useMemo(
    () => parseExplain(plan2.rows),
    [plan2.rows, parseExplain],
  );
  const diff = useMemo(
    () => calculateDiff(parsed1, parsed2),
    [parsed1, parsed2],
  );

  const allPaths = useMemo(() => {
    const flat1 = flattenNodes(parsed1.nodes);
    const flat2 = flattenNodes(parsed2.nodes);
    const paths = new Set<string>();
    flat1.forEach((n) => paths.add(n.path));
    flat2.forEach((n) => paths.add(n.path));
    return Array.from(paths).sort();
  }, [parsed1.nodes, parsed2.nodes]);

  const nodeMap1 = useMemo(() => {
    return new Map(flattenNodes(parsed1.nodes).map((n) => [n.path, n]));
  }, [parsed1.nodes]);

  const nodeMap2 = useMemo(() => {
    return new Map(flattenNodes(parsed2.nodes).map((n) => [n.path, n]));
  }, [parsed2.nodes]);

  const hasSignificantChanges =
    Math.abs(diff.costChangePercent) > 5 ||
    diff.nodeTypeChanges.length > 0 ||
    diff.newNodes.length > 0 ||
    diff.removedNodes.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <IconArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h2 className="text-sm font-semibold">Plan Comparison</h2>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <div className="text-muted-foreground font-medium">
              {label1 || "Plan 1"}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {query1}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-muted-foreground font-medium">
              {label2 || "Plan 2"}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {query2}
            </div>
          </div>
        </div>

        {/* Diff Summary */}
        <div className="mt-4 p-3 border rounded-lg bg-background space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold mb-2">
            {hasSignificantChanges ? (
              <>
                <IconAlertTriangle className="h-4 w-4 text-amber-500" />
                <span>Significant changes detected</span>
              </>
            ) : (
              <>
                <IconEqual className="h-4 w-4 text-green-500" />
                <span>Plans are similar</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Cost:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {formatCost(parsed1.totalCost)}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono">
                    {formatCost(parsed2.totalCost)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Change:</span>
                <div className="flex items-center gap-1">
                  {diff.costChange > 0 ? (
                    <IconTrendingUp className="h-3 w-3 text-red-500" />
                  ) : diff.costChange < 0 ? (
                    <IconTrendingDown className="h-3 w-3 text-green-500" />
                  ) : (
                    <IconEqual className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      diff.costChange > 0
                        ? "text-red-600 dark:text-red-400"
                        : diff.costChange < 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {formatPercent(diff.costChangePercent)}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              {diff.executionTimeChange !== undefined && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Execution Time:
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        {formatTime(parsed1.executionTime || 0)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono">
                        {formatTime(parsed2.executionTime || 0)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Change:</span>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        diff.executionTimeChange > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-green-600 dark:text-green-400",
                      )}
                    >
                      {diff.executionTimeChange > 0 ? "+" : ""}
                      {formatTime(diff.executionTimeChange)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {(diff.nodeTypeChanges.length > 0 ||
            diff.newNodes.length > 0 ||
            diff.removedNodes.length > 0) && (
            <div className="pt-2 mt-2 border-t space-y-1 text-xs">
              {diff.nodeTypeChanges.length > 0 && (
                <div className="text-amber-600 dark:text-amber-400">
                  {diff.nodeTypeChanges.length} node type change
                  {diff.nodeTypeChanges.length !== 1 ? "s" : ""}
                </div>
              )}
              {diff.newNodes.length > 0 && (
                <div className="text-green-600 dark:text-green-400">
                  {diff.newNodes.length} new node
                  {diff.newNodes.length !== 1 ? "s" : ""}
                </div>
              )}
              {diff.removedNodes.length > 0 && (
                <div className="text-red-600 dark:text-red-400">
                  {diff.removedNodes.length} removed node
                  {diff.removedNodes.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Node comparison */}
      <div className="flex-1 overflow-auto">
        <div className="divide-y">
          {allPaths.map((path) => {
            const node1 = nodeMap1.get(path);
            const node2 = nodeMap2.get(path);
            const depth = path.split(">").length - 1;

            return (
              <NodeDiff key={path} node1={node1} node2={node2} depth={depth} />
            );
          })}
        </div>
      </div>
    </div>
  );
});
