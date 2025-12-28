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

// ============================================================================
// TYPES
// ============================================================================

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
  // Conditions
  filter?: string;
  hashCond?: string;
  joinFilter?: string;
  mergeCond?: string;
  indexCond?: string;
  recheckCond?: string;
  tidCond?: string;
  oneTimeFilter?: string;
  // Sort/Group
  sortKey?: string[];
  groupKey?: string[];
  presortedKey?: string[];
  output?: string[];
  // Index
  indexName?: string;
  scanDirection?: string;
  // Join
  joinType?: string;
  innerUnique?: boolean;
  // Parallel
  workersPlanned?: number;
  workersLaunched?: number;
  parallelAware?: boolean;
  asyncCapable?: boolean;
  // Per-worker stats
  workers?: Array<{
    workerNumber: number;
    actualTime?: { startup: number; total: number };
    actualRows?: number;
    loops?: number;
    buffers?: ExplainNode["buffers"];
    wal?: ExplainNode["wal"];
  }>;
  // Stats
  rowsRemoved?: { type: string; count: number };
  heapFetches?: number;
  exactHeapBlocks?: number;
  lossyHeapBlocks?: number;
  // Sort details
  sortMethod?: string;
  sortSpaceUsed?: number;
  sortSpaceType?: string;
  // Incremental Sort
  fullSortGroups?: { count: number; memoryUsed: number; memoryType: string };
  preSortedGroups?: { count: number; memoryUsed: number; memoryType: string };
  // Hash details
  hashBuckets?: number;
  hashBatches?: number;
  originalHashBatches?: number;
  peakMemoryUsage?: number;
  diskUsage?: number;
  // Memoize cache stats
  cacheHits?: number;
  cacheMisses?: number;
  cacheEvictions?: number;
  cacheOverflows?: number;
  cacheMemoryUsage?: number;
  // Buffers
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
  // WAL stats
  wal?: { records?: number; fpi?: number; bytes?: number };
  // Memory stats (PG17+)
  memory?: { used?: number; allocated?: number };
  // Conflict resolution (INSERT ON CONFLICT)
  conflictResolution?: string;
  conflictArbiterIndexes?: string[];
  tuplesInserted?: number;
  conflictingTuples?: number;
  // CTE/SubPlan
  cteName?: string;
  subplanName?: string;
  // PG15+ features
  runCondition?: string;
  neverExecuted?: boolean;
  subplansRemoved?: number;
  // Partitioning
  partitionsRemoved?: number;
  plannedPartitions?: number;
  // Sampling
  samplingMethod?: string;
  // Grouping sets
  groupingSets?: string[];
  // Parallel aggregate
  partialMode?: string;
  // Children
  children?: ExplainNode[];
  raw?: string;
  [key: string]: unknown;
}

interface JitInfo {
  functions?: number;
  options?: {
    inlining?: boolean;
    optimization?: boolean;
    expressions?: boolean;
    deforming?: boolean;
  };
  timing?: {
    generation?: number;
    inlining?: number;
    optimization?: number;
    emission?: number;
    total?: number;
  };
}

interface ParsedExplain {
  nodes: ExplainNode[];
  planningTime?: number;
  executionTime?: number;
  totalCost: number;
  totalActualTime?: number; // Root's actual time * loops (for ANALYZE)
  raw: string;
  triggers?: { name: string; time: number; calls: number }[];
  settings?: string[];
  queryIdentifier?: string;
  jit?: JitInfo;
}

