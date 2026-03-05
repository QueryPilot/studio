import type { ExplainNode, ParsedExplain } from "../types";

interface ParseSQLiteInput {
  columns: string[];
  rows: unknown[][];
}

interface SqlitePlanRow {
  id: number;
  parent: number;
  detail: string;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseTypeAndRelation(detail: string): {
  type: string;
  relation?: string;
  indexName?: string;
  indexCond?: string;
  sortKey?: string[];
  groupKey?: string[];
} {
  const trimmed = detail.trim();
  const upper = trimmed.toUpperCase();

  const extractRelationAndRemainder = (
    value: string,
  ): { relation?: string; remainder?: string } => {
    const withoutTableKeyword = value.toUpperCase().startsWith("TABLE ")
      ? value.slice(6).trim()
      : value;
    const token = withoutTableKeyword.split(/\s+/)[0];
    if (!token) return {};
    const remainder = withoutTableKeyword.slice(token.length).trim();
    return {
      relation: token,
      remainder: remainder.length > 0 ? remainder : undefined,
    };
  };

  const parseSearchDetails = (
    remainder?: string,
  ): {
    indexName?: string;
    indexCond?: string;
  } => {
    if (!remainder) return {};
    const remainderUpper = remainder.toUpperCase();

    const indexMatch = remainder.match(
      /USING\s+(?:AUTOMATIC\s+)?(?:COVERING\s+)?INDEX\s+([^\s(]+)(?:\s*\((.+)\))?/i,
    );
    if (indexMatch?.[1]) {
      return {
        indexName: indexMatch[1].trim() || undefined,
        indexCond: indexMatch[2]?.trim(),
      };
    }

    if (remainderUpper.startsWith("USING INTEGER PRIMARY KEY")) {
      const condMatch = remainder.match(/\((.+)\)/);
      return {
        indexName: "INTEGER PRIMARY KEY",
        indexCond: condMatch?.[1]?.trim(),
      };
    }

    return {};
  };

  if (upper.startsWith("SCAN ")) {
    const { relation, remainder } = extractRelationAndRemainder(
      trimmed.slice(5).trim(),
    );
    const searchDetails = parseSearchDetails(remainder);
    return { type: "SCAN", relation, ...searchDetails };
  }

  if (upper.startsWith("SEARCH ")) {
    const { relation, remainder } = extractRelationAndRemainder(
      trimmed.slice(7).trim(),
    );
    const searchDetails = parseSearchDetails(remainder);
    return { type: "SEARCH", relation, ...searchDetails };
  }

  if (upper.startsWith("USE TEMP B-TREE")) {
    const remainder = trimmed.slice("USE TEMP B-TREE".length).trim();
    const remainderUpper = remainder.toUpperCase();
    if (remainderUpper.startsWith("FOR GROUP BY")) {
      return { type: "USE TEMP B-TREE", groupKey: ["TEMP B-TREE FOR GROUP BY"] };
    }
    if (remainderUpper.startsWith("FOR ORDER BY")) {
      return { type: "USE TEMP B-TREE", sortKey: ["TEMP B-TREE FOR ORDER BY"] };
    }
    if (remainderUpper.startsWith("FOR DISTINCT")) {
      return { type: "USE TEMP B-TREE", groupKey: ["TEMP B-TREE FOR DISTINCT"] };
    }
    if (remainderUpper.startsWith("FOR RIGHT PART OF ORDER BY")) {
      return {
        type: "USE TEMP B-TREE",
        sortKey: ["TEMP B-TREE FOR RIGHT PART OF ORDER BY"],
      };
    }
    return { type: "USE TEMP B-TREE" };
  }

  if (upper.startsWith("MULTI-INDEX OR")) {
    return { type: "MULTI-INDEX OR" };
  }

  if (upper.startsWith("MATERIALIZE")) {
    const relation = trimmed.slice("MATERIALIZE".length).trim().split(/\s+/)[0];
    return { type: "MATERIALIZE", relation: relation || undefined };
  }

  if (upper.startsWith("COMPOUND QUERY")) {
    return { type: "COMPOUND QUERY" };
  }

  if (upper.startsWith("CO-ROUTINE ")) {
    const relation = trimmed.slice(11).split(/\s+/)[0];
    return { type: "CO-ROUTINE", relation };
  }

  const firstWord = trimmed.split(/\s+/)[0] || "UNKNOWN";
  return { type: firstWord.toUpperCase() };
}

export function parseSQLiteExplainQueryPlan(
  input: ParseSQLiteInput,
): ParsedExplain {
  const normalizedColumns = input.columns.map((column) =>
    column.toLowerCase().trim(),
  );

  const idIndex = normalizedColumns.indexOf("id");
  const parentIndex = normalizedColumns.indexOf("parent");
  const detailIndex = normalizedColumns.findIndex((column) =>
    column.endsWith("detail"),
  );

  const raw =
    detailIndex >= 0
      ? input.rows
          .map((row) => {
            const detail = row[detailIndex];
            if (typeof detail === "string") {
              return detail;
            }
            if (
              typeof detail === "number" ||
              typeof detail === "boolean" ||
              typeof detail === "bigint"
            ) {
              return String(detail);
            }
            if (detail === null || detail === undefined) {
              return "";
            }
            try {
              return JSON.stringify(detail);
            } catch {
              return "";
            }
          })
          .filter((line) => line.length > 0)
          .join("\n")
      : "";

  if (idIndex < 0 || parentIndex < 0 || detailIndex < 0) {
    return { nodes: [], totalCost: 0, raw };
  }

  const parsedRows: SqlitePlanRow[] = input.rows
    .map((row) => {
      const id = toNumber(row[idIndex]);
      const parent = toNumber(row[parentIndex]);
      const detail = row[detailIndex];
      if (id === null || parent === null || typeof detail !== "string") {
        return null;
      }
      return { id, parent, detail };
    })
    .filter((row): row is SqlitePlanRow => row !== null);

  if (parsedRows.length === 0) {
    return { nodes: [], totalCost: 0, raw };
  }

  const nodes = new Map<number, ExplainNode>();

  for (const row of parsedRows) {
    const parsed = parseTypeAndRelation(row.detail);
    nodes.set(row.id, {
      id: `sqlite-node-${row.id}`,
      type: parsed.type,
      relation: parsed.relation,
      indexName: parsed.indexName,
      indexCond: parsed.indexCond,
      sortKey: parsed.sortKey,
      groupKey: parsed.groupKey,
      raw: row.detail,
      children: [],
    });
  }

  const roots: ExplainNode[] = [];
  for (const row of parsedRows) {
    const node = nodes.get(row.id);
    if (!node) continue;

    const parentNode = nodes.get(row.parent);
    if (parentNode && row.parent !== row.id) {
      if (!parentNode.children) {
        parentNode.children = [];
      }
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return {
    nodes: roots,
    totalCost: 0,
    raw,
  };
}
