import type { ExplainNode, ParsedExplain } from "../types";

interface ParseSqlServerInput {
  columns: string[];
  rows: unknown[][];
}

function cleanIdentifier(identifier: string): string {
  return identifier.replace(/[[\]"]/g, "").trim();
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
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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

function extractArgumentSegment(
  argument: string | undefined,
  label: string,
): string | undefined {
  if (!argument) {
    return undefined;
  }

  const labelRegex = new RegExp(`${label}\\s*:`, "i");
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
  const objectSegment = extractArgumentSegment(argument, "OBJECT");
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
  const objectInfo = extractObjectInfo(argument);
  if (objectInfo.relation) {
    return objectInfo.relation;
  }

  if (!argument) {
    return undefined;
  }

  const bracketIdentifiers = Array.from(argument.matchAll(/\[([^\]]+)\]/g))
    .map((match) => match[1])
    .filter((part): part is string => Boolean(part && part.length > 0));
  if (bracketIdentifiers.length > 0) {
    return bracketIdentifiers[bracketIdentifiers.length - 1];
  }

  const dottedIdentifiers = argument
    .split(".")
    .map((part) => cleanIdentifier(part))
    .filter((part) => part.length > 0);
  if (dottedIdentifiers.length === 0) {
    return undefined;
  }
  return dottedIdentifiers[dottedIdentifiers.length - 1];
}

export function parseSqlServerShowplanAll(
  input: ParseSqlServerInput,
): ParsedExplain {
  const normalizedColumns = input.columns.map((column) =>
    column.toLowerCase().trim(),
  );

  const stmtTextIndex = normalizedColumns.indexOf("stmttext");
  const stmtIdIndex = normalizedColumns.indexOf("stmtid");
  const nodeIdIndex = normalizedColumns.indexOf("nodeid");
  const parentIndex = normalizedColumns.indexOf("parent");
  const physicalOpIndex = normalizedColumns.indexOf("physicalop");
  const logicalOpIndex = normalizedColumns.indexOf("logicalop");
  const estimateRowsIndex = normalizedColumns.indexOf("estimaterows");
  const subtreeCostIndex = normalizedColumns.indexOf("totalsubtreecost");
  const argumentIndex = normalizedColumns.indexOf("argument");
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
    const stmtText = stmtTextIndex >= 0 ? formatCell(row[stmtTextIndex]) : undefined;
    const argumentText = argumentIndex >= 0 ? formatCell(row[argumentIndex]) : undefined;
    const argument = argumentText && argumentText !== "NULL" ? argumentText : undefined;
    const objectInfo = extractObjectInfo(argument);
    const relation = objectInfo.relation ?? extractRelationFromArgument(argument);
    const seekValue = normalizeArgumentValue(extractArgumentSegment(argument, "SEEK"));
    const whereValue = normalizeArgumentValue(extractArgumentSegment(argument, "WHERE"));
    const predicateValue = normalizeArgumentValue(
      extractArgumentSegment(argument, "PREDICATE"),
    );

    const node: ExplainNode = {
      id: `sqlserver-node-${normalizedStmtId}-${nodeId}`,
      type:
        (physicalOp && physicalOp !== "NULL" ? physicalOp : undefined) ||
        (logicalOp && logicalOp !== "NULL" ? logicalOp : undefined) ||
        (stmtText && stmtText !== "NULL" ? stmtText : undefined) ||
        "Operation",
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
      raw: new XMLSerializer().serializeToString(relOp),
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
