import type { ExplainNode, ParsedExplain } from "../types";

interface ParseMySqlInput {
  columns: string[];
  rows: unknown[][];
}

interface MySqlRowRecord {
  id?: string;
  selectType?: string;
  table?: string;
  accessType?: string;
  possibleKeys?: string[];
  key?: string;
  keyLen?: string;
  ref?: string;
  estimatedRows?: number;
  filtered?: number;
  extra?: string;
  raw: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value === "symbol") {
    return value.description ? `Symbol(${value.description})` : "Symbol()";
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatCell(item)).join(", ");
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Object]";
    }
  }
  return "[Unsupported]";
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toOptionalText(value: unknown): string | undefined {
  const text = formatCell(value).trim();
  if (text.length === 0 || text.toUpperCase() === "NULL") {
    return undefined;
  }
  return text;
}

export function parseMySqlTraditionalExplain(
  input: ParseMySqlInput,
): ParsedExplain {
  const normalizedColumns = input.columns.map((column) =>
    column.toLowerCase().trim(),
  );

  const tableIndex = normalizedColumns.indexOf("table");
  const typeIndex = normalizedColumns.indexOf("type");
  const rowsIndex = normalizedColumns.indexOf("rows");
  const extraIndex = normalizedColumns.indexOf("extra");
  const selectTypeIndex = normalizedColumns.indexOf("select_type");
  const idIndex = normalizedColumns.indexOf("id");
  const filteredIndex = normalizedColumns.indexOf("filtered");
  const possibleKeysIndex = normalizedColumns.indexOf("possible_keys");
  const keyIndex = normalizedColumns.indexOf("key");
  const keyLenIndex = normalizedColumns.indexOf("key_len");
  const refIndex = normalizedColumns.indexOf("ref");

  const raw = input.rows
    .map((row) =>
      input.columns
        .map((column, index) => `${column}=${formatCell(row[index])}`)
        .join(" | "),
    )
    .join("\n");

  if (tableIndex < 0 || typeIndex < 0) {
    return { nodes: [], totalCost: 0, raw };
  }

  const records: MySqlRowRecord[] = input.rows.map((row) => {
    const possibleKeysRaw =
      possibleKeysIndex >= 0 ? toOptionalText(row[possibleKeysIndex]) : undefined;
    const possibleKeys = possibleKeysRaw
      ? possibleKeysRaw
          .split(",")
          .map((key) => key.trim())
          .filter((key) => key.length > 0)
      : undefined;

    return {
      id: idIndex >= 0 ? toOptionalText(row[idIndex]) : undefined,
      selectType:
        selectTypeIndex >= 0 ? toOptionalText(row[selectTypeIndex]) : undefined,
      table: toOptionalText(row[tableIndex]),
      accessType: toOptionalText(row[typeIndex]),
      possibleKeys: possibleKeys && possibleKeys.length > 0 ? possibleKeys : undefined,
      key: keyIndex >= 0 ? toOptionalText(row[keyIndex]) : undefined,
      keyLen: keyLenIndex >= 0 ? toOptionalText(row[keyLenIndex]) : undefined,
      ref: refIndex >= 0 ? toOptionalText(row[refIndex]) : undefined,
      estimatedRows: rowsIndex >= 0 ? parseNumber(row[rowsIndex]) : undefined,
      filtered: filteredIndex >= 0 ? parseNumber(row[filteredIndex]) : undefined,
      extra: extraIndex >= 0 ? toOptionalText(row[extraIndex]) : undefined,
      raw: input.columns
        .map((column, index) => `${column}=${formatCell(row[index])}`)
        .join(" | "),
    };
  });

  // Build nodes with selectId tracking
  const selectIdByNode = new Map<ExplainNode, number>();
  const allNodes: ExplainNode[] = records.map((record, index) => {
    const node: ExplainNode = {
      id: `mysql-node-${index}`,
      type: record.accessType || "UNKNOWN",
      relation: record.table,
      rows: record.estimatedRows,
      indexName: record.key,
      raw: record.raw,
    };

    const selectId = record.id ? parseInt(record.id, 10) : 1;
    selectIdByNode.set(node, Number.isFinite(selectId) ? selectId : 1);

    if (record.selectType) {
      node.selectType = record.selectType;
    }
    if (record.id) {
      node.queryBlockId = record.id;
    }
    if (record.filtered !== undefined) {
      node.filtered = record.filtered;
    }
    if (record.possibleKeys && record.possibleKeys.length > 0) {
      node.possibleKeys = record.possibleKeys;
    }
    if (record.keyLen) {
      node.keyLen = record.keyLen;
    }
    if (record.ref) {
      node.ref = record.ref;
    }
    if (record.extra) {
      node.extra = record.extra;
    }

    return node;
  });

  // Group nodes by selectId and build tree
  const nodesBySelectId = new Map<number, ExplainNode[]>();
  for (const node of allNodes) {
    const selectId = selectIdByNode.get(node) ?? 1;
    const group = nodesBySelectId.get(selectId) || [];
    group.push(node);
    nodesBySelectId.set(selectId, group);
  }

  const sortedIds = Array.from(nodesBySelectId.keys()).sort((a, b) => a - b);

  // Build tree: higher IDs are children of the last node with the previous ID
  const roots: ExplainNode[] = [];
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i];
    if (id === undefined) continue;
    const nodes = nodesBySelectId.get(id) || [];
    if (i === 0) {
      roots.push(...nodes);
    } else {
      const prevId = sortedIds[i - 1];
      if (prevId === undefined) {
        roots.push(...nodes);
        continue;
      }
      const prevNodes = nodesBySelectId.get(prevId) || [];
      const parent = prevNodes[prevNodes.length - 1];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(...nodes);
      } else {
        roots.push(...nodes);
      }
    }
  }

  return {
    nodes: roots,
    totalCost: 0,
    raw,
  };
}

