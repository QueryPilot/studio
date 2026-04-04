import type { ParsedVariable, VariableSyntax, VariableScope } from "./types";

interface ExclusionZone {
  start: number;
  end: number;
}

/**
 * Build exclusion zones for string literals, dollar-quoted bodies, and comments.
 * Variables inside these zones are ignored.
 */
function buildExclusionZones(sql: string): ExclusionZone[] {
  const zones: ExclusionZone[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'") {
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i++; break; }
        else i++;
      }
      zones.push({ start, end: i });
      continue;
    }

    if (ch === '"') {
      const start = i;
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      zones.push({ start, end: i });
      continue;
    }

    if (ch === "$") {
      const remainder = sql.slice(i);
      const tagMatch = remainder.match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const bodyStart = i;
        const endIndex = sql.indexOf(tag, i + tag.length);
        if (endIndex !== -1) {
          i = endIndex + tag.length;
          zones.push({ start: bodyStart, end: i });
          continue;
        }
      }
      i++;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const start = i;
      while (i < sql.length && sql[i] !== "\n") i++;
      zones.push({ start, end: i });
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      zones.push({ start, end: i });
      continue;
    }

    i++;
  }

  return zones;
}

function isInExclusionZone(offset: number, zones: ExclusionZone[]): boolean {
  for (const zone of zones) {
    if (offset >= zone.start && offset < zone.end) return true;
    if (zone.start > offset) break;
  }
  return false;
}

function offsetToStatementIndex(
  offset: number,
  statementOffsets: Array<{ from: number; to: number }>,
): number {
  for (let i = 0; i < statementOffsets.length; i++) {
    const range = statementOffsets[i];
    if (range && offset >= range.from && offset <= range.to) return i;
  }
  return 0;
}

function buildStatementRanges(sql: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let currentStart = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i++; break; }
        else i++;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      continue;
    }
    if (ch === "$") {
      const remainder = sql.slice(i);
      const tagMatch = remainder.match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIndex = sql.indexOf(tag, i + tag.length);
        if (endIndex !== -1) { i = endIndex + tag.length; continue; }
      }
      i++;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === ";") {
      ranges.push({ from: currentStart, to: i });
      currentStart = i + 1;
    }
    i++;
  }

  if (currentStart < sql.length) {
    const remaining = sql.slice(currentStart).trim();
    if (remaining) {
      ranges.push({ from: currentStart, to: sql.length });
    }
  }

  return ranges.length > 0 ? ranges : [{ from: 0, to: sql.length }];
}

function scanWithRegex(
  sql: string,
  pattern: RegExp,
  zones: ExclusionZone[],
  stmtRanges: Array<{ from: number; to: number }>,
  syntax: VariableSyntax,
  filter?: (match: RegExpMatchArray, index: number, sql: string) => boolean,
  nameExtractor?: (match: RegExpMatchArray) => string,
): ParsedVariable[] {
  const results: ParsedVariable[] = [];
  const globalPattern = new RegExp(pattern.source, "g");
  const allMatches = Array.from(sql.matchAll(globalPattern));
  for (const m of allMatches) {
    const idx = m.index;
    if (isInExclusionZone(idx, zones)) continue;
    if (filter && !filter(m, idx, sql)) continue;

    const name = nameExtractor ? nameExtractor(m) : (m[1] ?? "");
    results.push({
      name,
      syntax,
      statementIndex: offsetToStatementIndex(idx, stmtRanges),
      offset: idx,
      length: m[0].length,
    });
  }
  return results;
}

// ── Individual syntax extractors ──

function extractMustache(sql: string, zones: ExclusionZone[], stmtRanges: Array<{ from: number; to: number }>): ParsedVariable[] {
  return scanWithRegex(sql, /\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, zones, stmtRanges, "mustache");
}

function extractColon(sql: string, zones: ExclusionZone[], stmtRanges: Array<{ from: number; to: number }>): ParsedVariable[] {
  return scanWithRegex(
    sql,
    /:([a-zA-Z_]\w*)/g,
    zones,
    stmtRanges,
    "colon",
    (_m, idx, s) => {
      // Skip :: (PG type cast)
      if (idx > 0 && s[idx - 1] === ":") return false;
      // Skip := (PL/SQL assignment)
      const afterMatch = idx + _m[0].length;
      if (afterMatch < s.length && s[afterMatch] === "=") return false;
      return true;
    },
  );
}

function extractAt(sql: string, zones: ExclusionZone[], stmtRanges: Array<{ from: number; to: number }>): ParsedVariable[] {
  return scanWithRegex(
    sql,
    /@([a-zA-Z_]\w*)/g,
    zones,
    stmtRanges,
    "at",
    (_m, idx, s) => {
      // Skip @@ (system variables)
      if (idx > 0 && s[idx - 1] === "@") return false;
      if (idx + 1 < s.length && s[idx + 1] === "@") return false;
      return true;
    },
  );
}

