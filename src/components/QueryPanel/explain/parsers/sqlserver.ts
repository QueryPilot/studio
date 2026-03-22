import type { ExplainNode, ParsedExplain } from "../types";
import { formatCell, parseNumber } from "./utils";

interface ParseSqlServerInput {
  columns: string[];
  rows: unknown[][];
}

function cleanIdentifier(identifier: string): string {
  return identifier.replace(/[[\]"]/g, "").trim();
}

function unwrapBalancedParentheses(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return trimmed;
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index < trimmed.length - 1) {
        return trimmed;
      }
    }
  }

  if (depth !== 0) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function isLikelyIndexName(identifier: string): boolean {
  return /^(?:pk|ix|idx|uk|ak|key|index|nc|cl)/i.test(identifier);
}

const SEEK_REGEX = /SEEK\s*:/i;
const WHERE_REGEX = /WHERE\s*:/i;
const PREDICATE_REGEX = /PREDICATE\s*:/i;
const OBJECT_REGEX = /OBJECT\s*:/i;

function extractArgumentSegment(
  argument: string | undefined,
  labelRegex: RegExp,
): string | undefined {
  if (!argument) {
    return undefined;
  }

  const match = labelRegex.exec(argument);
  if (!match) {
    return undefined;
  }

  let start = match.index + match[0].length;
  while (start < argument.length && /\s/.test(argument[start] || "")) {
    start += 1;
  }

  if (start >= argument.length) {
    return undefined;
  }

  if (argument[start] === "(") {
    let depth = 0;
    for (let index = start; index < argument.length; index += 1) {
      const char = argument[index];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return argument.slice(start, index + 1).trim();
        }
      }
    }
    return argument.slice(start).trim();
  }

  let end = start;
  while (end < argument.length) {
    if (argument[end] === ",") {
      const remainder = argument.slice(end + 1);
      if (/^\s*[A-Za-z_]+\s*:/.test(remainder)) {
        break;
      }
    }
    end += 1;
  }

  return argument.slice(start, end).trim();
}

function extractObjectInfo(
  argument: string | undefined,
): { relation?: string; indexName?: string } {
  const objectSegment = extractArgumentSegment(argument, OBJECT_REGEX);
  if (!objectSegment) {
    return {};
  }

  const objectValue = unwrapBalancedParentheses(objectSegment);
  const bracketIdentifiers = Array.from(objectValue.matchAll(/\[([^\]]+)\]/g))
    .map((match) => match[1])
    .filter((part): part is string => Boolean(part && part.length > 0));

  const identifiers =
    bracketIdentifiers.length > 0
      ? bracketIdentifiers
      : objectValue
          .split(".")
          .map((part) => cleanIdentifier(part))
          .filter((part) => part.length > 0);

  if (identifiers.length === 0) {
    return {};
  }

  if (identifiers.length >= 4) {
    return {
      relation: identifiers[identifiers.length - 2],
      indexName: identifiers[identifiers.length - 1],
    };
  }

  if (identifiers.length === 3 && isLikelyIndexName(identifiers[2] || "")) {
    return {
      relation: identifiers[1],
      indexName: identifiers[2],
    };
  }

  return { relation: identifiers[identifiers.length - 1] };
}

function normalizeArgumentValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = unwrapBalancedParentheses(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractRelationFromArgument(argument: string | undefined): string | undefined {
  // Only extract relation from OBJECT:(...) segments in the argument.
  // Do NOT fall back to generic bracket/dotted identifier matching —
  // arguments like ORDER BY:([Expr1004] DESC) or GROUP BY:([c].[first_name])
  // contain bracket identifiers that are column/expression refs, not table names.
  const objectInfo = extractObjectInfo(argument);
  return objectInfo.relation;
}

export function parseSqlServerShowplanAll(
  input: ParseSqlServerInput,
): ParsedExplain {
  const normalizedColumns = input.columns.map((column) =>
    column.toLowerCase().trim(),
  );

  const stmtIdIndex = normalizedColumns.indexOf("stmtid");
  const nodeIdIndex = normalizedColumns.indexOf("nodeid");
  const parentIndex = normalizedColumns.indexOf("parent");
  const physicalOpIndex = normalizedColumns.indexOf("physicalop");
  const logicalOpIndex = normalizedColumns.indexOf("logicalop");
  const estimateRowsIndex = normalizedColumns.indexOf("estimaterows");
  const subtreeCostIndex = normalizedColumns.indexOf("totalsubtreecost");
  const argumentIndex = normalizedColumns.indexOf("argument");
  const estimateIOIndex = normalizedColumns.indexOf("estimateio");
  const estimateCPUIndex = normalizedColumns.indexOf("estimatecpu");
  const avgRowSizeIndex = normalizedColumns.indexOf("avgrowsize");
  const parallelIndex = normalizedColumns.indexOf("parallel");
  const warningsIndex = normalizedColumns.indexOf("warnings");
  const estimateExecutionsIndex = normalizedColumns.indexOf("estimateexecutions");
  const typeIndex = normalizedColumns.indexOf("type");
  const actualRowsIndex = normalizedColumns.indexOf("rows");
  const executesIndex = normalizedColumns.indexOf("executes");

  const raw = input.rows
    .map((row) =>
      input.columns
        .map((column, index) => `${column}=${formatCell(row[index])}`)
        .join(" | "),
    )
    .join("\n");

  if (nodeIdIndex < 0 || physicalOpIndex < 0) {
    return { nodes: [], totalCost: 0, raw };
  }

  const nodeMap = new Map<string, ExplainNode>();
  const parentMap = new Map<string, string | null>();

  input.rows.forEach((row, rowIndex) => {
    const nodeId = parseNumber(row[nodeIdIndex]);
    if (nodeId === undefined) {
      return;
    }

    const stmtId =
      stmtIdIndex >= 0 ? formatCell(row[stmtIdIndex]).trim() || "0" : "0";
    const normalizedStmtId = stmtId === "NULL" ? "0" : stmtId;
    const nodeKey = `${normalizedStmtId}:${nodeId}`;

    const parentValue = parseNumber(row[parentIndex]);
    const parentKey =
      parentValue === undefined ? null : `${normalizedStmtId}:${parentValue}`;
    const physicalOp =
      physicalOpIndex >= 0 ? formatCell(row[physicalOpIndex]) : undefined;
    const logicalOp = logicalOpIndex >= 0 ? formatCell(row[logicalOpIndex]) : undefined;
    const argumentText = argumentIndex >= 0 ? formatCell(row[argumentIndex]) : undefined;
    const argument = argumentText && argumentText !== "NULL" ? argumentText : undefined;
    const objectInfo = extractObjectInfo(argument);
    const relation = objectInfo.relation ?? extractRelationFromArgument(argument);
    const seekValue = normalizeArgumentValue(extractArgumentSegment(argument, SEEK_REGEX));
    const whereValue = normalizeArgumentValue(extractArgumentSegment(argument, WHERE_REGEX));
    const predicateValue = normalizeArgumentValue(
      extractArgumentSegment(argument, PREDICATE_REGEX),
    );

    // Determine node type: prefer PhysicalOp, then LogicalOp, then Type column
    // (e.g. "SELECT"), and only use stmtText as last resort (truncated).
    // For statement-level rows (Type=SELECT/INSERT/etc.), PhysicalOp and LogicalOp
    // are NULL — use the Type column value instead of dumping the full SQL text.
    const typeColumn = typeIndex >= 0 ? formatCell(row[typeIndex]) : undefined;
    const resolvedType =
      (physicalOp && physicalOp !== "NULL" ? physicalOp : undefined) ||
      (logicalOp && logicalOp !== "NULL" ? logicalOp : undefined) ||
      (typeColumn && typeColumn !== "NULL" && typeColumn !== "PLAN_ROW"
        ? typeColumn
        : undefined) ||
      "Operation";

    const node: ExplainNode = {
      id: `sqlserver-node-${normalizedStmtId}-${nodeId}`,
      type: resolvedType,
      relation,
      rows: estimateRowsIndex >= 0 ? parseNumber(row[estimateRowsIndex]) : undefined,
      raw: input.columns
        .map((column, index) => `${column}=${formatCell(row[index])}`)
        .join(" | "),
      children: [],
    };
    if (objectInfo.indexName) {
      node.indexName = objectInfo.indexName;
    }
    if (seekValue) {
      node.indexCond = seekValue;
    }
    if (whereValue || predicateValue) {
      node.filter = whereValue ?? predicateValue;
    }

    const totalCost = subtreeCostIndex >= 0 ? parseNumber(row[subtreeCostIndex]) : undefined;
    if (totalCost !== undefined) {
      node.cost = {
        startup: 0,
        total: totalCost,
      };
    }

    // Operator's own cost = EstimateIO + EstimateCPU (MSSQL-specific).
    // More accurate than subtracting children's subtree costs.
    const estimateIO = estimateIOIndex >= 0 ? parseNumber(row[estimateIOIndex]) : undefined;
    const estimateCPU = estimateCPUIndex >= 0 ? parseNumber(row[estimateCPUIndex]) : undefined;
    if (estimateIO !== undefined || estimateCPU !== undefined) {
      node.operatorCost = (estimateIO ?? 0) + (estimateCPU ?? 0);
    }

    // AvgRowSize → width
    const avgRowSize = avgRowSizeIndex >= 0 ? parseNumber(row[avgRowSizeIndex]) : undefined;
    if (avgRowSize !== undefined) {
      node.width = avgRowSize;
    }

    // Parallel flag
    if (parallelIndex >= 0) {
      const parallelVal = row[parallelIndex];
      if (parallelVal === true || parallelVal === 1 || String(parallelVal).toLowerCase() === "true") {
        node.parallelAware = true;
      }
    }

    // Warnings
    if (warningsIndex >= 0) {
      const warningsVal = formatCell(row[warningsIndex]);
      if (warningsVal && warningsVal !== "NULL") {
        node.warnings = warningsVal;
      }
    }

    // EstimateExecutions → loops (for estimated plans without actual Rows/Executes)
    if (executesIndex < 0 && estimateExecutionsIndex >= 0) {
      const estExec = parseNumber(row[estimateExecutionsIndex]);
      if (estExec !== undefined && estExec > 1) {
        node.loops = estExec;
      }
    }

    // Preserve input row order for deterministic root ordering.
    node.order = rowIndex;

    if (actualRowsIndex >= 0) {
      const actualRows = parseNumber(row[actualRowsIndex]);
      if (actualRows !== undefined) {
        node.actualRows = actualRows;
      }
    }
    if (executesIndex >= 0) {
      const executes = parseNumber(row[executesIndex]);
      if (executes !== undefined) {
        node.loops = executes;
      }
    }

    nodeMap.set(nodeKey, node);
    parentMap.set(nodeKey, parentKey);
  });

  const roots: ExplainNode[] = [];
  for (const [nodeKey, node] of nodeMap.entries()) {
    const parentId = parentMap.get(nodeKey);
    const parentNode =
      parentId === null || parentId === undefined
        ? undefined
        : nodeMap.get(parentId);

    if (parentNode && parentId !== nodeKey) {
      if (!parentNode.children) {
        parentNode.children = [];
      }
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  roots.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));

  const totalCost =
    roots.length > 1
      ? roots.reduce((sum, root) => sum + (root.cost?.total ?? 0), 0)
      : (roots[0]?.cost?.total ?? 0);

  return {
    nodes: roots,
    totalCost,
    raw,
  };
}

export function parseSqlServerXmlShowplan(
  input: ParseSqlServerInput,
): ParsedExplain {
  const xmlPayloads = input.rows
    .flatMap((row) => row)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("<"));

  const raw = xmlPayloads.join("\n\n");
  if (xmlPayloads.length === 0 || typeof DOMParser === "undefined") {
    return {
      nodes: [],
      totalCost: 0,
      raw,
    };
  }

  const getDirectChildrenByName = (
    element: Element,
    localName: string,
  ): Element[] => {
    return Array.from(element.children).filter(
      (child) => child.localName === localName,
    );
  };

  const findNearestRelOpAncestor = (element: Element): Element | null => {
    let current = element.parentElement;
    while (current) {
      if (current.localName === "RelOp") {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const getImmediateChildRelOps = (relOp: Element): Element[] => {
    const descendants = Array.from(relOp.getElementsByTagNameNS("*", "RelOp"));
    return descendants.filter((candidate) => {
      const nearest = findNearestRelOpAncestor(candidate);
      return nearest === relOp;
    });
  };

  const getElementsWithinRelOp = (
    relOp: Element,
    localName: string,
  ): Element[] => {
    return Array.from(relOp.getElementsByTagNameNS("*", localName)).filter(
      (candidate) => findNearestRelOpAncestor(candidate) === relOp,
    );
  };

  const extractScalarStringsFromContainer = (
    relOp: Element,
    containerLocalName: string,
  ): string[] => {
    const containers = getElementsWithinRelOp(relOp, containerLocalName);
    const scalarStrings: string[] = [];

    for (const container of containers) {
      const scalarOperators = Array.from(
        container.getElementsByTagNameNS("*", "ScalarOperator"),
      );
      for (const scalarOperator of scalarOperators) {
        if (findNearestRelOpAncestor(scalarOperator) !== relOp) {
          continue;
        }
        const scalarString = scalarOperator.getAttribute("ScalarString");
        if (scalarString && scalarString.length > 0) {
          scalarStrings.push(scalarString);
        }
      }
    }

    return scalarStrings;
  };

  const serializer = new XMLSerializer();
  let nodeCounter = 0;
  const parseRelOpElement = (relOp: Element): ExplainNode => {
    const physicalOp = relOp.getAttribute("PhysicalOp");
    const logicalOp = relOp.getAttribute("LogicalOp");
    const estimateRows = parseNumber(relOp.getAttribute("EstimateRows"));
    const subtreeCost = parseNumber(
      relOp.getAttribute("EstimatedTotalSubtreeCost"),
    );

    const objectElements = Array.from(relOp.getElementsByTagNameNS("*", "Object"));
    const directObject = objectElements.find((candidate) => {
      const nearest = findNearestRelOpAncestor(candidate);
      return nearest === relOp;
    });
    const tableName = directObject?.getAttribute("Table") || undefined;
    const indexName = directObject?.getAttribute("Index") || undefined;
    const relation = tableName ? cleanIdentifier(tableName) : undefined;
    const seekPredicates = extractScalarStringsFromContainer(relOp, "SeekPredicates");
    const predicates = extractScalarStringsFromContainer(relOp, "Predicate");

    const node: ExplainNode = {
      id: `sqlserver-xml-${nodeCounter++}`,
      type: physicalOp || logicalOp || "Operation",
      relation,
      rows: estimateRows,
      raw: serializer.serializeToString(relOp),
    };
    if (indexName) {
      node.indexName = cleanIdentifier(indexName);
    }
    if (seekPredicates.length > 0) {
      node.indexCond = seekPredicates.join(" AND ");
    }
    if (predicates.length > 0) {
      node.filter = predicates.join(" AND ");
    }

    if (subtreeCost !== undefined) {
      node.cost = {
        startup: 0,
        total: subtreeCost,
      };
    }

    // Extract operator-level cost for accurate StatsView
    const estimateIO = parseNumber(relOp.getAttribute("EstimateIO"));
    const estimateCPU = parseNumber(relOp.getAttribute("EstimateCPU"));
    if (estimateIO !== undefined || estimateCPU !== undefined) {
      node.operatorCost = (estimateIO ?? 0) + (estimateCPU ?? 0);
    }

    // Extract actual execution stats from RunTimeInformation (STATISTICS XML)
    const runtimeInfos = getElementsWithinRelOp(relOp, "RunTimeCountersPerThread");
    if (runtimeInfos.length > 0) {
      let totalActualRows = 0;
      let totalActualExecutions = 0;
      let totalElapsedMs = 0;
      for (const rt of runtimeInfos) {
        totalActualRows += parseNumber(rt.getAttribute("ActualRows")) ?? 0;
        totalActualExecutions += parseNumber(rt.getAttribute("ActualExecutions")) ?? 0;
        totalElapsedMs += parseNumber(rt.getAttribute("ActualElapsedms")) ?? 0;
      }
      if (totalActualRows > 0 || totalActualExecutions > 0) {
        node.actualRows = totalActualRows;
      }
      if (totalActualExecutions > 0) {
        node.loops = totalActualExecutions;
      }
      if (totalElapsedMs > 0) {
        node.actualTime = { startup: 0, total: totalElapsedMs };
      }
    }

    const children = getImmediateChildRelOps(relOp).map(parseRelOpElement);
    if (children.length > 0) {
      node.children = children;
    }

    return node;
  };

  const roots: ExplainNode[] = [];
  for (const xmlText of xmlPayloads) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors.length > 0) {
      continue;
    }

    const queryPlans = Array.from(doc.getElementsByTagNameNS("*", "QueryPlan"));
    for (const queryPlan of queryPlans) {
      const directRoots = getDirectChildrenByName(queryPlan, "RelOp");
      if (directRoots.length > 0) {
        roots.push(...directRoots.map(parseRelOpElement));
        continue;
      }

      const fallbackRoots = Array.from(
        queryPlan.getElementsByTagNameNS("*", "RelOp"),
      ).filter((candidate) => findNearestRelOpAncestor(candidate) === null);
      roots.push(...fallbackRoots.map(parseRelOpElement));
    }
  }

  const totalCost =
    roots.length > 1
      ? roots.reduce((sum, root) => sum + (root.cost?.total ?? 0), 0)
      : (roots[0]?.cost?.total ?? 0);

  return {
    nodes: roots,
    totalCost,
    raw,
  };
}

export function parseSqlServerExplain(input: ParseSqlServerInput): ParsedExplain {
  const firstCell = input.rows[0]?.[0];
  if (typeof firstCell === "string" && firstCell.trim().startsWith("<")) {
    return parseSqlServerXmlShowplan(input);
  }

  return parseSqlServerShowplanAll(input);
}
