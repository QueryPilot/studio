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

  const nodes: ExplainNode[] = records.map((record, index) => {
    const node: ExplainNode = {
      id: `mysql-node-${index}`,
      type: record.accessType || "UNKNOWN",
      relation: record.table,
      rows: record.estimatedRows,
      indexName: record.key,
      raw: record.raw,
    };

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

  return {
    nodes,
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
        childNodes.push(parsedChild);
      }
    }
  }

  if (record.query_block && typeof record.query_block === "object") {
    const nestedBlock = parseMySqlJsonNode(record.query_block, nodeIndexRef);
    if (nestedBlock) {
      childNodes.push(nestedBlock);
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

  let normalizedRoot = rootNode;
  while (
    (normalizedRoot.type === "Operation" ||
      normalizedRoot.type.startsWith("Query Block")) &&
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

  const rowsMatch = content.match(/\brows=(\d+)/i);
  const actualTimeMatch = content.match(/actual time=([\d.]+)\.\.([\d.]+)/i);
  const loopsMatch = content.match(/\bloops=(\d+)/i);

  const node: ExplainNode = {
    id: `mysql-tree-${nodeIndexRef.current++}`,
    type: type || "Operation",
    relation,
    indexName,
    indexCond,
    rows: rowsMatch ? parseInt(rowsMatch[1] || "0", 10) : undefined,
    raw: content,
  };

  if (actualTimeMatch) {
    node.actualTime = {
      startup: parseFloat(actualTimeMatch[1] || "0"),
      total: parseFloat(actualTimeMatch[2] || "0"),
    };
  }

  if (rowsMatch) {
    node.actualRows = parseInt(rowsMatch[1] || "0", 10);
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