interface ExplainViewerProps {
  result: {
    columns: string[];
    rows: unknown[][];
  };
  className?: string;
  viewMode?: "explain" | "raw" | "stats";
  tabId?: string;
  currentQuery?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Complete list of PostgreSQL plan node types
const NODE_TYPES = [
  // Scan nodes
  "Seq Scan",
  "Parallel Seq Scan",
  "Index Scan",
  "Index Only Scan",
  "Bitmap Index Scan",
  "Bitmap Heap Scan",
  "Tid Scan",
  "Tid Range Scan",
  "Subquery Scan",
  "Function Scan",
  "Table Function Scan",
  "Values Scan",
  "CTE Scan",
  "Named Tuplestore Scan",
  "WorkTable Scan",
  "Foreign Scan",
  "Custom Scan",
  "Sample Scan",
  // Join nodes
  "Nested Loop",
  "Hash Join",
  "Merge Join",
  // Materialize
  "Hash",
  "Materialize",
  "Memoize",
  // Aggregate
  "Aggregate",
  "HashAggregate",
  "GroupAggregate",
  "Mixed Aggregate",
  // Sort
  "Sort",
  "Incremental Sort",
  // Set operations
  "Append",
  "Merge Append",
  "Recursive Union",
  "BitmapAnd",
  "BitmapOr",
  "SetOp",
  "Unique",
  // Control
  "Limit",
  "LockRows",
  "ModifyTable",
  "Result",
  "ProjectSet",
  "Group",
  // Parallel
  "Gather",
  "Gather Merge",
  // Window
  "WindowAgg",
  // CTE headers
  "CTE",
  "InitPlan",
  "SubPlan",
];

// Attribute line prefixes (these are NOT nodes)
const ATTRIBUTE_PREFIXES = [
  // Conditions
  "Hash Cond:",
  "Join Filter:",
  "Filter:",
  "Merge Cond:",
  "Index Cond:",
  "Recheck Cond:",
  "TID Cond:",
  "One-Time Filter:",
  // Keys
  "Sort Key:",
  "Group Key:",
  "Presorted Key:",
  "Output:",
  // Buffers & I/O
  "Buffers:",
  "I/O Timings:",
  // Parallel
  "Workers Planned:",
  "Workers Launched:",
  "Worker", // Worker 0:, Worker 1:, etc.
  "Parallel Aware:",
  "Async Capable:",
  "Single Copy:",
  // Stats
  "Rows Removed by",
  "Heap Fetches:",
  "Exact Heap Blocks:",
  "Lossy Heap Blocks:",
  // Sort
  "Sort Method:",
  "Sort Space Used:",
  "Sort Space Type:",
  // Incremental Sort
  "Full-sort Groups:",
  "Pre-sorted Groups:",
  // Hash
  "Hash Buckets:",
  "Hash Batches:",
  "Original Hash Batches:",
  "Peak Memory Usage:",
  "Disk Usage:",
  // Memoize
  "Cache Key:",
  "Cache Mode:",
  "Hits:",
  "Misses:",
  "Evictions:",
  "Overflows:",
  "Memory Usage:",
  // WAL
  "WAL:",
  // Memory (PG17+)
  "Memory:",
  // Triggers
  "Trigger",
  // Settings
  "Planning:",
  "Settings:",
  "Query Identifier:",
  // Join
  "Inner Unique:",
  // Relation info
  "Relation Name:",
  "Alias:",
  "Schema:",
  "Function Name:",
  "Function Call:",
  "Remote SQL:",
  "Scan Direction:",
  // Conflict resolution
  "Conflict Resolution:",
  "Conflict Arbiter Indexes:",
  "Tuples Inserted:",
  "Conflicting Tuples:",
  // PG15+ features
  "Run Condition:",
  "Subplans Removed:",
  // Partitioning
  "Partitions Removed:",
  "Planned Partitions:",
  // Sampling
  "Sampling:",
  "Repeatable:",
  // Grouping sets
  "Grouping Sets:",
  "Group Keys:",
  // Parallel aggregate
  "Partial Mode:",
  // Never executed
  "never executed",
];

// ============================================================================
// PARSING - TEXT FORMAT
// ============================================================================

let nodeIdCounter = 0;

function isAttributeLine(content: string): boolean {
  const trimmed = content.trim();
  return ATTRIBUTE_PREFIXES.some(
    (prefix) =>
      trimmed.startsWith(prefix) ||
      trimmed.toLowerCase().startsWith(prefix.toLowerCase()),
  );
}

function isNodeLine(content: string): boolean {
  // Has cost estimation - definitely a node
  if (content.includes("cost=")) return true;
  // Has actual timing - definitely a node
  if (content.includes("actual time=")) return true;
  // Check against known node types
  const trimmed = content.trim();
  return NODE_TYPES.some(
    (nodeType) =>
      trimmed.startsWith(nodeType) ||
      trimmed.toLowerCase().startsWith(nodeType.toLowerCase()),
  );
}

function parseNodeAttributes(node: ExplainNode, content: string): void {
  const trimmed = content.trim();

  // Hash Cond
  if (trimmed.startsWith("Hash Cond:")) {
    node.hashCond = trimmed.slice(10).trim();
    return;
  }
  // Join Filter
  if (trimmed.startsWith("Join Filter:")) {
    node.joinFilter = trimmed.slice(12).trim();
    return;
  }
  // Filter
  if (trimmed.startsWith("Filter:")) {
    node.filter = trimmed.slice(7).trim();
    return;
  }
  // Merge Cond
  if (trimmed.startsWith("Merge Cond:")) {
    node.mergeCond = trimmed.slice(11).trim();
    return;
  }
  // Index Cond
  if (trimmed.startsWith("Index Cond:")) {
    node.indexCond = trimmed.slice(11).trim();
    return;
  }
  // Recheck Cond
  if (trimmed.startsWith("Recheck Cond:")) {
    node.recheckCond = trimmed.slice(13).trim();
    return;
  }
  // TID Cond
  if (trimmed.startsWith("TID Cond:")) {
    node.tidCond = trimmed.slice(9).trim();
    return;
  }
  // One-Time Filter
  if (trimmed.startsWith("One-Time Filter:")) {
    node.oneTimeFilter = trimmed.slice(16).trim();
    return;
  }
  // Sort Key
  if (trimmed.startsWith("Sort Key:")) {
    node.sortKey = trimmed.slice(9).trim().split(/,\s*/);
    return;
  }
  // Group Key
  if (trimmed.startsWith("Group Key:")) {
    node.groupKey = trimmed.slice(10).trim().split(/,\s*/);
    return;
  }
  // Presorted Key
  if (trimmed.startsWith("Presorted Key:")) {
    node.presortedKey = trimmed.slice(14).trim().split(/,\s*/);
    return;
  }
  // Output
  if (trimmed.startsWith("Output:")) {
    node.output = trimmed.slice(7).trim().split(/,\s*/);
    return;
  }
  // Workers Planned
  if (trimmed.startsWith("Workers Planned:")) {
    node.workersPlanned = parseInt(trimmed.slice(16).trim(), 10);
    return;
  }
  // Workers Launched
  if (trimmed.startsWith("Workers Launched:")) {
    node.workersLaunched = parseInt(trimmed.slice(17).trim(), 10);
    return;
  }
  // Rows Removed by Filter/Join Filter/Index Recheck
  const rowsRemovedMatch = trimmed.match(
    /Rows Removed by (\w+(?:\s+\w+)?):\s*(\d+)/i,
  );
  if (rowsRemovedMatch) {
    node.rowsRemoved = {
      type: rowsRemovedMatch[1] || "Filter",
      count: parseInt(rowsRemovedMatch[2] || "0", 10),
    };
    return;
  }
  // Heap Fetches
  if (trimmed.startsWith("Heap Fetches:")) {
    node.heapFetches = parseInt(trimmed.slice(13).trim(), 10);
    return;
  }
  // Exact Heap Blocks
  if (trimmed.startsWith("Exact Heap Blocks:")) {
    node.exactHeapBlocks = parseInt(trimmed.slice(18).trim(), 10);
    return;
  }
  // Lossy Heap Blocks
  if (trimmed.startsWith("Lossy Heap Blocks:")) {
    node.lossyHeapBlocks = parseInt(trimmed.slice(18).trim(), 10);
    return;
  }
  // Sort Method
  if (trimmed.startsWith("Sort Method:")) {
    node.sortMethod = trimmed.slice(12).trim();
    return;
  }
  // Sort Space Used
  const sortSpaceMatch = trimmed.match(/Sort Space Used:\s*(\d+)kB/i);
  if (sortSpaceMatch) {
    node.sortSpaceUsed = parseInt(sortSpaceMatch[1] || "0", 10);
    return;
  }
  // Sort Space Type
  if (trimmed.startsWith("Sort Space Type:")) {
    node.sortSpaceType = trimmed.slice(16).trim();
    return;
  }
  // Scan Direction
  if (trimmed.startsWith("Scan Direction:")) {
    node.scanDirection = trimmed.slice(15).trim();
    return;
  }
  // Parallel Aware
  if (trimmed.startsWith("Parallel Aware:")) {
    node.parallelAware = trimmed.slice(15).trim().toLowerCase() === "true";
    return;
  }
  // Async Capable
  if (trimmed.startsWith("Async Capable:")) {
    node.asyncCapable = trimmed.slice(14).trim().toLowerCase() === "true";
    return;
  }
  // Inner Unique
  if (trimmed.startsWith("Inner Unique:")) {
    node.innerUnique = trimmed.slice(13).trim().toLowerCase() === "true";
    return;
  }
  // Full-sort Groups (Incremental Sort)
  const fullSortMatch = trimmed.match(
    /Full-sort Groups:\s*(\d+)\s+Sort Methods?:\s*(\w+)\s+(?:Average )?Memory:\s*(\d+)kB/i,
  );
  if (fullSortMatch) {
    node.fullSortGroups = {
      count: parseInt(fullSortMatch[1] || "0", 10),
      memoryUsed: parseInt(fullSortMatch[3] || "0", 10),
      memoryType: fullSortMatch[2] || "unknown",
    };
    return;
  }
  // Pre-sorted Groups (Incremental Sort)
  const preSortedMatch = trimmed.match(
    /Pre-sorted Groups:\s*(\d+)\s+Sort Methods?:\s*(\w+)\s+(?:Average )?Memory:\s*(\d+)kB/i,
  );
  if (preSortedMatch) {
    node.preSortedGroups = {
      count: parseInt(preSortedMatch[1] || "0", 10),
      memoryUsed: parseInt(preSortedMatch[3] || "0", 10),
      memoryType: preSortedMatch[2] || "unknown",
    };
    return;
  }
  // Hash Buckets
  if (trimmed.startsWith("Hash Buckets:") || trimmed.startsWith("Buckets:")) {
    const match = trimmed.match(/(?:Hash )?Buckets:\s*(\d+)/i);
    if (match) node.hashBuckets = parseInt(match[1] || "0", 10);
    return;
  }
  // Hash Batches
  if (trimmed.startsWith("Batches:")) {
    node.hashBatches = parseInt(trimmed.slice(8).trim(), 10);
    return;
  }
  // Original Hash Batches
  if (trimmed.startsWith("Original Hash Batches:")) {
    node.originalHashBatches = parseInt(trimmed.slice(22).trim(), 10);
    return;
  }
  // Peak Memory Usage
  const peakMemMatch = trimmed.match(/Peak Memory Usage:\s*(\d+)\s*kB/i);
  if (peakMemMatch) {
    node.peakMemoryUsage = parseInt(peakMemMatch[1] || "0", 10);
    return;
  }
  // Disk Usage (for Hash)
  const diskUsageMatch = trimmed.match(/Disk Usage:\s*(\d+)\s*kB/i);
  if (diskUsageMatch) {
    node.diskUsage = parseInt(diskUsageMatch[1] || "0", 10);
    return;
  }
  // Memoize - Hits
  if (trimmed.startsWith("Hits:")) {
    node.cacheHits = parseInt(trimmed.slice(5).trim(), 10);
    return;
  }
  // Memoize - Misses
  if (trimmed.startsWith("Misses:")) {
    node.cacheMisses = parseInt(trimmed.slice(7).trim(), 10);
    return;
  }
  // Memoize - Evictions
  if (trimmed.startsWith("Evictions:")) {
    node.cacheEvictions = parseInt(trimmed.slice(10).trim(), 10);
    return;
  }
  // Memoize - Overflows
  if (trimmed.startsWith("Overflows:")) {
    node.cacheOverflows = parseInt(trimmed.slice(10).trim(), 10);
    return;
  }
  // Memoize - Memory Usage
  const cacheMemMatch = trimmed.match(/Memory Usage:\s*(\d+)\s*kB/i);
  if (cacheMemMatch) {
    node.cacheMemoryUsage = parseInt(cacheMemMatch[1] || "0", 10);
    return;
  }
  // WAL stats
  const walMatch = trimmed.match(
    /WAL:\s*records=(\d+)\s+fpi=(\d+)\s+bytes=(\d+)/i,
  );
  if (walMatch) {
    node.wal = {
      records: parseInt(walMatch[1] || "0", 10),
      fpi: parseInt(walMatch[2] || "0", 10),
      bytes: parseInt(walMatch[3] || "0", 10),
    };
    return;
  }
  // Memory stats (PG17+)
  const memoryMatch = trimmed.match(
    /Memory:\s*used=(\d+)kB\s+allocated=(\d+)kB/i,
  );
  if (memoryMatch) {
    node.memory = {
      used: parseInt(memoryMatch[1] || "0", 10),
      allocated: parseInt(memoryMatch[2] || "0", 10),
    };
    return;
  }
  // Conflict Resolution (INSERT ON CONFLICT)
  if (trimmed.startsWith("Conflict Resolution:")) {
    node.conflictResolution = trimmed.slice(20).trim();
    return;
  }
  // Conflict Arbiter Indexes
  if (trimmed.startsWith("Conflict Arbiter Indexes:")) {
    node.conflictArbiterIndexes = trimmed.slice(25).trim().split(/,\s*/);
    return;
  }
  // Tuples Inserted
  if (trimmed.startsWith("Tuples Inserted:")) {
    node.tuplesInserted = parseInt(trimmed.slice(16).trim(), 10);
    return;
  }
  // Conflicting Tuples
  if (trimmed.startsWith("Conflicting Tuples:")) {
    node.conflictingTuples = parseInt(trimmed.slice(19).trim(), 10);
    return;
  }
  // Run Condition (PG15+ WindowAgg optimization)
  if (trimmed.startsWith("Run Condition:")) {
    node.runCondition = trimmed.slice(14).trim();
    return;
  }
  // Never executed (runtime pruned)
  if (trimmed.toLowerCase().includes("never executed")) {
    node.neverExecuted = true;
    return;
  }
  // Subplans Removed (partition pruning)
  if (trimmed.startsWith("Subplans Removed:")) {
    node.subplansRemoved = parseInt(trimmed.slice(17).trim(), 10);
    return;
  }
  // Partitions Removed
  if (trimmed.startsWith("Partitions Removed:")) {
    node.partitionsRemoved = parseInt(trimmed.slice(19).trim(), 10);
    return;
  }
  // Planned Partitions
  if (trimmed.startsWith("Planned Partitions:")) {
    node.plannedPartitions = parseInt(trimmed.slice(19).trim(), 10);
    return;
  }
  // Sampling method
  if (trimmed.startsWith("Sampling:")) {
    node.samplingMethod = trimmed.slice(9).trim();
    return;
  }
  // Grouping Sets
  if (trimmed.startsWith("Grouping Sets:")) {
    node.groupingSets = trimmed.slice(14).trim().split(/,\s*/);
    return;
  }
  // Partial Mode (parallel aggregate)
  if (trimmed.startsWith("Partial Mode:")) {
    node.partialMode = trimmed.slice(13).trim();
    return;
  }
  // Worker N: stats (per-worker)
  const workerMatch = trimmed.match(
    /Worker (\d+):\s*actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)/i,
  );
  if (workerMatch) {
    if (!node.workers) node.workers = [];
    node.workers.push({
      workerNumber: parseInt(workerMatch[1] || "0", 10),
      actualTime: {
        startup: parseFloat(workerMatch[2] || "0"),
        total: parseFloat(workerMatch[3] || "0"),
      },
      actualRows: parseInt(workerMatch[4] || "0", 10),
      loops: parseInt(workerMatch[5] || "0", 10),
    });
    return;
  }
  // Buffers
  if (trimmed.startsWith("Buffers:")) {
    parseBuffersAttribute(node, trimmed.slice(8).trim());
    return;
  }
  // I/O Timings
  if (trimmed.startsWith("I/O Timings:")) {
    parseIOTimingAttribute(node, trimmed.slice(12).trim());
    return;
  }
}

