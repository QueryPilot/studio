import type {
  FilterConfig,
  FilterCondition,
  LogicalOperator,
} from "@/types/filter";

export type FilterMode = "search" | "where" | "ai";

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable?: boolean;
  enumValues?: string[];
}

export interface ParseResult {
  success: boolean;
  filter?: FilterConfig;
  error?: string;
}

let conditionIdCounter = 0;
function generateId(): string {
  return `cond_${++conditionIdCounter}`;
}

function isTextType(dataType: string): boolean {
  const textTypes = [
    "text",
    "varchar",
    "char",
    "character",
    "string",
    "nvarchar",
    "nchar",
    "ntext",
    "citext",
  ];
  return textTypes.some((t) => dataType.toLowerCase().includes(t));
}

export function parseSimpleSearch(
  text: string,
  columns: ColumnMeta[]
): FilterConfig {
  const searchValue = text.trim();
  if (!searchValue) {
    return createEmptyFilter();
  }

  const searchableColumns = columns.filter((c) => isTextType(c.dataType));

  if (searchableColumns.length === 0) {
    return createEmptyFilter();
  }

  const conditions: FilterCondition[] = searchableColumns.map((col) => ({
    id: generateId(),
    column: col.name,
    operator: "ILIKE",
    value: `%${searchValue}%`,
  }));

  return {
    root: {
      id: "root",
      type: "group",
      logical: "OR",
      conditions,
    },
  };
}

export function parseWhereClause(
  whereExpr: string,
  columns: ColumnMeta[]
): ParseResult {
  const expr = whereExpr.trim();
  if (!expr) {
    return { success: true, filter: undefined };
  }

  try {
    const validationError = validateWhereClause(expr, columns);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const filter = parseExpression(expr, columns);
    return { success: true, filter };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Parse error",
    };
  }
}

export function validateWhereClause(
  clause: string,
  columns: ColumnMeta[]
): string | null {
  const columnNames = new Set(columns.map((c) => c.name.toLowerCase()));

  // Extract potential column references
  const tokens = tokenize(clause);
  const identifiers = tokens.filter((t) => t.type === "identifier");

  for (const token of identifiers) {
    const name = token.value.toLowerCase();
    if (!columnNames.has(name)) {
      return `Unknown column: ${token.value}`;
    }
  }

  // Basic syntax validation
  const operators = ["=", "!=", "<>", ">", "<", ">=", "<="];
  const hasOperator = operators.some((op) => clause.includes(op));
  const hasKeywordOp = /\b(LIKE|ILIKE|IN|IS|BETWEEN)\b/i.test(clause);

  if (!hasOperator && !hasKeywordOp) {
    return "Missing comparison operator";
  }

  return null;
}

export function sanitizeInput(input: string, mode: FilterMode): string {
  let sanitized = input.trim();

  switch (mode) {
    case "where":
      if (sanitized.startsWith("?")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
    case "ai":
      if (sanitized.startsWith("#")) {
        sanitized = sanitized.slice(1).trim();
      }
      break;
  }

  return sanitized;
}

function createEmptyFilter(): FilterConfig {
  return {
    root: {
      id: "root",
      type: "group",
      logical: "AND",
      conditions: [],
    },
  };
}

interface Token {
  type:
    | "identifier"
    | "operator"
    | "value"
    | "string"
    | "number"
    | "keyword"
    | "paren";
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const keywords = [
    "AND",
    "OR",
    "NOT",
    "IN",
    "IS",
    "NULL",
    "LIKE",
    "ILIKE",
    "BETWEEN",
    "TRUE",
    "FALSE",
  ];
  const operators = ["=", "!=", "<>", ">=", "<=", ">", "<"];

  let i = 0;
  while (i < expr.length) {
    const char = expr[i];
    if (!char) break;

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // String literals
    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      i++;
      while (i < expr.length) {
        const c = expr[i];
        if (!c || c === quote) break;
        if (c === "\\" && i + 1 < expr.length) {
          const next = expr[++i];
          if (next) value += next;
        } else {
          value += c;
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: "string", value });
      continue;
    }

    // Numbers
    const nextChar = expr[i + 1];
    if (/\d/.test(char) || (char === "-" && nextChar && /\d/.test(nextChar))) {
      let value = "";
      if (char === "-") {
        value += char;
        i++;
      }
      while (i < expr.length) {
        const c = expr[i];
        if (!c || !/[\d.]/.test(c)) break;
        value += c;
        i++;
      }
      tokens.push({ type: "number", value });
      continue;
    }

    // Parentheses
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      i++;
      continue;
    }

    // Multi-char operators
    const twoChar = expr.slice(i, i + 2);
    if (operators.includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar });
      i += 2;
      continue;
    }

    // Single-char operators
    if (operators.includes(char)) {
      tokens.push({ type: "operator", value: char });
      i++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let value = "";
      while (i < expr.length) {
        const c = expr[i];
        if (!c || !/[a-zA-Z0-9_]/.test(c)) break;
        value += c;
        i++;
      }
      const upper = value.toUpperCase();
      if (keywords.includes(upper)) {
        tokens.push({ type: "keyword", value: upper });
      } else {
        tokens.push({ type: "identifier", value });
      }
      continue;
    }

    // Skip unknown characters
    i++;
  }

  return tokens;
}

