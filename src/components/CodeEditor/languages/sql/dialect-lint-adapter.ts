import type { SqlDialect } from "../../types";
import { neutralizeVariables } from "@/lib/queryVariables/parser";

export interface FastLintDiagnostic {
  from: number;
  to: number;
  severity: string;
  message: string;
  source: string;
}

export interface PreparedSql {
  canonicalSql: string;
  offsetMap: number[];
  fastDiagnostics: FastLintDiagnostic[];
  canRunSemantic: boolean;
}

interface SqlToken {
  kind: "word" | "symbol";
  text: string;
  from: number;
  to: number;
}

const PREPARED_CACHE = new Map<string, PreparedSql>();
const MAX_CACHE_ENTRIES = 20;
const TYPO_MESSAGES = new Map<string, string>([
  ["SELCT", "SELECT"],
  ["FORM", "FROM"],
  ["WHER", "WHERE"],
  ["WEHERE", "WHERE"],
]);
const EXPLAIN_BARE_OPTION_KEYWORDS = new Set([
  "ANALYZE",
  "ANALYSE",
  "VERBOSE",
  "COSTS",
  "SETTINGS",
  "BUFFERS",
  "WAL",
  "TIMING",
  "SUMMARY",
  "FORMAT",
]);
const EXPLAIN_FORMAT_VALUES = new Set([
  "TEXT",
  "XML",
  "JSON",
  "YAML",
]);

function isWordStart(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z_]/.test(ch));
}

function isWordPart(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_]/.test(ch));
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const ch = sql[index];
    const next = sql[index + 1];

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      index += 1;
      while (index < sql.length) {
        const current = sql[index];
        if (current === quote) {
          if (quote === "'" && sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (ch === "[" && sql.includes("]", index + 1)) {
      index += 1;
      while (index < sql.length && sql[index] !== "]") {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (ch === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      index += 2;
      while (index + 1 < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(sql.length, index + 2);
      continue;
    }

    if (ch === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, index + tag.length);
        if (end !== -1) {
          index = end + tag.length;
          continue;
        }
      }
    }

    if (isWordStart(ch)) {
      const start = index;
      index += 1;
      while (isWordPart(sql[index])) {
        index += 1;
      }
      tokens.push({
        kind: "word",
        text: sql.slice(start, index),
        from: start,
        to: index,
      });
      continue;
    }

    if (/\d/.test(ch ?? "")) {
      const start = index;
      index += 1;
      while (/\d/.test(sql[index] ?? "")) {
        index += 1;
      }
      tokens.push({
        kind: "word",
        text: sql.slice(start, index),
        from: start,
        to: index,
      });
      continue;
    }

    if (!/\s/.test(ch ?? "")) {
      tokens.push({
        kind: "symbol",
        text: ch ?? "",
        from: index,
        to: index + 1,
      });
    }

    index += 1;
  }

  return tokens;
}

function buildIdentityOffsetMap(length: number): number[] {
  return Array.from({ length: length + 1 }, (_, index) => index);
}

function previousToken(tokens: SqlToken[], index: number, statementStart: number): SqlToken | null {
  for (let cursor = index - 1; cursor >= statementStart; cursor -= 1) {
    return tokens[cursor] ?? null;
  }
  return null;
}

function nextToken(tokens: SqlToken[], index: number, statementEnd: number): SqlToken | null {
  for (let cursor = index + 1; cursor < statementEnd; cursor += 1) {
    return tokens[cursor] ?? null;
  }
  return null;
}

function pushDiagnostic(
  diagnostics: FastLintDiagnostic[],
  diagnostic: FastLintDiagnostic,
): void {
  diagnostics.push(diagnostic);
}

function statementRanges(tokens: SqlToken[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.text === ";") {
      if (start < index) {
        ranges.push({ start, end: index });
      }
      start = index + 1;
    }
  }

  if (start < tokens.length) {
    ranges.push({ start, end: tokens.length });
  }

  return ranges;
}

function firstWordToken(
  tokens: SqlToken[],
  start: number,
  end: number,
): { token: SqlToken; index: number } | null {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.kind === "word") {
      return { token, index };
    }
  }
  return null;
}