function parseBuffersAttribute(node: ExplainNode, buffersStr: string): void {
  if (!node.buffers) node.buffers = {};

  // shared hit=X read=Y dirtied=Z written=W
  const sharedHit = buffersStr.match(/shared hit=(\d+)/);
  const sharedRead = buffersStr.match(/shared read=(\d+)/);
  const sharedDirtied = buffersStr.match(/shared dirtied=(\d+)/);
  const sharedWritten = buffersStr.match(/shared written=(\d+)/);
  if (sharedHit || sharedRead || sharedDirtied || sharedWritten) {
    node.buffers.shared = {
      hit: sharedHit ? parseInt(sharedHit[1] || "0", 10) : undefined,
      read: sharedRead ? parseInt(sharedRead[1] || "0", 10) : undefined,
      dirtied: sharedDirtied
        ? parseInt(sharedDirtied[1] || "0", 10)
        : undefined,
      written: sharedWritten
        ? parseInt(sharedWritten[1] || "0", 10)
        : undefined,
    };
  }

  // local buffers
  const localHit = buffersStr.match(/local hit=(\d+)/);
  const localRead = buffersStr.match(/local read=(\d+)/);
  const localDirtied = buffersStr.match(/local dirtied=(\d+)/);
  const localWritten = buffersStr.match(/local written=(\d+)/);
  if (localHit || localRead || localDirtied || localWritten) {
    node.buffers.local = {
      hit: localHit ? parseInt(localHit[1] || "0", 10) : undefined,
      read: localRead ? parseInt(localRead[1] || "0", 10) : undefined,
      dirtied: localDirtied ? parseInt(localDirtied[1] || "0", 10) : undefined,
      written: localWritten ? parseInt(localWritten[1] || "0", 10) : undefined,
    };
  }

  // temp buffers
  const tempRead = buffersStr.match(/temp read=(\d+)/);
  const tempWritten = buffersStr.match(/temp written=(\d+)/);
  if (tempRead || tempWritten) {
    node.buffers.temp = {
      read: tempRead ? parseInt(tempRead[1] || "0", 10) : undefined,
      written: tempWritten ? parseInt(tempWritten[1] || "0", 10) : undefined,
    };
  }
}

