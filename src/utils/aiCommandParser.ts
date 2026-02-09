/**
 * AI Command Parser
 *
 * Parses <command> blocks from AI agent responses.
 * Supports progressive parsing during streaming.
 */

import {
  COMMAND_META,
  type AiCommandName,
  type ParsedCommand,
} from "@/types/aiCommands";

/**
 * Generate a deterministic ID for a command based on its content and position.
 * This ensures the same command gets the same ID across re-parses during streaming.
 */
function generateCommandId(name: string, content: string, startIndex: number): string {
  // Simple hash based on command name, content, and position
  const str = `${name}:${startIndex}:${content.slice(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `cmd-${Math.abs(hash).toString(36)}`;
}

/**
 * Valid command names from the COMMAND_META registry.
 */
const VALID_COMMAND_NAMES = new Set(Object.keys(COMMAND_META));

// ============================================================================
// Parser
// ============================================================================

const COMMAND_REGEX =
  /<command\b[^>]*\bname\s*=\s*(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/command>/gi;
const OPENING_TAG_REGEX =
  /<command\b[^>]*\bname\s*=\s*(['"])([^'"]+)\1[^>]*>/gi;
const STRICT_OPENING_TAG_REGEX = /^<command name="[^"]+">$/;
const FENCED_CODE_BLOCK_REGEX = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

interface Range {
  start: number;
  end: number;
}

interface CommandMatch {
  raw: string;
  name: string;
  content: string;
  startIndex: number;
  endIndex: number;
  confidence: "high" | "low";
}

function collectProtectedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  FENCED_CODE_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCED_CODE_BLOCK_REGEX.exec(text)) !== null) {
    const raw = match[0];
    ranges.push({
      start: match.index,
      end: match.index + raw.length,
    });
  }

  return ranges;
}

function isIndexInRanges(index: number, ranges: Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function parseCommandMatches(text: string): CommandMatch[] {
  const matches: CommandMatch[] = [];
  const protectedRanges = collectProtectedRanges(text);

  COMMAND_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMMAND_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const name = match[2];
    const content = match[3];
    if (name === undefined || content === undefined) {
      continue;
    }
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    if (isIndexInRanges(startIndex, protectedRanges)) {
      continue;
    }

    const openingTagEnd = raw.indexOf(">");
    const openingTag = openingTagEnd >= 0 ? raw.slice(0, openingTagEnd + 1) : "";
    const confidence: "high" | "low" = STRICT_OPENING_TAG_REGEX.test(openingTag)
      ? "high"
      : "low";

    matches.push({
      raw,
      name,
      content,
      startIndex,
      endIndex,
      confidence,
    });
  }

  return matches;
}

/**
 * Parse complete commands from text.
 */
export function parseCommands(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  const matches = parseCommandMatches(text);

  for (const match of matches) {
    const commandName = match.name;

    const command: ParsedCommand = {
      id: generateCommandId(commandName, match.content, match.startIndex),
      name: commandName as AiCommandName,
      params: {},
      raw: match.raw,
      startIndex: match.startIndex,
      endIndex: match.endIndex,
      confidence: match.confidence,
    };

    // Validate command name is in registry
    if (!commandName || !VALID_COMMAND_NAMES.has(commandName)) {
      command.error = `Unknown command: ${commandName}`;
    } else {
      try {
        const trimmedContent = match.content.trim();
        command.params = trimmedContent ? JSON.parse(trimmedContent) : {};
      } catch (e) {
        command.error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    commands.push(command);
  }

  return commands;
}

/**
 * Progressive parsing result
 */
export interface ProgressiveParseResult {
  complete: ParsedCommand[];
  incomplete: boolean;
  incompleteStart?: number;
}

/**
 * Parse commands progressively during streaming.
 * Returns complete commands and whether there's an incomplete one being typed.
 */
export function parseCommandsProgressive(text: string): ProgressiveParseResult {
  const complete = parseCommands(text);
  const protectedRanges = collectProtectedRanges(text);
  const completeRanges = complete.map((c) => ({ start: c.startIndex, end: c.endIndex }));

  OPENING_TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let incompleteStart: number | undefined;
  while ((match = OPENING_TAG_REGEX.exec(text)) !== null) {
    const start = match.index;
    if (isIndexInRanges(start, protectedRanges)) {
      continue;
    }
    const coveredByComplete = completeRanges.some(
      (range) => start >= range.start && start < range.end
    );
    if (!coveredByComplete) {
      incompleteStart = start;
    }
  }

  return {
    complete,
    incomplete: incompleteStart !== undefined,
    incompleteStart,
  };
}

/**
 * Remove command blocks from text.
 */
export function stripCommands(text: string): string {
  const matches = parseCommandMatches(text);
  if (matches.length === 0) return text;

  let stripped = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!match) continue;
    stripped =
      stripped.slice(0, match.startIndex) + stripped.slice(match.endIndex);
  }

  return stripped.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Check if text contains any commands.
 */
export function hasCommands(text: string): boolean {
  return parseCommandMatches(text).length > 0;
}

/**
 * Check if text has an incomplete command being streamed.
 */
export function hasIncompleteCommand(text: string): boolean {
  return parseCommandsProgressive(text).incomplete;
}

/**
 * Get human-readable description for a command.
 *
 * Note: Read command cases have been removed - AI uses MCP tools for database reads.
 */
export function getCommandDescription(command: ParsedCommand): string {
  switch (command.name) {
    case "crud.stage":
      return `Stage ${(command.params as { operation?: string }).operation ?? "change"}`;
    case "crud.unstage":
      return "Unstage Changes";
    case "query.run":
      return "Run Query";
    case "tab.update":
      return "Update tab content";
    case "tab.create":
      return "Create new tab";
    case "tab.focus":
      return "Focus Tab";
    case "editor.insert":
      return "Insert at cursor";
    default:
      return `Unknown command: ${command.name}`;
  }
}

/**
 * Validate command parameters.
 *
 * Note: Read command validation removed - AI uses MCP tools for database reads.
 */
export function validateCommand(command: ParsedCommand): string | null {
  // Check if command name is valid
  if (!VALID_COMMAND_NAMES.has(command.name)) {
    return `Unknown command: ${command.name}`;
  }

  const params = command.params as Record<string, unknown>;

  // Commands that don't require connectionId
  const noConnectionNeeded = ["tab.update", "tab.focus", "editor.insert", "crud.unstage"];
  if (!noConnectionNeeded.includes(command.name) && !params.connectionId) {
    return "Missing required parameter: connectionId";
  }

  switch (command.name) {
    case "crud.stage":
      if (!params.operation) return "Missing required parameter: operation";
      if (!params.table && !params.collection) return "Missing required parameter: table or collection";
      break;
    case "crud.unstage":
      if (!params.scope) return "Missing required parameter: scope";
      // Validate scope value
      if (!["id", "table", "all"].includes(params.scope as string)) {
        return "Invalid scope: must be 'id', 'table', or 'all'";
      }
      // commandId required when scope is "id"
      if (params.scope === "id" && !params.commandId) {
        return "Missing required parameter: commandId (required when scope is 'id')";
      }
      // table required when scope is "table"
      if (params.scope === "table" && !params.table) {
        return "Missing required parameter: table (required when scope is 'table')";
      }
      break;
    case "query.run":
      if (!params.query) return "Missing required parameter: query";
      break;
    case "tab.focus":
      if (!params.tabId) return "Missing required parameter: tabId";
      break;
    case "editor.insert":
      if (!params.text) return "Missing required parameter: text";
      break;
  }

  return null;
}