function buildKeywordTypoDiagnostics(tokens: SqlToken[]): FastLintDiagnostic[] {
  const diagnostics: FastLintDiagnostic[] = [];

  for (const { start, end } of statementRanges(tokens)) {
    for (let index = start; index < end; index += 1) {
      const token = tokens[index];
      if (!token || token.kind !== "word") continue;

      const upper = token.text.toUpperCase();
      const corrected = TYPO_MESSAGES.get(upper);
      if (!corrected) continue;

      const previous = previousToken(tokens, index, start);
      const next = nextToken(tokens, index, end);
      const previousUpper = previous?.text.toUpperCase();
      const nextUpper = next?.text.toUpperCase();

      const shouldReport =
        upper === "SELCT"
          ? index === start
          : upper === "FORM"
            ? next?.kind === "word" &&
              nextUpper !== "FROM" &&
              previousUpper !== "FROM" &&
              previousUpper !== "SELECT"
            : upper === "WHER" || upper === "WEHERE"
              ? Boolean(previous && next)
              : false;

      if (!shouldReport) continue;

      pushDiagnostic(diagnostics, {
        from: token.from,
        to: token.to,
        severity: "error",
        message: `Possible typo: did you mean '${corrected}'?`,
        source: "syntax",
      });
    }
  }

  return diagnostics;
}

function buildInvalidStarDiagnostics(
  sql: string,
  tokens: SqlToken[],
): FastLintDiagnostic[] {
  const diagnostics: FastLintDiagnostic[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (!token || token.text !== "*" || !next || next.kind !== "word") continue;
    if (next.from !== token.to) continue;

    const previousChar = sql[token.from - 1];
    if (previousChar === "." || /[A-Za-z0-9_)]/.test(previousChar ?? "")) {
      continue;
    }

    pushDiagnostic(diagnostics, {
      from: token.from,
      to: next.to,
      severity: "error",
      message:
        "Invalid use of '*'. Did you mean to separate this from the identifier?",
      source: "syntax",
    });
  }

  return diagnostics;
}

function buildSelectStarDiagnostics(tokens: SqlToken[]): FastLintDiagnostic[] {
  const diagnostics: FastLintDiagnostic[] = [];

  for (const { start, end } of statementRanges(tokens)) {
    const first = firstWordToken(tokens, start, end);
    if (!first || first.token.text.toUpperCase() !== "SELECT") continue;

    let depth = 0;
    for (let index = first.index + 1; index < end; index += 1) {
      const token = tokens[index];
      if (!token) continue;

      if (token.text === "(") {
        depth += 1;
        continue;
      }
      if (token.text === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth === 0 && token.kind === "word" && token.text.toUpperCase() === "FROM") {
        break;
      }

      if (depth === 0 && token.text === "*") {
        pushDiagnostic(diagnostics, {
          from: token.from,
          to: token.to,
          severity: "info",
          message: "Consider specifying columns instead of SELECT *",
          source: "validation",
        });
        break;
      }
    }
  }

  return diagnostics;
}

function buildMissingWhereDiagnostics(
  tokens: SqlToken[],
): FastLintDiagnostic[] {
  const diagnostics: FastLintDiagnostic[] = [];

  for (const { start, end } of statementRanges(tokens)) {
    const first = firstWordToken(tokens, start, end);
    if (!first) continue;

    const statementType = first.token.text.toUpperCase();
    if (statementType !== "UPDATE" && statementType !== "DELETE") continue;

    let hasWhere = false;
    let depth = 0;
    for (let index = first.index + 1; index < end; index += 1) {
      const token = tokens[index];
      if (!token) continue;
      if (token.text === "(") {
        depth += 1;
        continue;
      }
      if (token.text === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && token.kind === "word" && token.text.toUpperCase() === "WHERE") {
        hasWhere = true;
        break;
      }
    }

    if (hasWhere) continue;

    const last = tokens[end - 1];
    pushDiagnostic(diagnostics, {
      from: first.token.from,
      to: last?.to ?? first.token.to,
      severity: "warning",
      message: `${statementType} without WHERE clause will affect all rows`,
      source: "validation",
    });
  }

  return diagnostics;
}

function buildFastDiagnostics(sql: string, tokens: SqlToken[]): FastLintDiagnostic[] {
  return [
    ...buildKeywordTypoDiagnostics(tokens),
    ...buildInvalidStarDiagnostics(sql, tokens),
    ...buildMissingWhereDiagnostics(tokens),
    ...buildSelectStarDiagnostics(tokens),
  ];
}

