/**
 * Mention Parser
 *
 * Parses @ mentions from user input for AI context.
 * Supports: @table, @schema.table, @tab:TabName
 */

import type { MentionReference } from "@/types/aiContext";

// Regex patterns for mention parsing
// @table or @schema.table (for tables, views, functions)
const OBJECT_MENTION_REGEX = /@([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g;
// @tab:TabName (for tabs - allows spaces in name with quotes)
const TAB_MENTION_REGEX = /@tab:(?:"([^"]+)"|([^\s]+))/g;

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
    mentions.push({
      type: "tab",
      name,
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

    const firstPart = match[1] ?? "";
    const secondPart = match[2];

    // If there's a second part, first is schema, second is name
    // Otherwise, first is name (schema defaults to current)
    const schema = secondPart ? firstPart : undefined;
    const name = secondPart ?? firstPart;

    mentions.push({
      type: "table", // Will be resolved to actual type later
      name,
      schema,
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
 */
export function getMentionAtCursor(
  input: string,
  cursorPosition: number
): { prefix: string; start: number; type: "object" | "tab" } | null {
  // Look backwards from cursor to find @
  let start = cursorPosition - 1;
  while (start >= 0 && input[start] !== "@" && input[start] !== " " && input[start] !== "\n") {
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
 */
export function formatMention(
  type: "table" | "view" | "function" | "tab",
  name: string,
  schema?: string
): string {
  if (type === "tab") {
    // Use quotes if name contains spaces
    return name.includes(" ") ? `@tab:"${name}"` : `@tab:${name}`;
  }

  // For objects, include schema if provided
  return schema ? `@${schema}.${name}` : `@${name}`;
}

/**
 * Remove all mentions from input, returning clean text.
 * Useful for sending to AI without the @ syntax.
 */
export function stripMentions(input: string): string {
  return input
    .replace(TAB_MENTION_REGEX, (_match, quoted, unquoted) => quoted ?? unquoted ?? "")
    .replace(OBJECT_MENTION_REGEX, (_match, first, second) => second ?? first ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if input contains any mentions.
 */
export function hasMentions(input: string): boolean {
  return OBJECT_MENTION_REGEX.test(input) || TAB_MENTION_REGEX.test(input);
}