function parseIOTimingAttribute(node: ExplainNode, timingStr: string): void {
  const readMatch = timingStr.match(/read=([\d.]+)/);
  const writeMatch = timingStr.match(/write=([\d.]+)/);
  if (readMatch || writeMatch) {
    node.ioTiming = {
      read: readMatch ? parseFloat(readMatch[1] || "0") : undefined,
      write: writeMatch ? parseFloat(writeMatch[1] || "0") : undefined,
    };
  }
}

function parseNodeLine(content: string): ExplainNode {
  const node: ExplainNode = { id: "", type: "Unknown" };

  // Extract node type - match against known types first
  for (const nodeType of NODE_TYPES) {
    if (content.toLowerCase().startsWith(nodeType.toLowerCase())) {
      node.type = nodeType;
      break;
    }
  }

  // Fallback: extract type from pattern
  if (node.type === "Unknown") {
    const typeMatch = content.match(
      /^([A-Za-z][A-Za-z\s]+?)(?:\s+on|\s+using|\s*\(|$)/i,
    );
    if (typeMatch && typeMatch[1]) {
      node.type = typeMatch[1].trim();
    }
  }

  // Relation and alias: "on tablename alias" or "on tablename"
  const relationMatch = content.match(/\bon\s+(\w+)(?:\s+(\w+))?/i);
  if (relationMatch) {
    node.relation = relationMatch[1];
    node.alias = relationMatch[2];
  }

  // Index: "using indexname"
  const indexMatch = content.match(/\busing\s+(\w+)/i);
  if (indexMatch) {
    node.indexName = indexMatch[1];
  }

  // CTE/SubPlan/InitPlan name
  const cteMatch = content.match(/^CTE\s+(\w+)/i);
  if (cteMatch) {
    node.cteName = cteMatch[1];
  }
  const subplanMatch = content.match(/^(SubPlan|InitPlan)\s+(\d+)/i);
  if (subplanMatch) {
    node.subplanName = `${subplanMatch[1]} ${subplanMatch[2]}`;
  }

  // Join type (for joins)
  const joinTypeMatch = content.match(/\b(Inner|Left|Right|Full|Semi|Anti)\b/i);
  if (joinTypeMatch) {
    node.joinType = joinTypeMatch[1];
  }

  // Cost: cost=startup..total
  const costMatch = content.match(/cost=([\d.]+)\.\.([\d.]+)/);
  if (costMatch) {
    node.cost = {
      startup: parseFloat(costMatch[1] || "0"),
      total: parseFloat(costMatch[2] || "0"),
    };
  }

  // Estimated rows and width
  const rowsMatch = content.match(/\brows=(\d+)/);
  if (rowsMatch) {
    node.rows = parseInt(rowsMatch[1] || "0", 10);
  }

  const widthMatch = content.match(/\bwidth=(\d+)/);
  if (widthMatch) {
    node.width = parseInt(widthMatch[1] || "0", 10);
  }

  // Actual timing: actual time=startup..total
  const actualMatch = content.match(/actual time=([\d.]+)\.\.([\d.]+)/);
  if (actualMatch) {
    node.actualTime = {
      startup: parseFloat(actualMatch[1] || "0"),
      total: parseFloat(actualMatch[2] || "0"),
    };
  }

  // Actual rows and loops: rows=X loops=Y
  const actualRowsLoopsMatch = content.match(/\brows=(\d+)\s+loops=(\d+)/);
  if (actualRowsLoopsMatch) {
    node.actualRows = parseInt(actualRowsLoopsMatch[1] || "0", 10);
    node.loops = parseInt(actualRowsLoopsMatch[2] || "0", 10);
  }

  return node;
}

function parsePostgresExplain(rows: unknown[][]): ParsedExplain {
  nodeIdCounter = 0;
  const lines: string[] = [];

  for (const row of rows) {
    const line = row[0];
    if (typeof line === "string") {
      lines.push(line);
    }
  }

  const raw = lines.join("\n");

  // Check for JSON format
  const trimmedRaw = raw.trim();
  if (trimmedRaw.startsWith("[") || trimmedRaw.startsWith("{")) {
    try {
      const jsonData = JSON.parse(trimmedRaw);
      return parseJsonExplain(jsonData, raw);
    } catch {
      // Not valid JSON, continue with text parsing
    }
  }

  let planningTime: number | undefined;
  let executionTime: number | undefined;
  const triggers: ParsedExplain["triggers"] = [];
  const settings: string[] = [];
  let queryIdentifier: string | undefined;
  let jit: JitInfo | undefined;

  for (const line of lines) {
    const planningMatch = line.match(/Planning Time:\s*([\d.]+)\s*ms/i);
    if (planningMatch) {
      planningTime = parseFloat(planningMatch[1] || "0");
    }
    const executionMatch = line.match(/Execution Time:\s*([\d.]+)\s*ms/i);
    if (executionMatch) {
      executionTime = parseFloat(executionMatch[1] || "0");
    }
    // Trigger info
    const triggerMatch = line.match(
      /Trigger\s+(\w+):\s*time=([\d.]+)\s*calls=(\d+)/i,
    );
    if (triggerMatch) {
      triggers.push({
        name: triggerMatch[1] || "unknown",
        time: parseFloat(triggerMatch[2] || "0"),
        calls: parseInt(triggerMatch[3] || "0", 10),
      });
    }
    // Settings
    if (line.trim().startsWith("Settings:")) {
      settings.push(line.replace("Settings:", "").trim());
    }
    // Query Identifier
    const qidMatch = line.match(/Query Identifier:\s*(-?\d+)/);
    if (qidMatch) {
      queryIdentifier = qidMatch[1];
    }
    // JIT Functions
    const jitFunctionsMatch = line.match(/Functions:\s*(\d+)/i);
    if (jitFunctionsMatch) {
      jit = jit || {};
      jit.functions = parseInt(jitFunctionsMatch[1] || "0", 10);
    }
    // JIT Options
    const jitOptionsMatch = line.match(
      /Options:\s*Inlining\s*(true|false),?\s*Optimization\s*(true|false),?\s*Expressions\s*(true|false),?\s*Deforming\s*(true|false)/i,
    );
    if (jitOptionsMatch) {
      jit = jit || {};
      jit.options = {
        inlining: jitOptionsMatch[1]?.toLowerCase() === "true",
        optimization: jitOptionsMatch[2]?.toLowerCase() === "true",
        expressions: jitOptionsMatch[3]?.toLowerCase() === "true",
        deforming: jitOptionsMatch[4]?.toLowerCase() === "true",
      };
    }
    // JIT Timing
    const jitTimingMatch = line.match(
      /Timing:\s*Generation\s*([\d.]+)\s*ms,?\s*Inlining\s*([\d.]+)\s*ms,?\s*Optimization\s*([\d.]+)\s*ms,?\s*Emission\s*([\d.]+)\s*ms,?\s*Total\s*([\d.]+)\s*ms/i,
    );
    if (jitTimingMatch) {
      jit = jit || {};
      jit.timing = {
        generation: parseFloat(jitTimingMatch[1] || "0"),
        inlining: parseFloat(jitTimingMatch[2] || "0"),
        optimization: parseFloat(jitTimingMatch[3] || "0"),
        emission: parseFloat(jitTimingMatch[4] || "0"),
        total: parseFloat(jitTimingMatch[5] || "0"),
      };
    }
  }

  const nodes: ExplainNode[] = [];
  const stack: { node: ExplainNode; indent: number }[] = [];

  for (const line of lines) {
    // Skip metadata lines
    const trimmedLine = line.trim();
    if (
      line.startsWith("Planning Time:") ||
      line.startsWith("Execution Time:") ||
      line.startsWith("Settings:") ||
      line.match(/^Query Identifier:/) ||
      trimmedLine === "JIT:" ||
      trimmedLine.startsWith("Functions:") ||
      trimmedLine.startsWith("Options:") ||
      trimmedLine.startsWith("Timing:")
    ) {
      continue;
    }

    const match = line.match(/^(\s*)(->)?\s*(.+)$/);
    if (!match) continue;

    const indent = (match[1] || "").length + (match[2] ? 3 : 0);
    const content = (match[3] || "").trim();

    if (!content) continue;

    // Check if this is an attribute line - attach to current node on stack
    if (isAttributeLine(content)) {
      if (stack.length > 0) {
        const currentNode = stack[stack.length - 1]?.node;
        if (currentNode) {
          parseNodeAttributes(currentNode, content);
        }
      }
      continue;
    }

    // Skip lines that don't look like plan nodes
    if (!isNodeLine(content)) {
      continue;
    }

    const node = parseNodeLine(content);
    node.raw = line;
    node.id = `node-${nodeIdCounter++}`;

    // Pop nodes from stack that are at same or deeper indent
    while (stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last && last.indent >= indent) {
        stack.pop();
      } else {
        break;
      }
    }

    // Add to parent or root
    if (stack.length === 0) {
      nodes.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (parent) {
        if (!parent.node.children) {
          parent.node.children = [];
        }
        parent.node.children.push(node);
      }
    }

    stack.push({ node, indent });
  }

  // Total cost = root node's total cost (represents entire query cost)
  const totalCost = nodes[0]?.cost?.total || 0;

  // Total actual time = root's actual time * loops (for ANALYZE output)
  const rootNode = nodes[0];
  const totalActualTime = rootNode?.actualTime
    ? rootNode.actualTime.total * (rootNode.loops || 1)
    : undefined;

  return {
    nodes,
    planningTime,
    executionTime,
    totalCost,
    totalActualTime,
    raw,
    triggers: triggers.length > 0 ? triggers : undefined,
    settings: settings.length > 0 ? settings : undefined,
    queryIdentifier,
    jit,
  };
}

