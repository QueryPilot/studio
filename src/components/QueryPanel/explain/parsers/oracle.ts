import type { ExplainNode, ParsedExplain } from "../types";
import { formatCell, parseNumber } from "./utils";

interface ParseOracleInput {
  columns: string[];
  rows: unknown[][];
}

/**
 * Parse Oracle DBMS_XPLAN.DISPLAY output.
 *
 * Oracle explain plans come from:
 *   EXPLAIN PLAN FOR <sql>;
 *   SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
 *
 * The result is a single column "PLAN_TABLE_OUTPUT" containing text lines like:
 *
 *   Plan hash value: 3617692013
 *   -------------------------------------------
 *   | Id  | Operation          | Name | Rows  | Bytes | Cost (%CPU)| Time     |
 *   -------------------------------------------
 *   |   0 | SELECT STATEMENT   |      |    20 |  1200 |     3  (0) | 00:00:01 |
 *   |   1 |  TABLE ACCESS FULL | EMP  |    20 |  1200 |     3  (0) | 00:00:01 |
 *   -------------------------------------------
 */
export function parseOracleExplain(input: ParseOracleInput): ParsedExplain {
  const lines: string[] = [];
  for (const row of input.rows) {
    const value = row[0];
    lines.push(value == null ? "" : formatCell(value));
  }

  const raw = lines.join("\n");

  // Find the tabular section by locating the header row with "| Id"
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\|\s*Id\s*\|/i.test(lines[i] ?? "")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { nodes: [], totalCost: 0, raw };
  }

  // Parse column positions from the header
  const headerLine = lines[headerIndex] ?? "";
  const columnNames: string[] = [];
  const columnStarts: number[] = [];
  const columnEnds: number[] = [];

  const pipeRegex = /\|/g;
  const pipes: number[] = [];
  let pipeMatch: RegExpExecArray | null;
  while ((pipeMatch = pipeRegex.exec(headerLine)) !== null) {
    pipes.push(pipeMatch.index);
  }

  for (let i = 0; i < pipes.length - 1; i++) {
    const start = (pipes[i] ?? 0) + 1;
    const end = pipes[i + 1] ?? headerLine.length;
    const name = headerLine.slice(start, end).trim().toLowerCase();
    if (name) {
      columnNames.push(name);
      columnStarts.push(start);
      columnEnds.push(end);
    }
  }

  function extractColumn(line: string, colIndex: number): string {
    const start = columnStarts[colIndex] ?? 0;
    const end = columnEnds[colIndex] ?? line.length;
    if (line.length >= end) return line.slice(start, end).trim();
    if (line.length > start) return line.slice(start).trim();
    return "";
  }

  function extractColumnRaw(line: string, colIndex: number): string {
    const start = columnStarts[colIndex] ?? 0;
    const end = columnEnds[colIndex] ?? line.length;
    if (line.length >= end) return line.slice(start, end);
    if (line.length > start) return line.slice(start);
    return "";
  }

  // Parse data rows (skip separator lines)
  const nodeEntries: Array<{ node: ExplainNode; indent: number }> = [];
  let totalCost = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes("|") || /^\s*[-+]+\s*$/.test(line)) continue;

    const values: Record<string, string> = {};
    for (let c = 0; c < columnNames.length; c++) {
      const colName = columnNames[c];
      if (colName) values[colName] = extractColumn(line, c);
    }

    const id = values["id"] ?? String(nodeEntries.length);
    const operation = values["operation"] ?? "";
    const name = values["name"] ?? "";
    const rows = parseNumber(values["rows"]);
    const bytes = parseNumber(values["bytes"]);

    // Parse "Cost (%CPU)" — may be like "3  (0)" or "3 (100)"
    let costTotal: number | undefined;
    const costStr = values["cost (%cpu)"] ?? values["cost"] ?? "";
    const costMatch = /(\d+(?:\.\d+)?)/.exec(costStr);
    if (costMatch) {
      costTotal = parseNumber(costMatch[1]);
    }

    // Determine indentation level from the operation column's raw content
    const opIdx = columnNames.indexOf("operation");
    const operationRaw = opIdx >= 0 ? extractColumnRaw(line, opIdx) : "";
    const indent = operationRaw.length - operationRaw.trimStart().length;

    const node: ExplainNode = {
      id: String(id),
      type: operation,
      relation: name || undefined,
      rows,
      width: bytes,
      cost: costTotal != null ? { startup: 0, total: costTotal } : undefined,
      children: [],
    };

    if (costTotal != null && costTotal > totalCost) {
      totalCost = costTotal;
    }

    nodeEntries.push({ node, indent });
  }

  // Build tree from indentation
  const rootNodes: ExplainNode[] = [];
  const stack: Array<{ node: ExplainNode; indent: number }> = [];

  for (const entry of nodeEntries) {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top || top.indent < entry.indent) break;
      stack.pop();
    }

    if (stack.length === 0) {
      rootNodes.push(entry.node);
    } else {
      const top = stack[stack.length - 1];
      if (top) {
        if (!top.node.children) top.node.children = [];
        top.node.children.push(entry.node);
      }
    }

    stack.push(entry);
  }

  return {
    nodes: rootNodes,
    totalCost,
    raw,
  };
}