function parseMySqlJsonNode(
  value: unknown,
  nodeIndexRef: { current: number },
): ExplainNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const tableName =
    typeof record.table_name === "string" ? record.table_name : undefined;
  const accessType =
    typeof record.access_type === "string" ? record.access_type : undefined;
  const estimatedRows =
    parseNumber(record.rows_examined_per_scan) ??
    parseNumber(record.rows_produced_per_join) ??
    parseNumber(record.rows);

  const childNodes: ExplainNode[] = [];

  if (record.table && typeof record.table === "object") {
    const tableNode = parseMySqlJsonNode(record.table, nodeIndexRef);
    if (tableNode) {
      childNodes.push(tableNode);
    }
  }

  if (Array.isArray(record.nested_loop)) {
    for (const child of record.nested_loop) {
      const parsedChild = parseMySqlJsonNode(child, nodeIndexRef);
      if (parsedChild) {
        // Unwrap trivial Operation wrappers from nested_loop items
        // (e.g., {table: {table_name: "p", ...}} creates Operation → table node)
        if (
          parsedChild.type === "Operation" &&
          parsedChild.children?.length === 1 &&
          !parsedChild.relation
        ) {
          childNodes.push(parsedChild.children[0]!);
        } else {
          childNodes.push(parsedChild);
        }
      }
    }
  }

  if (record.query_block && typeof record.query_block === "object") {
    const nestedBlock = parseMySqlJsonNode(record.query_block, nodeIndexRef);
    if (nestedBlock) {
      childNodes.push(nestedBlock);
    }
  }

  // Handle filesort (MariaDB JSON format wraps sorted results in filesort object)
  if (record.filesort && typeof record.filesort === "object") {
    const filesortObj = record.filesort as Record<string, unknown>;
    const sortNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: "Filesort",
      sortKey: typeof filesortObj.sort_key === "string" ? filesortObj.sort_key.split(", ") : undefined,
      raw: JSON.stringify(record.filesort),
    };
    // Filesort may contain temporary_table or nested_loop directly
    const sortChildren: ExplainNode[] = [];
    if (filesortObj.temporary_table && typeof filesortObj.temporary_table === "object") {
      const tmpObj = filesortObj.temporary_table as Record<string, unknown>;
      const tmpNode: ExplainNode = {
        id: `mysql-json-${nodeIndexRef.current++}`,
        type: "Temporary Table",
        raw: JSON.stringify(filesortObj.temporary_table),
      };
      // Temporary table usually contains nested_loop
      const tmpChild = parseMySqlJsonNode(tmpObj, nodeIndexRef);
      if (tmpChild && tmpChild.type !== "Operation") {
        tmpNode.children = [tmpChild];
      } else if (tmpChild?.children) {
        tmpNode.children = tmpChild.children;
      }
      sortChildren.push(tmpNode);
    } else {
      // No temporary_table — recurse directly for nested_loop, table, etc.
      const sortChild = parseMySqlJsonNode(filesortObj, nodeIndexRef);
      if (sortChild && sortChild.type !== "Operation") {
        sortChildren.push(sortChild);
      } else if (sortChild?.children) {
        sortChildren.push(...sortChild.children);
      }
    }
    if (sortChildren.length > 0) {
      sortNode.children = sortChildren;
    }
    childNodes.push(sortNode);
  }

  // Handle standalone temporary_table (MariaDB JSON format, without filesort wrapper)
  if (!record.filesort && record.temporary_table && typeof record.temporary_table === "object") {
    const tmpObj = record.temporary_table as Record<string, unknown>;
    const tmpNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: "Temporary Table",
      raw: JSON.stringify(record.temporary_table),
    };
    const tmpChild = parseMySqlJsonNode(tmpObj, nodeIndexRef);
    if (tmpChild && tmpChild.type !== "Operation") {
      tmpNode.children = [tmpChild];
    } else if (tmpChild?.children) {
      tmpNode.children = tmpChild.children;
    }
    childNodes.push(tmpNode);
  }

  // Helper: unwrap trivial Operation wrappers from recursive children
  function unwrapOperation(node: ExplainNode | null): ExplainNode[] {
    if (!node) return [];
    if (node.type === "Operation" && !node.relation && node.children?.length) {
      return node.children;
    }
    return [node];
  }

  // Handle ordering_operation (MySQL: wraps sorted results)
  if (record.ordering_operation && typeof record.ordering_operation === "object") {
    const orderObj = record.ordering_operation as Record<string, unknown>;
    const sortNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: orderObj.using_filesort ? "Filesort" : "Sort",
      raw: JSON.stringify(record.ordering_operation),
    };
    const orderChild = parseMySqlJsonNode(orderObj, nodeIndexRef);
    sortNode.children = unwrapOperation(orderChild);
    childNodes.push(sortNode);
  }

  // Handle grouping_operation (MySQL: wraps grouped results)
  if (record.grouping_operation && typeof record.grouping_operation === "object") {
    const groupObj = record.grouping_operation as Record<string, unknown>;
    const groupNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: groupObj.using_temporary_table ? "Group (Temp Table)" : "Group",
      raw: JSON.stringify(record.grouping_operation),
    };
    const groupChild = parseMySqlJsonNode(groupObj, nodeIndexRef);
    groupNode.children = unwrapOperation(groupChild);
    childNodes.push(groupNode);
  }

  // Handle buffer_result (MySQL: materializes intermediate results)
  if (record.buffer_result && typeof record.buffer_result === "object") {
    const bufObj = record.buffer_result as Record<string, unknown>;
    const bufNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: bufObj.using_temporary_table ? "Buffer (Temp Table)" : "Buffer",
      raw: JSON.stringify(record.buffer_result),
    };
    const bufChild = parseMySqlJsonNode(bufObj, nodeIndexRef);
    bufNode.children = unwrapOperation(bufChild);
    childNodes.push(bufNode);
  }

  // Handle duplicates_removal (MySQL: DISTINCT operation)
  if (record.duplicates_removal && typeof record.duplicates_removal === "object") {
    const dupObj = record.duplicates_removal as Record<string, unknown>;
    const distinctNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: "Distinct",
      raw: JSON.stringify(record.duplicates_removal),
    };
    const dupChild = parseMySqlJsonNode(dupObj, nodeIndexRef);
    distinctNode.children = unwrapOperation(dupChild);
    childNodes.push(distinctNode);
  }

  // Handle union_result
  if (record.union_result && typeof record.union_result === "object") {
    const unionObj = record.union_result as Record<string, unknown>;
    const unionNode: ExplainNode = {
      id: `mysql-json-${nodeIndexRef.current++}`,
      type: "Union",
      relation:
        typeof unionObj.table_name === "string" ? unionObj.table_name : undefined,
      raw: JSON.stringify(record.union_result),
    };
    if (Array.isArray(unionObj.query_specifications)) {
      const unionChildren: ExplainNode[] = [];
      for (const spec of unionObj.query_specifications) {
        const specNode = parseMySqlJsonNode(spec, nodeIndexRef);
        if (specNode) {
          unionChildren.push(specNode);
        }
      }
      if (unionChildren.length > 0) {
        unionNode.children = unionChildren;
      }
    }
    childNodes.push(unionNode);
  }

  // Handle subqueries array
  if (Array.isArray(record.subqueries)) {
    for (const subquery of record.subqueries) {
      const subNode = parseMySqlJsonNode(subquery, nodeIndexRef);
      if (subNode) {
        childNodes.push(subNode);
      }
    }
  }

  const type =
    accessType ??
    (record.nested_loop ? "Nested Loop" : undefined) ??
    (typeof record.select_id === "number"
      ? `Query Block ${record.select_id}`
      : undefined) ??
    "Operation";

  const raw = JSON.stringify(value);
  const node: ExplainNode = {
    id: `mysql-json-${nodeIndexRef.current++}`,
    type,
    relation: tableName,
    rows: estimatedRows,
    raw,
  };

  // Extract cost — MySQL uses cost_info.prefix_cost/query_cost,
  // MariaDB uses a direct "cost" number on the table/query_block object
  const costInfoObj = record.cost_info as Record<string, unknown> | undefined;
  const directCost = parseNumber(record.cost);
  if (directCost !== undefined && directCost > 0) {
    // MariaDB: direct cost field on table objects
    node.cost = { startup: 0, total: directCost };
  } else if (costInfoObj) {
    const rawCost = costInfoObj.query_cost ?? costInfoObj.prefix_cost;
    const costStr =
      typeof rawCost === "string"
        ? rawCost
        : typeof rawCost === "number"
          ? rawCost.toString()
          : "0";
    const queryCost = parseFloat(costStr);
    if (!isNaN(queryCost) && queryCost > 0) {
      node.cost = { startup: 0, total: queryCost };
    }
  } else if (typeof record.query_cost === "string" || typeof record.query_cost === "number") {
    const queryCost = parseFloat(String(record.query_cost));
    if (!isNaN(queryCost) && queryCost > 0) {
      node.cost = { startup: 0, total: queryCost };
    }
  }

  // MariaDB/MySQL: extract table-level details
  const loops = parseNumber(record.loops);
  if (loops !== undefined && loops > 1) {
    node.loops = loops;
  }
  const filtered = parseNumber(record.filtered);
  if (filtered !== undefined) {
    node.filtered = filtered;
  }
  if (typeof record.attached_condition === "string") {
    node.filter = record.attached_condition;
  }
  if (typeof record.index_condition === "string") {
    node.indexCond = record.index_condition;
  }
  if (typeof record.key === "string") {
    node.indexName = record.key;
  }
  if (typeof record.ref === "string" || Array.isArray(record.ref)) {
    node.ref = Array.isArray(record.ref) ? record.ref.join(", ") : record.ref;
  }
  if (typeof record.key_length === "string") {
    node.keyLen = record.key_length;
  }
  if (Array.isArray(record.possible_keys)) {
    node.possibleKeys = record.possible_keys.filter(
      (k): k is string => typeof k === "string",
    );
  }
  if (!node.indexCond && Array.isArray(record.used_key_parts)) {
    node.indexCond = record.used_key_parts.filter(
      (k): k is string => typeof k === "string",
    ).join(", ");
  }

  if (childNodes.length > 0) {
    node.children = childNodes;
  }

  return node;
}