// ============================================================================
// PARSING - JSON FORMAT
// ============================================================================

interface JsonPlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  Alias?: string;
  Schema?: string;
  "Index Name"?: string;
  "Scan Direction"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Join Filter"?: string;
  Filter?: string;
  "Merge Cond"?: string;
  "Index Cond"?: string;
  "Recheck Cond"?: string;
  "TID Cond"?: string;
  "One-Time Filter"?: string;
  "Sort Key"?: string[];
  "Group Key"?: string[];
  "Presorted Key"?: string[];
  Output?: string[];
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Join Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  "Heap Fetches"?: number;
  "Exact Heap Blocks"?: number;
  "Lossy Heap Blocks"?: number;
  "Workers Planned"?: number;
  "Workers Launched"?: number;
  "Parallel Aware"?: boolean;
  "Sort Method"?: string;
  "Sort Space Used"?: number;
  "Sort Space Type"?: string;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Shared Dirtied Blocks"?: number;
  "Shared Written Blocks"?: number;
  "Local Hit Blocks"?: number;
  "Local Read Blocks"?: number;
  "Local Dirtied Blocks"?: number;
  "Local Written Blocks"?: number;
  "Temp Read Blocks"?: number;
  "Temp Written Blocks"?: number;
  "I/O Read Time"?: number;
  "I/O Write Time"?: number;
  "CTE Name"?: string;
  "Subplan Name"?: string;
  // Async
  "Async Capable"?: boolean;
  // Inner Unique
  "Inner Unique"?: boolean;
  // Hash details
  "Hash Buckets"?: number;
  "Hash Batches"?: number;
  "Original Hash Batches"?: number;
  "Peak Memory Usage"?: number;
  // Memoize
  "Cache Key"?: string;
  "Cache Mode"?: string;
  "Cache Hits"?: number;
  "Cache Misses"?: number;
  "Cache Evictions"?: number;
  "Cache Overflows"?: number;
  // Incremental Sort
  "Full-sort Groups"?: {
    "Group Count": number;
    "Sort Methods Used": string[];
    "Sort Space Memory"?: {
      "Average Sort Space Used": number;
      "Peak Sort Space Used": number;
    };
  };
  "Pre-sorted Groups"?: {
    "Group Count": number;
    "Sort Methods Used": string[];
    "Sort Space Memory"?: {
      "Average Sort Space Used": number;
      "Peak Sort Space Used": number;
    };
  };
  // WAL
  "WAL Records"?: number;
  "WAL FPI"?: number;
  "WAL Bytes"?: number;
  // Memory (PG17+)
  "Memory Used"?: number;
  "Memory Allocated"?: number;
  // Workers
  Workers?: Array<{
    "Worker Number": number;
    "Actual Startup Time"?: number;
    "Actual Total Time"?: number;
    "Actual Rows"?: number;
    "Actual Loops"?: number;
    "Shared Hit Blocks"?: number;
    "Shared Read Blocks"?: number;
  }>;
  // Conflict resolution
  "Conflict Resolution"?: string;
  "Conflict Arbiter Indexes"?: string[];
  "Tuples Inserted"?: number;
  "Conflicting Tuples"?: number;
  Plans?: JsonPlanNode[];
}

