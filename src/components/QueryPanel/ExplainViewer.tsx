import { memo, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/CodeEditor";
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
} from "@tabler/icons-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

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
  // Parallel
  workersPlanned?: number;
  workersLaunched?: number;
  parallelAware?: boolean;
  // Stats
  rowsRemoved?: { type: string; count: number };
  heapFetches?: number;
  exactHeapBlocks?: number;
  lossyHeapBlocks?: number;
  // Sort details
  sortMethod?: string;
  sortSpaceUsed?: number;
  sortSpaceType?: string;
  // Buffers
  buffers?: {
    shared?: { hit?: number; read?: number; dirtied?: number; written?: number };
    local?: { hit?: number; read?: number; dirtied?: number; written?: number };
    temp?: { read?: number; written?: number };
  };
  ioTiming?: { read?: number; write?: number };
  // CTE/SubPlan
  cteName?: string;
  subplanName?: string;
  // Children
  children?: ExplainNode[];
  raw?: string;
}

interface ParsedExplain {
  nodes: ExplainNode[];
  planningTime?: number;
  executionTime?: number;
  totalCost: number;
  raw: string;
  triggers?: { name: string; time: number; calls: number }[];
  settings?: string[];
  queryIdentifier?: string;
}

interface ExplainViewerProps {
  result: {
    columns: string[];
    rows: unknown[][];
  };
  className?: string;
  showRawOutput?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Complete list of PostgreSQL plan node types
const NODE_TYPES = [
  // Scan nodes
  "Seq Scan", "Parallel Seq Scan", "Index Scan", "Index Only Scan",
  "Bitmap Index Scan", "Bitmap Heap Scan", "Tid Scan", "Tid Range Scan",
  "Subquery Scan", "Function Scan", "Table Function Scan", "Values Scan",
  "CTE Scan", "Named Tuplestore Scan", "WorkTable Scan", "Foreign Scan",
  "Custom Scan", "Sample Scan",
  // Join nodes
  "Nested Loop", "Hash Join", "Merge Join",
  // Materialize
  "Hash", "Materialize", "Memoize",
  // Aggregate
  "Aggregate", "HashAggregate", "GroupAggregate", "Mixed Aggregate",
  // Sort
  "Sort", "Incremental Sort",
  // Set operations
  "Append", "Merge Append", "Recursive Union", "BitmapAnd", "BitmapOr",
  "SetOp", "Unique",
  // Control
  "Limit", "LockRows", "ModifyTable", "Result", "ProjectSet", "Group",
  // Parallel
  "Gather", "Gather Merge",
  // Window
  "WindowAgg",
];

// Attribute line prefixes (these are NOT nodes)
const ATTRIBUTE_PREFIXES = [
  "Hash Cond:", "Join Filter:", "Filter:", "Merge Cond:", "Index Cond:",
  "Recheck Cond:", "TID Cond:", "One-Time Filter:", "Sort Key:", "Group Key:",
  "Presorted Key:", "Output:", "Buffers:", "I/O Timings:", "Workers Planned:",
  "Workers Launched:", "Rows Removed by", "Heap Fetches:", "Sort Method:",
  "Sort Space Used:", "Sort Space Type:", "SubPlan", "InitPlan", "CTE",
  "Trigger", "Planning:", "Settings:", "Query Identifier:", "Parallel Aware:",
  "Async Capable:", "Single Copy:", "Inner Unique:", "Relation Name:",
  "Alias:", "Schema:", "Function Name:", "Function Call:", "Remote SQL:",
  "Exact Heap Blocks:", "Lossy Heap Blocks:", "Scan Direction:",
];

// ============================================================================
// PARSING - TEXT FORMAT
// ============================================================================

let nodeIdCounter = 0;

function isAttributeLine(content: string): boolean {
  const trimmed = content.trim();
  return ATTRIBUTE_PREFIXES.some(prefix =>
    trimmed.startsWith(prefix) || trimmed.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

function isNodeLine(content: string): boolean {
  // Has cost estimation - definitely a node
  if (content.includes("cost=")) return true;
  // Has actual timing - definitely a node
  if (content.includes("actual time=")) return true;
  // Check against known node types
  const trimmed = content.trim();
  return NODE_TYPES.some(nodeType =>
    trimmed.startsWith(nodeType) ||
    trimmed.toLowerCase().startsWith(nodeType.toLowerCase())
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
  const rowsRemovedMatch = trimmed.match(/Rows Removed by (\w+(?:\s+\w+)?):\s*(\d+)/i);
  if (rowsRemovedMatch) {
    node.rowsRemoved = {
      type: rowsRemovedMatch[1] || "Filter",
      count: parseInt(rowsRemovedMatch[2] || "0", 10)
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
      dirtied: sharedDirtied ? parseInt(sharedDirtied[1] || "0", 10) : undefined,
      written: sharedWritten ? parseInt(sharedWritten[1] || "0", 10) : undefined,
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
    const typeMatch = content.match(/^([A-Za-z][A-Za-z\s]+?)(?:\s+on|\s+using|\s*\(|$)/i);
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
    const triggerMatch = line.match(/Trigger\s+(\w+):\s*time=([\d.]+)\s*calls=(\d+)/i);
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
  }

  const nodes: ExplainNode[] = [];
  const stack: { node: ExplainNode; indent: number }[] = [];

  for (const line of lines) {
    // Skip metadata lines
    if (line.startsWith("Planning Time:") ||
        line.startsWith("Execution Time:") ||
        line.startsWith("Settings:") ||
        line.match(/^Query Identifier:/)) {
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

  // Calculate total cost
  let totalCost = 0;
  function sumCost(node: ExplainNode) {
    if (node.cost?.total) {
      totalCost = Math.max(totalCost, node.cost.total);
    }
    node.children?.forEach(sumCost);
  }
  nodes.forEach(sumCost);

  return {
    nodes,
    planningTime,
    executionTime,
    totalCost,
    raw,
    triggers: triggers.length > 0 ? triggers : undefined,
    settings: settings.length > 0 ? settings : undefined,
    queryIdentifier,
  };
}

// ============================================================================
// PARSING - JSON FORMAT
// ============================================================================

interface JsonPlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Alias"?: string;
  "Schema"?: string;
  "Index Name"?: string;
  "Scan Direction"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Join Filter"?: string;
  "Filter"?: string;
  "Merge Cond"?: string;
  "Index Cond"?: string;
  "Recheck Cond"?: string;
  "TID Cond"?: string;
  "One-Time Filter"?: string;
  "Sort Key"?: string[];
  "Group Key"?: string[];
  "Presorted Key"?: string[];
  "Output"?: string[];
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
  Plans?: JsonPlanNode[];
}

interface JsonExplainResult {
  Plan?: JsonPlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: { "Trigger Name": string; Time: number; Calls: number }[];
  Settings?: Record<string, string>;
  "Query Identifier"?: string | number;
}

function parseJsonExplain(jsonData: JsonExplainResult[] | JsonExplainResult, raw: string): ParsedExplain {
  const data = Array.isArray(jsonData) ? jsonData[0] : jsonData;

  if (!data?.Plan) {
    return { nodes: [], totalCost: 0, raw };
  }

  const planningTime = data["Planning Time"];
  const executionTime = data["Execution Time"];
  const triggers = data.Triggers?.map(t => ({
    name: t["Trigger Name"],
    time: t.Time,
    calls: t.Calls,
  }));
  const settings = data.Settings
    ? Object.entries(data.Settings).map(([k, v]) => `${k}=${v}`)
    : undefined;
  const queryIdentifier = data["Query Identifier"]?.toString();

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
      node.rowsRemoved = { type: "Filter", count: jsonNode["Rows Removed by Filter"] };
    } else if (jsonNode["Rows Removed by Join Filter"] !== undefined) {
      node.rowsRemoved = { type: "Join Filter", count: jsonNode["Rows Removed by Join Filter"] };
    } else if (jsonNode["Rows Removed by Index Recheck"] !== undefined) {
      node.rowsRemoved = { type: "Index Recheck", count: jsonNode["Rows Removed by Index Recheck"] };
    }

    // Buffers
    if (jsonNode["Shared Hit Blocks"] !== undefined || jsonNode["Shared Read Blocks"] !== undefined) {
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
    if (jsonNode["I/O Read Time"] !== undefined || jsonNode["I/O Write Time"] !== undefined) {
      node.ioTiming = {
        read: jsonNode["I/O Read Time"],
        write: jsonNode["I/O Write Time"],
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

  // Calculate total cost
  let totalCost = 0;
  function sumCost(node: ExplainNode) {
    if (node.cost?.total) {
      totalCost = Math.max(totalCost, node.cost.total);
    }
    node.children?.forEach(sumCost);
  }
  nodes.forEach(sumCost);

  return {
    nodes,
    planningTime,
    executionTime,
    totalCost,
    raw,
    triggers,
    settings,
    queryIdentifier,
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
  if (t.includes("join") || t.includes("nested") || t.includes("merge")) return "#06b6d4"; // cyan
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
  if (t.includes("join") || t.includes("nested") || t.includes("merge")) return IconLayersIntersect;
  return IconTable;
}

// ============================================================================
// TREE VIEW COMPONENTS
// ============================================================================

interface TreeNodeProps {
  node: ExplainNode;
  totalCost: number;
  depth?: number;
  defaultExpanded?: boolean;
}

const TreeNode = memo(function TreeNode({
  node,
  totalCost,
  depth = 0,
  defaultExpanded = true,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children && node.children.length > 0;
  const Icon = getNodeIcon(node.type);
  const costPct = totalCost > 0 ? ((node.cost?.total || 0) / totalCost) * 100 : 0;
  const color = getNodeColor(node.type);

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-start gap-1.5 py-1 px-2 rounded-md hover:bg-muted/50 cursor-pointer group",
          depth > 0 && "ml-4"
        )}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand/Collapse */}
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
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

        {/* Icon */}
        <div
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-3 w-3" style={{ color }} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{node.type}</span>
            {node.relation && (
              <span className="text-xs text-muted-foreground">
                on <span className="font-mono text-foreground">{node.relation}</span>
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
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            {node.cost && (
              <span>
                Cost:{" "}
                <span className="font-mono">
                  {node.cost.startup.toFixed(1)}..{node.cost.total.toFixed(1)}
                </span>
                <span
                  className="ml-1 font-medium"
                  style={{ color: costPct > 50 ? "#ef4444" : costPct > 20 ? "#f97316" : "#22c55e" }}
                >
                  ({costPct.toFixed(1)}%)
                </span>
              </span>
            )}
            {node.rows !== undefined && (
              <span>
                Rows: <span className="font-mono">{node.rows.toLocaleString()}</span>
              </span>
            )}
            {node.actualTime && (
              <span className="text-blue-600 dark:text-blue-400">
                Actual: <span className="font-mono">{node.actualTime.total.toFixed(3)}ms</span>
              </span>
            )}
            {node.actualRows !== undefined && (
              <span className="text-green-600 dark:text-green-400">
                Actual Rows: <span className="font-mono">{node.actualRows.toLocaleString()}</span>
              </span>
            )}
            {node.loops && node.loops > 1 && (
              <span className="text-amber-600 dark:text-amber-400">
                Loops: <span className="font-mono">{node.loops}</span>
              </span>
            )}
            {node.indexName && (
              <span className="text-green-600 dark:text-green-400">
                Index: <span className="font-mono">{node.indexName}</span>
              </span>
            )}
          </div>

          {/* Conditions */}
          {node.hashCond && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">Hash Cond: </span>
              <code className="font-mono text-muted-foreground">{node.hashCond}</code>
            </div>
          )}
          {node.joinFilter && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">Join Filter: </span>
              <code className="font-mono text-muted-foreground">{node.joinFilter}</code>
            </div>
          )}
          {node.filter && (
            <div className="text-xs mt-1">
              <span className="text-purple-600 dark:text-purple-400">Filter: </span>
              <code className="font-mono text-muted-foreground">{node.filter}</code>
            </div>
          )}
          {node.mergeCond && (
            <div className="text-xs mt-1">
              <span className="text-cyan-600 dark:text-cyan-400">Merge Cond: </span>
              <code className="font-mono text-muted-foreground">{node.mergeCond}</code>
            </div>
          )}
          {node.indexCond && (
            <div className="text-xs mt-1">
              <span className="text-green-600 dark:text-green-400">Index Cond: </span>
              <code className="font-mono text-muted-foreground">{node.indexCond}</code>
            </div>
          )}
          {node.recheckCond && (
            <div className="text-xs mt-1">
              <span className="text-amber-600 dark:text-amber-400">Recheck Cond: </span>
              <code className="font-mono text-muted-foreground">{node.recheckCond}</code>
            </div>
          )}

          {/* Sort/Group keys */}
          {node.sortKey && node.sortKey.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-blue-600 dark:text-blue-400">Sort Key: </span>
              <code className="font-mono text-muted-foreground">{node.sortKey.join(", ")}</code>
            </div>
          )}
          {node.groupKey && node.groupKey.length > 0 && (
            <div className="text-xs mt-1">
              <span className="text-pink-600 dark:text-pink-400">Group Key: </span>
              <code className="font-mono text-muted-foreground">{node.groupKey.join(", ")}</code>
            </div>
          )}

          {/* Extra stats */}
          {node.rowsRemoved && (
            <div className="text-xs mt-1 text-red-600 dark:text-red-400">
              Rows Removed by {node.rowsRemoved.type}: {node.rowsRemoved.count.toLocaleString()}
            </div>
          )}
          {node.buffers?.shared && (
            <div className="text-xs mt-1 text-slate-600 dark:text-slate-400">
              Buffers:
              {node.buffers.shared.hit !== undefined && ` hit=${node.buffers.shared.hit}`}
              {node.buffers.shared.read !== undefined && ` read=${node.buffers.shared.read}`}
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
}: {
  nodes: ExplainNode[];
  totalCost: number;
}) {
  return (
    <div className="p-2">
      {nodes.map((node, idx) => (
        <TreeNode key={node.id || idx} node={node} totalCost={totalCost} />
      ))}
    </div>
  );
});


// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ExplainViewer = memo(function ExplainViewer({
  result,
  className,
  showRawOutput = true,
}: ExplainViewerProps) {
  const parsed = useMemo(() => parsePostgresExplain(result.rows), [result.rows]);

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
        <CodeEditor value={rawText} language="sql" readOnly height="100%" lineNumbers />
      </div>
    );
  }

  return (
    <div className={cn("h-full flex flex-col overflow-hidden", className)}>
      {/* Header with timing info */}
      {(parsed.planningTime !== undefined || parsed.executionTime !== undefined || (parsed.triggers && parsed.triggers.length > 0)) && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-muted/20 text-xs flex-wrap">
          {(parsed.planningTime !== undefined || parsed.executionTime !== undefined) && (
            <>
              <IconClock className="h-3.5 w-3.5 text-muted-foreground" />
              {parsed.planningTime !== undefined && (
                <span>
                  Planning: <span className="font-mono font-medium">{parsed.planningTime.toFixed(2)}ms</span>
                </span>
              )}
              {parsed.executionTime !== undefined && (
                <span>
                  Execution: <span className="font-mono font-medium">{parsed.executionTime.toFixed(2)}ms</span>
                </span>
              )}
            </>
          )}
          {parsed.triggers && parsed.triggers.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              Triggers: {parsed.triggers.map(t => `${t.name} (${t.time.toFixed(2)}ms)`).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Main Content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Tree View */}
        <ResizablePanel defaultSize={showRawOutput ? 60 : 100} minSize={30}>
          <div className="h-full overflow-auto">
            <TreeView nodes={parsed.nodes} totalCost={parsed.totalCost} />
          </div>
        </ResizablePanel>

        {/* Raw Output Panel */}
        {showRawOutput && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={40} minSize={20}>
              <div className="h-full flex flex-col border-l bg-muted/10">
                <div className="flex items-center px-3 py-1.5 border-b bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">Raw Output</span>
                </div>
                <div className="flex-1 overflow-auto p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                    {parsed.raw}
                  </pre>
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
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