function parseMySqlJsonExplain(input: ParseMySqlInput): ParsedExplain {
  const raw = input.rows
    .map((row) => row.map((value) => formatCell(value)).join(" | "))
    .join("\n");

  const firstCell = input.rows[0]?.[0];
  if (typeof firstCell !== "string") {
    return { nodes: [], totalCost: 0, raw };
  }

  let jsonData: unknown;
  try {
    jsonData = JSON.parse(firstCell);
  } catch {
    return { nodes: [], totalCost: 0, raw };
  }

  const root = Array.isArray(jsonData) ? jsonData[0] : jsonData;
  if (!root || typeof root !== "object") {
    return { nodes: [], totalCost: 0, raw };
  }

  const nodeIndexRef = { current: 0 };
  const rootNode = parseMySqlJsonNode(root, nodeIndexRef);
  if (!rootNode) {
    return { nodes: [], totalCost: 0, raw };
  }

  // Unwrap trivial wrapper nodes (Operation, Query Block) that have a single
  // child and no relation. Stop unwrapping if the child is a meaningful
  // operation node (Filesort, Sort, Temporary Table, etc.) — in that case
  // the Query Block label provides useful context.
  let normalizedRoot = rootNode;
  while (
    normalizedRoot.type === "Operation" &&
    !normalizedRoot.relation &&
    normalizedRoot.children &&
    normalizedRoot.children.length === 1
  ) {
    normalizedRoot = normalizedRoot.children[0] || normalizedRoot;
  }

  return {
    nodes: [normalizedRoot],
    totalCost: 0,
    raw,
  };
}

