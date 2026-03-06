/**
 * AI Action Parser
 *
 * Parses fenced `qp-action` JSON blocks from assistant responses.
 * Supports progressive parsing while streaming.
 */

import {
  COMMAND_META,
  type AiCommandName,
  type CommandApprovalLevel,
  type ParsedCommand,
} from "@/types/aiCommands";

function generateCommandId(name: string, content: string, startIndex: number): string {
  const str = `${name}:${startIndex}:${content.slice(0, 120)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return `act-${Math.abs(hash).toString(36)}`;
}

const VALID_COMMAND_NAMES = new Set(Object.keys(COMMAND_META));

const ACTION_FENCE_REGEX = /```qp-action([^\n]*)\n([\s\S]*?)```/gi;
const ACTION_OPENING_REGEX = /```qp-action\b[^\n]*\n?/gi;
const STRICT_OPENING_REGEX = /^```qp-action\s*$/;
const GENERIC_FENCE_REGEX = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;

interface Range {
  start: number;
  end: number;
}

interface CommandMatch {
  raw: string;
  payload: string;
  startIndex: number;
  endIndex: number;
  confidence: "high" | "low";
}

interface ParsedActionPayload {
  id?: unknown;
  name?: unknown;
  params?: unknown;
  approval?: unknown;
  [key: string]: unknown;
}

const REQUIRED_ACTION_FIELDS = ["id", "name", "params", "approval"] as const;
const ALLOWED_ACTION_FIELDS = new Set<string>(REQUIRED_ACTION_FIELDS);
const VALID_APPROVALS = new Set<CommandApprovalLevel>([
  "auto",
  "approve",
  "dangerous",
]);

function collectProtectedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  GENERIC_FENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = GENERIC_FENCE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const fence = raw.startsWith("```") ? "```" : "~~~";

    // Do not protect qp-action blocks; those are what we parse.
    const firstLine = raw.split("\n", 1)[0] ?? "";
    if (new RegExp(`^${fence}\\s*qp-action\\b`, "i").test(firstLine)) {
      continue;
    }

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

function parseActionMatches(text: string): CommandMatch[] {
  const matches: CommandMatch[] = [];
  const protectedRanges = collectProtectedRanges(text);

  ACTION_FENCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ACTION_FENCE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const payload = match[2] ?? "";
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    if (isIndexInRanges(startIndex, protectedRanges)) {
      continue;
    }

    const openingLine = raw.split("\n", 1)[0] ?? "";
    const confidence: "high" | "low" = STRICT_OPENING_REGEX.test(openingLine)
      ? "high"
      : "low";

    matches.push({
      raw,
      payload,
      startIndex,
      endIndex,
      confidence,
    });
  }

  return matches;
}

function parsePayload(payload: string): unknown {
  return JSON.parse(payload);
}

function inferActionName(rawPayload: string): string | undefined {
  const nameMatch = rawPayload.match(/"name"\s*:\s*"([^"]+)"/);
  return nameMatch?.[1];
}

export function parseCommands(text: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  const matches = parseActionMatches(text);

  for (const match of matches) {
    let parsed: ParsedActionPayload | null = null;
    let commandName = "workspace.listTabs";
    let approval: CommandApprovalLevel | undefined;
    const errors: string[] = [];

    try {
      const payload = parsePayload(match.payload.trim());
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        errors.push("Invalid payload: expected JSON object");
      } else {
        parsed = payload as ParsedActionPayload;
      }

      if (parsed && typeof parsed.name === "string" && parsed.name.length > 0) {
        commandName = parsed.name;
      }

      if (parsed) {
        const keys = Object.keys(parsed);
        const unknownKeys = keys.filter((key) => !ALLOWED_ACTION_FIELDS.has(key));
        if (unknownKeys.length > 0) {
          const noun = unknownKeys.length > 1 ? "fields" : "field";
          errors.push(`Unknown ${noun}: ${unknownKeys.join(", ")}`);
        }

        for (const field of REQUIRED_ACTION_FIELDS) {
          if (!(field in parsed)) {
            errors.push(`Missing required field: ${field}`);
          }
        }

        if (parsed.id !== undefined && (typeof parsed.id !== "string" || parsed.id.trim().length === 0)) {
          errors.push("Invalid id: expected non-empty string");
        }

        if (parsed.name !== undefined && (typeof parsed.name !== "string" || parsed.name.trim().length === 0)) {
          errors.push("Invalid name: expected non-empty string");
        }

        if (
          parsed.params !== undefined &&
          (parsed.params === null ||
            typeof parsed.params !== "object" ||
            Array.isArray(parsed.params))
        ) {
          errors.push("Invalid params: expected object");
        }

        if (typeof parsed.approval === "string") {
          if (VALID_APPROVALS.has(parsed.approval as CommandApprovalLevel)) {
            approval = parsed.approval as CommandApprovalLevel;
          } else {
            errors.push(
              "Invalid approval: expected one of auto, approve, dangerous",
            );
          }
        } else if ("approval" in parsed) {
          errors.push("Invalid approval: expected string");
        }
      }
    } catch {
      const inferred = inferActionName(match.payload);
      if (inferred) {
        commandName = inferred;
      }
      errors.push("Invalid JSON payload in qp-action block");
    }

    const actionId =
      parsed && typeof parsed.id === "string" && parsed.id.trim().length > 0
        ? parsed.id
        : generateCommandId(commandName, match.payload, match.startIndex);

    const command: ParsedCommand = {
      id: actionId,
      name: commandName as AiCommandName,
      params:
        parsed &&
        parsed.params !== null &&
        typeof parsed.params === "object" &&
        !Array.isArray(parsed.params)
          ? (parsed.params as Record<string, unknown>)
          : {},
      approval,
      raw: match.raw,
      startIndex: match.startIndex,
      endIndex: match.endIndex,
      confidence: match.confidence,
    };

    if (!VALID_COMMAND_NAMES.has(commandName)) {
      errors.push(`Unknown command: ${commandName}`);
    }

    if (VALID_COMMAND_NAMES.has(commandName) && approval) {
      const expected = COMMAND_META[commandName as AiCommandName].approvalLevel;
      if (approval !== expected) {
        errors.push(
          `Approval mismatch: ${commandName} requires "${expected}" (got "${approval}")`,
        );
      }
    }

    if (errors.length > 0) {
      command.error = errors[0];
    }

    commands.push(command);
  }

  return commands;
}

export interface ProgressiveParseResult {
  complete: ParsedCommand[];
  incomplete: boolean;
  incompleteStart?: number;
}

export function parseCommandsProgressive(text: string): ProgressiveParseResult {
  const complete = parseCommands(text);
  const protectedRanges = collectProtectedRanges(text);
  const completeRanges = complete.map((c) => ({ start: c.startIndex, end: c.endIndex }));

  ACTION_OPENING_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let incompleteStart: number | undefined;

  while ((match = ACTION_OPENING_REGEX.exec(text)) !== null) {
    const start = match.index;
    if (isIndexInRanges(start, protectedRanges)) {
      continue;
    }

    const covered = completeRanges.some((range) => start >= range.start && start < range.end);
    if (!covered) {
      incompleteStart = start;
    }
  }

  return {
    complete,
    incomplete: incompleteStart !== undefined,
    incompleteStart,
  };
}

export function stripCommands(text: string): string {
  const matches = parseActionMatches(text);
  if (matches.length === 0) return text;

  let stripped = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!match) continue;
    stripped = stripped.slice(0, match.startIndex) + stripped.slice(match.endIndex);
  }

  return stripped.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function hasCommands(text: string): boolean {
  return parseActionMatches(text).length > 0;
}

export function hasIncompleteCommand(text: string): boolean {
  return parseCommandsProgressive(text).incomplete;
}

export function getCommandDescription(command: ParsedCommand): string {
  switch (command.name) {
    case "workspace.listTabs":
      return "List open tabs";
    case "workspace.getFocusedTab":
      return "Get focused tab context";
    case "workspace.getTabContext":
      return "Get tab context";
    case "tab.create":
      return "Create new query tab";
    case "tab.focus":
      return "Focus tab";
    case "tab.updateContent":
      return "Update tab content";
    case "editor.insert":
      return "Insert at cursor";
    case "query.run":
      return "Run query";
    case "grid.setFilter":
      return "Set grid filter";
    case "grid.setSort":
      return "Set grid sort";
    case "grid.setView":
      return "Set grid view";
    case "crud.stage":
      return `Stage ${(command.params as { operation?: string }).operation ?? "change"}`;
    case "crud.unstage":
      return "Unstage changes";
    default:
      return `Unknown command: ${command.name}`;
  }
}

export function validateCommand(command: ParsedCommand): string | null {
  if (!VALID_COMMAND_NAMES.has(command.name)) {
    return `Unknown command: ${command.name}`;
  }

  const params = command.params as Record<string, unknown>;

  const noConnectionNeeded = [
    "workspace.listTabs",
    "workspace.getFocusedTab",
    "workspace.getTabContext",
    "tab.updateContent",
    "tab.focus",
    "editor.insert",
    "grid.setFilter",
    "grid.setSort",
    "grid.setView",
    "crud.unstage",
  ];
  if (!noConnectionNeeded.includes(command.name) && !params.connectionId) {
    return "Missing required parameter: connectionId";
  }

  switch (command.name) {
    case "workspace.getTabContext":
      if (!params.tabId) return "Missing required parameter: tabId";
      break;
    case "crud.stage":
      if (!params.operation) return "Missing required parameter: operation";
      if (!params.table && !params.collection) {
        return "Missing required parameter: table or collection";
      }
      break;
    case "crud.unstage":
      if (!params.scope) return "Missing required parameter: scope";
      if (!["id", "table", "all"].includes(params.scope as string)) {
        return "Invalid scope: must be 'id', 'table', or 'all'";
      }
      if (params.scope === "id" && !params.commandId) {
        return "Missing required parameter: commandId (required when scope is 'id')";
      }
      if (params.scope === "table" && !params.table) {
        return "Missing required parameter: table (required when scope is 'table')";
      }
      break;
    case "query.run":
      if (!params.query) return "Missing required parameter: query";
      if (
        params.language &&
        (typeof params.language !== "string" ||
          !["sql", "mongo", "redis"].includes(params.language.toLowerCase()))
      ) {
        return "Invalid language: must be 'sql', 'mongo', or 'redis'";
      }
      break;
    case "tab.focus":
      if (!params.tabId) return "Missing required parameter: tabId";
      break;
    case "tab.updateContent":
      if (!params.content && !params.title) {
        return "Missing required parameter: content or title";
      }
      break;
    case "editor.insert":
      if (!params.text) return "Missing required parameter: text";
      break;
    case "grid.setFilter":
      if (!params.filter) return "Missing required parameter: filter";
      break;
    case "grid.setSort":
      if (!params.column) return "Missing required parameter: column";
      if (!params.direction) return "Missing required parameter: direction";
      if (
        typeof params.direction !== "string" ||
        !["asc", "desc"].includes(params.direction.toLowerCase())
      ) {
        return "Invalid direction: must be 'asc' or 'desc'";
      }
      break;
    case "grid.setView":
      if (!params.view) return "Missing required parameter: view";
      break;
  }

  return null;
}