function parseExpression(expr: string, columns: ColumnMeta[]): FilterConfig {
  const tokens = tokenize(expr);

  // Find top-level AND/OR to determine grouping
  const topLevelLogical = findTopLevelLogical(tokens);

  if (!topLevelLogical) {
    // Single condition
    const condition = parseCondition(tokens, columns);
    return {
      root: {
        id: "root",
        type: "group",
        logical: "AND",
        conditions: [condition],
      },
    };
  }

  // Split by logical operator
  const parts = splitByLogical(tokens, topLevelLogical);
  const conditions: FilterCondition[] = parts.map((part) =>
    parseCondition(part, columns)
  );

  return {
    root: {
      id: "root",
      type: "group",
      logical: topLevelLogical as LogicalOperator,
      conditions,
    },
  };
}

function findTopLevelLogical(tokens: Token[]): string | null {
  let parenDepth = 0;
  let foundAnd = false;
  let foundOr = false;

  for (const token of tokens) {
    if (token.type === "paren") {
      parenDepth += token.value === "(" ? 1 : -1;
      continue;
    }

    if (parenDepth === 0 && token.type === "keyword") {
      if (token.value === "AND") foundAnd = true;
      if (token.value === "OR") foundOr = true;
    }
  }

  // OR has lower precedence, so check it first
  if (foundOr) return "OR";
  if (foundAnd) return "AND";
  return null;
}

function splitByLogical(tokens: Token[], logical: string): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let parenDepth = 0;

  for (const token of tokens) {
    if (token.type === "paren") {
      parenDepth += token.value === "(" ? 1 : -1;
      current.push(token);
      continue;
    }

    if (
      parenDepth === 0 &&
      token.type === "keyword" &&
      token.value === logical
    ) {
      if (current.length > 0) {
        parts.push(current);
        current = [];
      }
      continue;
    }

    current.push(token);
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

function parseCondition(tokens: Token[], _columns: ColumnMeta[]): FilterCondition {
  // Remove outer parentheses if present
  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  if (
    firstToken?.type === "paren" &&
    firstToken.value === "(" &&
    lastToken?.type === "paren" &&
    lastToken.value === ")"
  ) {
    tokens = tokens.slice(1, -1);
  }

  // Find the column (first identifier)
  const columnToken = tokens.find((t) => t.type === "identifier");
  if (!columnToken) {
    throw new Error("Missing column name in condition");
  }

  // Find the operator
  let operator = "";
  let operatorIndex = -1;
  const keywordOps = ["LIKE", "ILIKE", "IN", "BETWEEN"];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.type === "operator") {
      operator = token.value;
      operatorIndex = i;
      break;
    }
    if (token.type === "keyword" && keywordOps.includes(token.value)) {
      operator = token.value;
      operatorIndex = i;
      break;
    }
    // Handle IS NULL / IS NOT NULL
    if (token.type === "keyword" && token.value === "IS") {
      if (tokens[i + 1]?.value === "NOT" && tokens[i + 2]?.value === "NULL") {
        operator = "IS NOT NULL";
        operatorIndex = i;
        break;
      }
      if (tokens[i + 1]?.value === "NULL") {
        operator = "IS NULL";
        operatorIndex = i;
        break;
      }
    }
  }

  if (!operator) {
    throw new Error(`Missing operator in condition: ${tokens.map((t) => t.value).join(" ")}`);
  }

  // Extract value
  let value: unknown;
  if (operator === "IS NULL" || operator === "IS NOT NULL") {
    value = undefined;
  } else {
    const valueTokens = tokens.slice(operatorIndex + 1);
    value = extractValue(valueTokens);
  }

  // Normalize operator
  if (operator === "<>") operator = "!=";

  return {
    id: generateId(),
    column: columnToken.value,
    operator,
    value,
  };
}

function extractValue(tokens: Token[]): unknown {
  if (tokens.length === 0) {
    throw new Error("Missing value");
  }

  const first = tokens[0];
  if (!first) {
    throw new Error("Missing value");
  }

  if (first.type === "string") {
    return first.value;
  }

  if (first.type === "number") {
    return first.value.includes(".")
      ? parseFloat(first.value)
      : parseInt(first.value, 10);
  }

  if (first.type === "keyword") {
    if (first.value === "TRUE") return true;
    if (first.value === "FALSE") return false;
    if (first.value === "NULL") return null;
  }

  // Handle IN (value1, value2, ...)
  if (first.type === "paren" && first.value === "(") {
    const values: unknown[] = [];
    for (const token of tokens) {
      if (token.type === "string" || token.type === "number") {
        const val =
          token.type === "number"
            ? token.value.includes(".")
              ? parseFloat(token.value)
              : parseInt(token.value, 10)
            : token.value;
        values.push(val);
      }
    }
    return values;
  }

  // Identifier as value (e.g., column reference - treat as string for now)
  if (first.type === "identifier") {
    return first.value;
  }

  throw new Error(`Unexpected value: ${first.value}`);
}

export function detectFilterMode(input: string): FilterMode {
  const trimmed = input.trim();
  if (trimmed.startsWith("#")) return "ai";
  if (trimmed.startsWith("?")) return "where";
  return "search";
}