interface JsonJitInfo {
  Functions?: number;
  Options?: {
    Inlining?: boolean;
    Optimization?: boolean;
    Expressions?: boolean;
    Deforming?: boolean;
  };
  Timing?: {
    Generation?: number;
    Inlining?: number;
    Optimization?: number;
    Emission?: number;
    Total?: number;
  };
}

interface JsonExplainResult {
  Plan?: JsonPlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: { "Trigger Name": string; Time: number; Calls: number }[];
  Settings?: Record<string, string>;
  "Query Identifier"?: string | number;
  JIT?: JsonJitInfo;
}

function parseJsonExplain(
  jsonData: JsonExplainResult[] | JsonExplainResult,
  raw: string,
): ParsedExplain {
  const data = Array.isArray(jsonData) ? jsonData[0] : jsonData;

  if (!data?.Plan) {
    return { nodes: [], totalCost: 0, raw };
  }

  const planningTime = data["Planning Time"];
  const executionTime = data["Execution Time"];
  const triggers = data.Triggers?.map((t) => ({
    name: t["Trigger Name"],
    time: t.Time,
    calls: t.Calls,
  }));
  const settings = data.Settings
    ? Object.entries(data.Settings).map(([k, v]) => `${k}=${v}`)
    : undefined;
  const queryIdentifier = data["Query Identifier"]?.toString();

  // Parse JIT from JSON
  let jit: JitInfo | undefined;
  if (data.JIT) {
    jit = {
      functions: data.JIT.Functions,
      options: data.JIT.Options
        ? {
            inlining: data.JIT.Options.Inlining,
            optimization: data.JIT.Options.Optimization,
            expressions: data.JIT.Options.Expressions,
            deforming: data.JIT.Options.Deforming,
          }
        : undefined,
      timing: data.JIT.Timing
        ? {
            generation: data.JIT.Timing.Generation,
            inlining: data.JIT.Timing.Inlining,
            optimization: data.JIT.Timing.Optimization,
            emission: data.JIT.Timing.Emission,
            total: data.JIT.Timing.Total,
          }
        : undefined,
    };
  }

  function convertNode(jsonNode: JsonPlanNode): ExplainNode {
    const node: ExplainNode = {
      id: `node-${nodeIdCounter++}`,
      type: jsonNode["Node Type"],
      relation: jsonNode["Relation Name"],
      alias: jsonNode["Alias"],
      schema: jsonNode["Schema"],
      indexName: jsonNode["Index Name"],
      scanDirection: jsonNode["Scan Direction"],
      joinType: jsonNode["Join Type"],
      hashCond: jsonNode["Hash Cond"],
      joinFilter: jsonNode["Join Filter"],
      filter: jsonNode["Filter"],
      mergeCond: jsonNode["Merge Cond"],
      indexCond: jsonNode["Index Cond"],
      recheckCond: jsonNode["Recheck Cond"],
      tidCond: jsonNode["TID Cond"],
      oneTimeFilter: jsonNode["One-Time Filter"],
      sortKey: jsonNode["Sort Key"],
      groupKey: jsonNode["Group Key"],
      presortedKey: jsonNode["Presorted Key"],
      output: jsonNode["Output"],
      workersPlanned: jsonNode["Workers Planned"],
      workersLaunched: jsonNode["Workers Launched"],
      parallelAware: jsonNode["Parallel Aware"],
      heapFetches: jsonNode["Heap Fetches"],
      exactHeapBlocks: jsonNode["Exact Heap Blocks"],
      lossyHeapBlocks: jsonNode["Lossy Heap Blocks"],
      sortMethod: jsonNode["Sort Method"],
      sortSpaceUsed: jsonNode["Sort Space Used"],
      sortSpaceType: jsonNode["Sort Space Type"],
      cteName: jsonNode["CTE Name"],
      subplanName: jsonNode["Subplan Name"],
      asyncCapable: jsonNode["Async Capable"],
      innerUnique: jsonNode["Inner Unique"],
      // Hash details
      hashBuckets: jsonNode["Hash Buckets"],
      hashBatches: jsonNode["Hash Batches"],
      originalHashBatches: jsonNode["Original Hash Batches"],
      peakMemoryUsage: jsonNode["Peak Memory Usage"],
      // Memoize
      cacheHits: jsonNode["Cache Hits"],
      cacheMisses: jsonNode["Cache Misses"],
      cacheEvictions: jsonNode["Cache Evictions"],
      cacheOverflows: jsonNode["Cache Overflows"],
      // Conflict resolution
      conflictResolution: jsonNode["Conflict Resolution"],
      conflictArbiterIndexes: jsonNode["Conflict Arbiter Indexes"],
      tuplesInserted: jsonNode["Tuples Inserted"],
      conflictingTuples: jsonNode["Conflicting Tuples"],
    };

    // Cost
    if (jsonNode["Total Cost"] !== undefined) {
      node.cost = {
        startup: jsonNode["Startup Cost"] || 0,
        total: jsonNode["Total Cost"],
      };
    }

    // Rows/Width
    node.rows = jsonNode["Plan Rows"];
    node.width = jsonNode["Plan Width"];

    // Actual timing
    if (jsonNode["Actual Total Time"] !== undefined) {
      node.actualTime = {
        startup: jsonNode["Actual Startup Time"] || 0,
        total: jsonNode["Actual Total Time"],
      };
    }

    node.actualRows = jsonNode["Actual Rows"];
    node.loops = jsonNode["Actual Loops"];

    // Rows removed
    if (jsonNode["Rows Removed by Filter"] !== undefined) {
      node.rowsRemoved = {
        type: "Filter",
        count: jsonNode["Rows Removed by Filter"],
      };
    } else if (jsonNode["Rows Removed by Join Filter"] !== undefined) {
      node.rowsRemoved = {
        type: "Join Filter",
        count: jsonNode["Rows Removed by Join Filter"],
      };
    } else if (jsonNode["Rows Removed by Index Recheck"] !== undefined) {
      node.rowsRemoved = {
        type: "Index Recheck",
        count: jsonNode["Rows Removed by Index Recheck"],
      };
    }

    // Buffers
    if (
      jsonNode["Shared Hit Blocks"] !== undefined ||
      jsonNode["Shared Read Blocks"] !== undefined
    ) {
      node.buffers = {
        shared: {
          hit: jsonNode["Shared Hit Blocks"],
          read: jsonNode["Shared Read Blocks"],
          dirtied: jsonNode["Shared Dirtied Blocks"],
          written: jsonNode["Shared Written Blocks"],
        },
        local: {
          hit: jsonNode["Local Hit Blocks"],
          read: jsonNode["Local Read Blocks"],
          dirtied: jsonNode["Local Dirtied Blocks"],
          written: jsonNode["Local Written Blocks"],
        },
        temp: {
          read: jsonNode["Temp Read Blocks"],
          written: jsonNode["Temp Written Blocks"],
        },
      };
    }

    // I/O Timing
    if (
      jsonNode["I/O Read Time"] !== undefined ||
      jsonNode["I/O Write Time"] !== undefined
    ) {
      node.ioTiming = {
        read: jsonNode["I/O Read Time"],
        write: jsonNode["I/O Write Time"],
      };
    }

    // WAL stats
    if (
      jsonNode["WAL Records"] !== undefined ||
      jsonNode["WAL FPI"] !== undefined ||
      jsonNode["WAL Bytes"] !== undefined
    ) {
      node.wal = {
        records: jsonNode["WAL Records"],
        fpi: jsonNode["WAL FPI"],
        bytes: jsonNode["WAL Bytes"],
      };
    }

    // Memory stats (PG17+)
    if (
      jsonNode["Memory Used"] !== undefined ||
      jsonNode["Memory Allocated"] !== undefined
    ) {
      node.memory = {
        used: jsonNode["Memory Used"],
        allocated: jsonNode["Memory Allocated"],
      };
    }

    // Workers (parallel)
    if (jsonNode.Workers && jsonNode.Workers.length > 0) {
      node.workers = jsonNode.Workers.map((w) => ({
        workerNumber: w["Worker Number"],
        actualTime:
          w["Actual Total Time"] !== undefined
            ? {
                startup: w["Actual Startup Time"] || 0,
                total: w["Actual Total Time"],
              }
            : undefined,
        actualRows: w["Actual Rows"],
        loops: w["Actual Loops"],
        buffers:
          w["Shared Hit Blocks"] !== undefined ||
          w["Shared Read Blocks"] !== undefined
            ? {
                shared: {
                  hit: w["Shared Hit Blocks"],
                  read: w["Shared Read Blocks"],
                },
              }
            : undefined,
      }));
    }

    // Incremental Sort groups
    if (jsonNode["Full-sort Groups"]) {
      const fg = jsonNode["Full-sort Groups"];
      node.fullSortGroups = {
        count: fg["Group Count"],
        memoryUsed: fg["Sort Space Memory"]?.["Average Sort Space Used"] || 0,
        memoryType: fg["Sort Methods Used"]?.join(", ") || "unknown",
      };
    }
    if (jsonNode["Pre-sorted Groups"]) {
      const pg = jsonNode["Pre-sorted Groups"];
      node.preSortedGroups = {
        count: pg["Group Count"],
        memoryUsed: pg["Sort Space Memory"]?.["Average Sort Space Used"] || 0,
        memoryType: pg["Sort Methods Used"]?.join(", ") || "unknown",
      };
    }

    // Children
    if (jsonNode.Plans && jsonNode.Plans.length > 0) {
      node.children = jsonNode.Plans.map(convertNode);
    }

    return node;
  }

  const rootNode = convertNode(data.Plan);
  const nodes = [rootNode];

  // Total cost = root node's total cost (represents entire query cost)
  const totalCost = rootNode.cost?.total || 0;

  // Total actual time = root's actual time * loops (for ANALYZE output)
  const totalActualTime = rootNode.actualTime
    ? rootNode.actualTime.total * (rootNode.loops || 1)
    : undefined;

  return {
    nodes,
    planningTime,
    executionTime,
    totalCost,
    totalActualTime,
    raw,
    triggers,
    settings,
    queryIdentifier,
    jit,
  };
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
        <div className="w-4 h-5 flex items-center justify-center flex-shrink-0">
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
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-px"
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
                !node.indexName,
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
                    {node.subplanName.split(" ")[1]}
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
              </span>
            )}
            {node.actualRows !== undefined && (
              <span>
                Actual Rows:{" "}
                <span className="font-mono">
                  {node.actualRows.toLocaleString()}
                </span>
              </span>
            )}
            {node.loops !== undefined && (
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
          {node.buffers?.shared && (
            <div className="text-xs mt-1 text-slate-600 dark:text-slate-400">
              Buffers:
              {node.buffers.shared.hit !== undefined &&
                ` hit=${node.buffers.shared.hit}`}
              {node.buffers.shared.read !== undefined &&
                ` read=${node.buffers.shared.read}`}
            </div>
          )}
          {node.sortMethod && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Sort Method: {node.sortMethod}
              {node.sortSpaceUsed && ` (${node.sortSpaceUsed}kB)`}
            </div>
          )}
          {node.workersPlanned !== undefined && (
            <div className="text-xs mt-1 text-teal-600 dark:text-teal-400">
              Workers: {node.workersLaunched ?? 0}/{node.workersPlanned} planned
            </div>
          )}

          {/* Hash stats */}
          {(node.hashBuckets !== undefined ||
            node.hashBatches !== undefined) && (
            <div className="text-xs mt-1 text-purple-600 dark:text-purple-400">
              Hash:
              {node.hashBuckets !== undefined && ` Buckets=${node.hashBuckets}`}
              {node.hashBatches !== undefined && ` Batches=${node.hashBatches}`}
              {node.originalHashBatches !== undefined &&
                node.originalHashBatches !== node.hashBatches &&
                ` (orig=${node.originalHashBatches})`}
              {node.peakMemoryUsage !== undefined &&
                ` Peak=${node.peakMemoryUsage}kB`}
              {node.diskUsage !== undefined && (
                <span className="text-red-500"> Disk={node.diskUsage}kB</span>
              )}
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

          {/* Incremental Sort groups */}
          {node.fullSortGroups && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Full-sort: {node.fullSortGroups.count} groups (
              {node.fullSortGroups.memoryType}, {node.fullSortGroups.memoryUsed}
              kB avg)
            </div>
          )}
          {node.preSortedGroups && (
            <div className="text-xs mt-1 text-blue-600 dark:text-blue-400">
              Pre-sorted: {node.preSortedGroups.count} groups (
              {node.preSortedGroups.memoryType},{" "}
              {node.preSortedGroups.memoryUsed}kB avg)
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
        <div className="w-16 flex-shrink-0 mt-1">
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
  const getSavedExplainPlans = useTabStateStore((state) => state.getSavedExplainPlans);

  const savedPlans = tabId ? getSavedExplainPlans(tabId) : [];

  const parsed = useMemo(
    () => parsePostgresExplain(result.rows),
    [result.rows],
  );

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

  const plan1 = savedPlans.find(p => p.id === selectedPlan1);
  const plan2 = savedPlans.find(p => p.id === selectedPlan2);

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
        parseExplain={parsePostgresExplain}
      />
    );
  }

  // Fallback to raw text if parsing failed
  if (parsed.nodes.length === 0) {
    const rawText = result.rows
      .map((row) => {
        const cell = row[0];
        return typeof cell === "string" ? cell : "";
      })
      .join("\n");
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
                onClick={() => { setShowSaveDialog(true); }}
                className="h-7 text-xs"
              >
                <IconBookmark className="h-3.5 w-3.5 mr-1.5" />
                Save for comparison
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={saveLabel}
                  onChange={(e) => { setSaveLabel(e.target.value); }}
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
                  <Select value={selectedPlan1 || null} onValueChange={(val) => { setSelectedPlan1(val || ""); }}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedPlans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id} className="text-xs">
                          {plan.label || new Date(plan.timestamp).toLocaleTimeString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <Select value={selectedPlan2 || null} onValueChange={(val) => { setSelectedPlan2(val || ""); }}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedPlans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id} className="text-xs">
                          {plan.label || new Date(plan.timestamp).toLocaleTimeString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleComparePlans}
                    disabled={!selectedPlan1 || !selectedPlan2 || selectedPlan1 === selectedPlan2}
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
                  {savedPlans.length} saved plan{savedPlans.length !== 1 ? 's' : ''}
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
          parsed.jit) && (
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
                  navigator.clipboard
                    .writeText(parsed.raw)
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