function replaceExplainAnalyse(sql: string, tokens: SqlToken[]): string {
  const replacements: Array<{ from: number; to: number; text: string }> = [];

  for (const { start, end } of statementRanges(tokens)) {
    const first = firstWordToken(tokens, start, end);
    if (!first || first.token.text.toUpperCase() !== "EXPLAIN") continue;

    let index = first.index + 1;
    const firstAfterExplain = tokens[index];
    if (!firstAfterExplain) continue;

    // EXPLAIN (ANALYSE, FORMAT TEXT) ...
    if (firstAfterExplain.text === "(") {
      let optionDepth = 1;
      index += 1;

      while (index < end && optionDepth > 0) {
        const token = tokens[index];
        if (!token) {
          index += 1;
          continue;
        }

        if (token.text === "(") {
          optionDepth += 1;
          index += 1;
          continue;
        }
        if (token.text === ")") {
          optionDepth -= 1;
          index += 1;
          continue;
        }

        if (
          optionDepth === 1 &&
          token.kind === "word" &&
          token.text.toUpperCase() === "ANALYSE"
        ) {
          replacements.push({
            from: token.from,
            to: token.to,
            text: "ANALYZE",
          });
        }

        index += 1;
      }
      continue;
    }

    // EXPLAIN ANALYSE VERBOSE ... <statement>
    while (index < end) {
      const token = tokens[index];
      if (!token) {
        index += 1;
        continue;
      }

      if (token.text === ",") {
        index += 1;
        continue;
      }

      if (token.kind !== "word") {
        break;
      }

      const upper = token.text.toUpperCase();
      if (!EXPLAIN_BARE_OPTION_KEYWORDS.has(upper)) {
        break;
      }

      if (upper === "ANALYSE") {
        replacements.push({
          from: token.from,
          to: token.to,
          text: "ANALYZE",
        });
      }

      index += 1;

      // FORMAT may be followed by TEXT/XML/JSON/YAML in legacy option syntax.
      if (upper === "FORMAT") {
        const formatValue = tokens[index];
        if (
          formatValue &&
          formatValue.kind === "word" &&
          EXPLAIN_FORMAT_VALUES.has(formatValue.text.toUpperCase())
        ) {
          index += 1;
        }
      }
    }
  }

  if (replacements.length === 0) {
    return sql;
  }

  let output = "";
  let cursor = 0;
  for (const replacement of replacements.sort((a, b) => a.from - b.from)) {
    output += sql.slice(cursor, replacement.from);
    output += replacement.text;
    cursor = replacement.to;
  }
  output += sql.slice(cursor);
  return output;
}

function preparePostgreSql(sql: string, tokens: SqlToken[]): PreparedSql {
  const canonicalSql = replaceExplainAnalyse(sql, tokens);
  return {
    canonicalSql,
    offsetMap: buildIdentityOffsetMap(canonicalSql.length),
    fastDiagnostics: buildFastDiagnostics(sql, tokens),
    canRunSemantic: true,
  };
}

export function mapPreparedOffset(offsetMap: number[], offset: number): number {
  const safeOffset = Math.max(0, Math.min(offset, offsetMap.length - 1));
  return offsetMap[safeOffset] ?? safeOffset;
}

export function prepareSqlForLint(
  sql: string,
  dialect: SqlDialect,
): PreparedSql {
  const cacheKey = `${dialect}:${sql}`;
  const cached = PREPARED_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const neutralized = neutralizeVariables(sql);
  const tokens = tokenizeSql(neutralized);
  const prepared =
    dialect === "postgresql" ? preparePostgreSql(neutralized, tokens) : {
      canonicalSql: neutralized,
      offsetMap: buildIdentityOffsetMap(neutralized.length),
      fastDiagnostics: buildFastDiagnostics(neutralized, tokens),
      canRunSemantic: true,
    };

  PREPARED_CACHE.set(cacheKey, prepared);
  if (PREPARED_CACHE.size > MAX_CACHE_ENTRIES) {
    const oldest = PREPARED_CACHE.keys().next().value;
    if (oldest) {
      PREPARED_CACHE.delete(oldest);
    }
  }

  return prepared;
}
