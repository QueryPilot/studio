export interface ExplainNode {
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
  fullSortGroups?: {
    count: number;
    memoryUsed: number;
    memoryType: string;
    peakMemory?: number;
  };
  preSortedGroups?: {
    count: number;
    memoryUsed: number;
    memoryType: string;
    peakMemory?: number;
  };
  // Hash details
  hashBuckets?: number;
  hashBatches?: number;
  originalHashBatches?: number;
  peakMemoryUsage?: number;
  memoryUsage?: number; // Memory Usage for HashAggregate/Hash (distinct from peak)
  diskUsage?: number;
  // Memoize cache stats
  cacheKey?: string;
  cacheMode?: string;
  cacheHits?: number;
  cacheMisses?: number;
  cacheEvictions?: number;
  cacheOverflows?: number;
  cacheMemoryUsage?: number;
  // Function Scan
  functionName?: string;
  functionCall?: string;
  // Foreign Scan
  remoteSql?: string;
  // Parallel
  singleCopy?: boolean;
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

export interface JitInfo {
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

export interface ParsedExplain {
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
  // Planning phase buffers (separate from execution buffers)
  planningBuffers?: {
    shared?: {
      hit?: number;
      read?: number;
      dirtied?: number;
      written?: number;
    };
  };
}
