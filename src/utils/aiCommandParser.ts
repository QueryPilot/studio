/**
 * AI Command Parser
 *
 * Parses <command> blocks from AI agent responses.
 * Supports progressive parsing during streaming.
 */

import { COMMAND_META, type AiCommandName, type ParsedCommand } from "@/types/aiCommands";

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

const COMMAND_REGEX = /<command\s+name="([^"]+)">([\s\S]*?)<\/command>/g;
const PARTIAL_COMMAND_REGEX = /<command\s+name="[^"]*">[^<]*$/;

/**
 * Parse complete commands from text.
 */
export function parseCommands(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  COMMAND_REGEX.lastIndex = 0;

  while ((match = COMMAND_REGEX.exec(text)) !== null) {
    const [raw, name, content] = match;
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    // name should always be present due to regex structure, but handle defensively
    const commandName = name ?? "";

    const command: ParsedCommand = {
      id: generateCommandId(commandName, content ?? "", startIndex),
      name: commandName as AiCommandName,
      params: {},
      raw,
      startIndex,
      endIndex,
    };

    // Validate command name is in registry
    if (!commandName || !VALID_COMMAND_NAMES.has(commandName)) {
      command.error = `Unknown command: ${commandName}`;
    } else {
      try {
        const trimmedContent = content?.trim() ?? "";
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

  // Check if there's an incomplete command at the end
  // (opening tag started but no closing tag yet)
  const lastCompleteEnd =
    complete.length > 0 ? Math.max(...complete.map((c) => c.endIndex)) : 0;

  const remaining = text.slice(lastCompleteEnd);
  const hasIncomplete = PARTIAL_COMMAND_REGEX.test(remaining);

  let incompleteStart: number | undefined;
  if (hasIncomplete) {
    const match = remaining.match(/<command\s+name="[^"]*">/);
    if (match && match.index !== undefined) {
      incompleteStart = lastCompleteEnd + match.index;
    }
  }

  return {
    complete,
    incomplete: hasIncomplete,
    incompleteStart,
  };
}

/**
 * Remove command blocks from text.
 */
export function stripCommands(text: string): string {
  return text.replace(COMMAND_REGEX, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Check if text contains any commands.
 */
export function hasCommands(text: string): boolean {
  COMMAND_REGEX.lastIndex = 0;
  return COMMAND_REGEX.test(text);
}

/**
 * Check if text has an incomplete command being streamed.
 */
export function hasIncompleteCommand(text: string): boolean {
  return PARTIAL_COMMAND_REGEX.test(text);
}

/**
 * Get human-readable description for a command.
 */
export function getCommandDescription(command: ParsedCommand): string {
  switch (command.name) {
    case "sql.execute":
      return `Execute SQL query`;
    case "sql.explain":
      return `Explain query plan`;
    case "mongodb.find":
      return `Find documents in ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "mongodb.aggregate":
      return `Run aggregation on ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "mongodb.count":
      return `Count documents in ${(command.params as { collection?: string }).collection ?? "collection"}`;
    case "redis.get":
      return `Get key: ${(command.params as { key?: string }).key ?? "key"}`;
    case "redis.keys":
      return `List keys: ${(command.params as { pattern?: string }).pattern ?? "*"}`;
    case "redis.scan":
      return `Scan keys`;
    case "crud.stage":
      return `Stage ${(command.params as { operation?: string }).operation ?? "change"}`;
    case "tab.update":
      return `Update tab content`;
    case "tab.create":
      return `Create new tab`;
    case "editor.insert":
      return `Insert at cursor`;
    default:
      return `Unknown command: ${command.name}`;
  }
}

/**
 * Validate command parameters.
 */
export function validateCommand(command: ParsedCommand): string | null {
  // Check if command name is valid
  if (!VALID_COMMAND_NAMES.has(command.name)) {
    return `Unknown command: ${command.name}`;
  }

  const params = command.params as Record<string, unknown>;

  // Only tab.update and editor.insert don't need connectionId
  const noConnectionNeeded = ["tab.update", "editor.insert"];
  if (!noConnectionNeeded.includes(command.name) && !params.connectionId) {
    return "Missing required parameter: connectionId";
  }

  switch (command.name) {
    case "sql.execute":
    case "sql.explain":
      if (!params.sql) return "Missing required parameter: sql";
      break;
    case "mongodb.find":
    case "mongodb.aggregate":
    case "mongodb.count":
      if (!params.collection) return "Missing required parameter: collection";
      break;
    case "redis.get":
      if (!params.key) return "Missing required parameter: key";
      break;
    case "crud.stage":
      if (!params.operation) return "Missing required parameter: operation";
      break;
    case "editor.insert":
      if (!params.text) return "Missing required parameter: text";
      break;
  }

  return null;
}