function parseMySqlTreeLine(
  line: string,
  nodeIndexRef: { current: number },
): { indent: number; node: ExplainNode } | null {
  const match = line.match(/^(\s*)(?:->)?\s*(.+)$/);
  if (!match) {
    return null;
  }

  const indent = (match[1] || "").length;
  const content = (match[2] || "").trim();
  if (!content) {
    return null;
  }

  const descriptor = content
    .replace(/\s*\(cost=.*$/i, "")
    .replace(/\s*\(actual time=.*$/i, "")
    .trim();

  const relationMatch = descriptor.match(/\bon\s+([`"A-Za-z0-9_.]+)/i);
  const relation = relationMatch?.[1]?.replace(/[`"]/g, "");

  const type = relationMatch
    ? descriptor.slice(0, relationMatch.index).trim()
    : descriptor;

  let indexName: string | undefined;
  let indexCond: string | undefined;
  if (/index/i.test(descriptor)) {
    const indexMatch = descriptor.match(
      /\busing\s+(?:index\s+)?([`"][^`"]+[`"]|[A-Za-z0-9_.]+)(?:\s+\(([^)]*)\))?/i,
    );
    const rawIndexName = indexMatch?.[1];
    if (rawIndexName) {
      indexName = rawIndexName.replace(/[`"]/g, "").trim() || undefined;
    }
    const rawIndexCond = indexMatch?.[2]?.trim();
    if (rawIndexCond) {
      indexCond = rawIndexCond;
    }
  }

  // Extract estimated rows from (cost=... rows=...) section
  const estimatedRowsMatch = content.match(/\(cost=[\d.eE+-]*\s+rows=(\d+)\)/i);
  // Fallback: plain rows= outside of actual time context
  const plainRowsMatch = content.match(/\brows=(\d+)/i);
  const actualTimeMatch = content.match(/actual time=([\d.]+)\.\.([\d.]+)/i);
  const actualRowsMatch = content.match(
    /actual time=[\d.]+\.\.[\d.]+\s+rows=(\d+)/i,
  );
  const loopsMatch = content.match(/\bloops=(\d+)/i);
  const costMatch = content.match(/\(cost=([\d.eE+-]+)/i);

  const estimatedRows = estimatedRowsMatch
    ? parseInt(estimatedRowsMatch[1] || "0", 10)
    : plainRowsMatch
      ? parseInt(plainRowsMatch[1] || "0", 10)
      : undefined;

  const node: ExplainNode = {
    id: `mysql-tree-${nodeIndexRef.current++}`,
    type: type || "Operation",
    relation,
    indexName,
    indexCond,
    rows: estimatedRows,
    raw: content,
  };

  // Extract cost from (cost=X.XX ...)
  if (costMatch) {
    const costValue = parseFloat(costMatch[1] || "0");
    if (!isNaN(costValue) && costValue > 0) {
      node.cost = { startup: 0, total: costValue };
    }
  }

  if (actualTimeMatch) {
    node.actualTime = {
      startup: parseFloat(actualTimeMatch[1] || "0"),
      total: parseFloat(actualTimeMatch[2] || "0"),
    };
  }

  // Only set actualRows when EXPLAIN ANALYZE data is present
  if (actualRowsMatch) {
    node.actualRows = parseInt(actualRowsMatch[1] || "0", 10);
  }

  if (loopsMatch) {
    node.loops = parseInt(loopsMatch[1] || "0", 10);
  }

  return { indent, node };
}

function parseMySqlTreeExplain(input: ParseMySqlInput): ParsedExplain {
  const lines = input.rows
    .map((row) => row[0])
    .filter((value): value is string => typeof value === "string")
    .filter((line) => line.trim().length > 0);

  const raw = lines.join("\n");
  if (lines.length === 0) {
    return { nodes: [], totalCost: 0, raw };
  }

  const nodeIndexRef = { current: 0 };
  const roots: ExplainNode[] = [];
  const stack: Array<{ indent: number; node: ExplainNode }> = [];

  for (const line of lines) {
    const parsed = parseMySqlTreeLine(line, nodeIndexRef);
    if (!parsed) {
      continue;
    }

    while (stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last && last.indent >= parsed.indent) {
        stack.pop();
      } else {
        break;
      }
    }

    if (stack.length === 0) {
      roots.push(parsed.node);
    } else {
      const parent = stack[stack.length - 1];
      if (parent) {
        if (!parent.node.children) {
          parent.node.children = [];
        }
        parent.node.children.push(parsed.node);
      }
    }

    stack.push(parsed);
  }

  return {
    nodes: roots,
    totalCost: 0,
    raw,
  };
}

export function parseMySqlExplain(input: ParseMySqlInput): ParsedExplain {
  const firstCell = input.rows[0]?.[0];
  if (typeof firstCell === "string") {
    const trimmed = firstCell.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return parseMySqlJsonExplain(input);
    }
  }

  const looksLikeTreeExplain = input.rows.some((row) => {
    const value = row[0];
    if (typeof value !== "string") {
      return false;
    }
    const normalized = value.toLowerCase();
    return (
      value.includes("->") ||
      normalized.includes("nested loop") ||
      normalized.includes("table scan on") ||
      normalized.includes("index lookup on")
    );
  });
  if (looksLikeTreeExplain) {
    return parseMySqlTreeExplain(input);
  }

  return parseMySqlTraditionalExplain(input);
}