function extractDollarBrace(sql: string, zones: ExclusionZone[], stmtRanges: Array<{ from: number; to: number }>): ParsedVariable[] {
  return scanWithRegex(sql, /\$\{([a-zA-Z_]\w*)\}/g, zones, stmtRanges, "dollar_brace");
}

function extractDollarNum(sql: string, zones: ExclusionZone[], stmtRanges: Array<{ from: number; to: number }>): ParsedVariable[] {
  return scanWithRegex(
    sql,
    /\$(\d+)/g,
    zones,
    stmtRanges,
    "dollar_num",
    (_m, idx, s) => {
      // Skip if preceded by { (that's ${var} syntax)
      if (idx > 0 && s[idx - 1] === "{") return false;
      // Skip if followed by $ (dollar-quote tag)
      const afterNum = idx + _m[0].length;
      if (afterNum < s.length && s[afterNum] === "$") return false;
      return true;
    },
    (m) => `$${m[1]}`,
  );
}

function extractQuestionMark(
  sql: string,
  zones: ExclusionZone[],
  stmtRanges: Array<{ from: number; to: number }>,
  scope: VariableScope,
): ParsedVariable[] {
  const results: ParsedVariable[] = [];
  const perStmtCounters = new Map<number, number>();
  let globalCounter = 0;

  for (const m of sql.matchAll(/\?/g)) {
    const idx = m.index;
    if (isInExclusionZone(idx, zones)) continue;

    // Skip PG JSON operators: ?| and ?&
    const after = idx + 1;
    if (after < sql.length && (sql[after] === "|" || sql[after] === "&")) continue;
    // Skip ?? (null coalescing in some contexts)
    if (idx > 0 && sql[idx - 1] === "?") continue;

    const stmtIdx = offsetToStatementIndex(idx, stmtRanges);

    let index: number;
    if (scope === "per_statement") {
      const current = perStmtCounters.get(stmtIdx) ?? 0;
      index = current + 1;
      perStmtCounters.set(stmtIdx, index);
    } else {
      globalCounter++;
      index = globalCounter;
    }

    results.push({
      name: `#${index}`,
      syntax: "question_mark",
      statementIndex: stmtIdx,
      offset: idx,
      length: 1,
    });
  }
  return results;
}

// ── Public API ──

export interface ParseVariablesOptions {
  scope?: VariableScope;
  syntaxes?: VariableSyntax[];
}

export interface ParseResult {
  variables: ParsedVariable[];
  uniqueNames: Set<string>;
  statementCount: number;
}

const ALL_SYNTAXES: VariableSyntax[] = [
  "mustache", "colon", "at", "dollar_brace", "dollar_num", "question_mark",
];

/**
 * Parse SQL and extract all variable placeholder occurrences.
 * Handles 6 syntaxes, skips exclusion zones, and tracks statement indices.
 */
export function parseVariables(sql: string, options: ParseVariablesOptions = {}): ParseResult {
  const scope = options.scope ?? "global";
  const syntaxes = options.syntaxes ?? ALL_SYNTAXES;

  if (!sql.trim()) {
    return { variables: [], uniqueNames: new Set(), statementCount: 1 };
  }

  const zones = buildExclusionZones(sql);
  const stmtRanges = buildStatementRanges(sql);
  const all: ParsedVariable[] = [];

  for (const syntax of syntaxes) {
    switch (syntax) {
      case "mustache":
        all.push(...extractMustache(sql, zones, stmtRanges));
        break;
      case "colon":
        all.push(...extractColon(sql, zones, stmtRanges));
        break;
      case "at":
        all.push(...extractAt(sql, zones, stmtRanges));
        break;
      case "dollar_brace":
        all.push(...extractDollarBrace(sql, zones, stmtRanges));
        break;
      case "dollar_num":
        all.push(...extractDollarNum(sql, zones, stmtRanges));
        break;
      case "question_mark":
        all.push(...extractQuestionMark(sql, zones, stmtRanges, scope));
        break;
    }
  }

  all.sort((a, b) => a.offset - b.offset);

  const uniqueNames = new Set<string>();
  for (const v of all) {
    const isPositional = v.syntax === "dollar_num" || v.syntax === "question_mark";
    if (isPositional && scope === "per_statement") {
      uniqueNames.add(`stmt:${v.statementIndex}:${v.name}`);
    } else {
      uniqueNames.add(v.name);
    }
  }

  return { variables: all, uniqueNames, statementCount: stmtRanges.length };
}

/**
 * Replace all variable placeholders with SQL-safe NULL literals.
 * Pads with spaces to preserve character offsets for diagnostic mapping.
 * Used to feed clean SQL to the Rust linter / outline parser.
 */
export function neutralizeVariables(sql: string): string {
  if (!sql.trim()) return sql;

  const { variables } = parseVariables(sql);
  if (variables.length === 0) return sql;

  const sorted = [...variables].sort((a, b) => b.offset - a.offset);
  let result = sql;

  for (const v of sorted) {
    const placeholder = "NULL" + " ".repeat(Math.max(0, v.length - 4));
    result = result.slice(0, v.offset) + placeholder + result.slice(v.offset + v.length);
  }

  return result;
}
