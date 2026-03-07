/**
 * Mention Parser
 *
 * Parses @ mentions from user input for AI context.
 * Supports: @table, @schema.table, @ConnName/schema.table, @"My DB"/schema.table, @tab:TabName
 */

import type { MentionReference } from "@/types/aiContext";

// Regex patterns for mention parsing
// Supports optional connection prefix: @ConnName/schema.table or @"Quoted Name"/schema.table
// Optional [id:xxx] suffix for connection ID
// Groups: (1) quoted connName, (2) unquoted connName, (3) first ident, (4) second ident, (5) connection ID
const OBJECT_MENTION_REGEX = /@(?:(?:"([^"]+)"|([a-zA-Z_]\w*))\/)?([a-zA-Z_]\w*)(?:\.([a-zA-Z_]\w*))?(?:\[id:([^\]]+)\])?/g;
// @tab:TabName (for tabs - allows spaces in name with quotes)
// Optional [id:xxx] suffix for tab disambiguation across panels
// Groups: (1) quoted name, (2) unquoted name (without [id:...]), (3) tab ID
const TAB_MENTION_REGEX = /@tab:(?:"([^"]+)"|([^\s\[]+))(?:\[id:([^\]]+)\])?/g;

/**
 * Parse all @ mentions from input text.
 * Returns array of mention references with positions.
 */
export function parseMentions(input: string): MentionReference[] {
  const mentions: MentionReference[] = [];

  // Parse tab mentions first (they have a specific format)
  let match: RegExpExecArray | null;
  const tabRegex = new RegExp(TAB_MENTION_REGEX.source, "g");

  while ((match = tabRegex.exec(input)) !== null) {
    const name = match[1] ?? match[2] ?? ""; // Quoted or unquoted name
    const tabId = match[3]; // from [id:xxx] suffix
    mentions.push({
      type: "tab",
      name,
      tabId,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Parse object mentions (tables, views, functions)
  const objectRegex = new RegExp(OBJECT_MENTION_REGEX.source, "g");

  while ((match = objectRegex.exec(input)) !== null) {
    // Skip if this position overlaps with a tab mention
    const matchIndex = match.index;
    const overlaps = mentions.some(
      (m) => matchIndex >= m.start && matchIndex < m.end
    );
    if (overlaps) continue;

    const quotedConn = match[1];    // "My DB" from @"My DB"/...
    const unquotedConn = match[2];  // DevDB from @DevDB/...
    const firstIdent = match[3] ?? "";
    const secondIdent = match[4];
    const connectionId = match[5];  // from [id:xxx] suffix

    const connectionName = quotedConn ?? unquotedConn ?? undefined;

    // If there's a second ident, first is schema, second is name
    // Otherwise, first is name (schema defaults to current)
    const schema = secondIdent ? firstIdent : undefined;
    const name = secondIdent ?? firstIdent;

    mentions.push({
      type: "table", // Will be resolved to actual type later
      name,
      schema,
      connectionId,
      connectionName,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Sort by position
  mentions.sort((a, b) => a.start - b.start);

  return mentions;
}

/**
 * Extract mention at cursor position (for autocomplete).
 * Returns partial mention being typed, or null if not in a mention.
 * Recognizes `/` as part of a mention prefix (e.g., @DevDB/pub).
 */
export function getMentionAtCursor(
  input: string,
  cursorPosition: number
): { prefix: string; start: number; type: "object" | "tab" } | null {
  // Look backwards from cursor to find @
  // Must be quote-aware: spaces inside "quoted names" are part of the mention
  let start = cursorPosition - 1;
  let insideQuotes = false;

  while (start >= 0) {
    const ch = input[start];
    if (ch === '"') {
      insideQuotes = !insideQuotes;
      start--;
      continue;
    }
    if (ch === "@") break;
    // Spaces and newlines break the mention — unless inside quotes
    if (!insideQuotes && (ch === " " || ch === "\n")) break;
    start--;
  }

  if (start < 0 || input[start] !== "@") {
    return null;
  }

  const prefix = input.slice(start + 1, cursorPosition);

  // Check if it's a tab mention
  if (prefix.startsWith("tab:")) {
    return {
      prefix: prefix.slice(4), // Remove "tab:" prefix
      start,
      type: "tab",
    };
  }

  return {
    prefix,
    start,
    type: "object",
  };
}

/**
 * Replace a mention in the input with the full reference.
 * Used when user selects from autocomplete.
 */
export function replaceMention(
  input: string,
  start: number,
  end: number,
  replacement: string
): string {
  return input.slice(0, start) + replacement + input.slice(end);
}

/**
 * Format a mention for display/insertion.
 * When connectionName is provided, outputs connection-qualified format: @ConnName/schema.table
 */
export function formatMention(
  type: "table" | "view" | "function" | "tab",
  name: string,
  schema?: string,
  connectionName?: string,
): string {
  if (type === "tab") {
    // Use quotes if name contains spaces
    return name.includes(" ") ? `@tab:"${name}"` : `@tab:${name}`;
  }

  const base = schema ? `${schema}.${name}` : name;
  if (!connectionName) return `@${base}`;

  // Quote connection name if it contains spaces or special chars
  const safeConn = /^[a-zA-Z_]\w*$/.test(connectionName)
    ? connectionName
    : `"${connectionName}"`;
  return `@${safeConn}/${base}`;
}

/**
 * Remove all mentions from input, returning clean text.
 * Useful for sending to AI without the @ syntax.
 */
export function stripMentions(input: string): string {
  return input
    .replace(TAB_MENTION_REGEX, (_match, quoted, unquoted) => quoted ?? unquoted ?? "")
    .replace(OBJECT_MENTION_REGEX, (_match, _quotedConn, _unquotedConn, first, second) => second ?? first ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip [id:xxx] suffixes from mention text for display purposes.
 * The IDs are embedded for AI resolution but should not be shown to users.
 */
export function stripMentionIds(input: string): string {
  return input.replace(/\[id:[^\]]+\]/g, "");
}

/**
 * Check if input contains any mentions.
 */
export function hasMentions(input: string): boolean {
  // Use fresh regex instances to avoid g-flag statefulness (lastIndex advancing)
  return new RegExp(OBJECT_MENTION_REGEX.source).test(input) ||
    new RegExp(TAB_MENTION_REGEX.source).test(input);
}
