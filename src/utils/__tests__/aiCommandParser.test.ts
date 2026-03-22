/**
 * AI Command Parser Tests
 *
 * Tests for parsing `qp-action` fenced command blocks.
 */

import { describe, it, expect } from "vitest";
import {
  parseCommands,
  parseCommandsProgressive,
  stripCommands,
  hasCommands,
  getCommandDescription,
  validateCommand,
} from "../aiCommandParser";
import type { AiCommandName } from "@/types/aiCommands";

function qpAction(payload: string): string {
  return `\`\`\`qp-action\n${payload}\n\`\`\``;
}

describe("parseCommands", () => {
  it("returns empty array for text without commands", () => {
    const text = "Here is some SQL:\n```sql\nSELECT * FROM users\n```";
    expect(parseCommands(text)).toEqual([]);
  });

  it("parses valid qp-action command", () => {
    const text = `Let me stage that change.\n\n${qpAction(`{
  "id": "act-1",
  "name": "crud.stage",
  "params": {
    "connectionId": "conn-123",
    "table": "users",
    "operation": "insert",
    "document": { "name": "Alice" }
  },
  "approval": "auto"
}`)}`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);

    const first = commands[0];
    expect(first?.id).toBe("act-1");
    expect(first?.name).toBe("crud.stage");
    expect((first?.params as { connectionId: string }).connectionId).toBe("conn-123");
  });

  it("marks block as invalid when required approval is missing", () => {
    const text = qpAction(`{
  "id": "act-no-approval",
  "name": "tab.updateContent",
  "params": { "content": "SELECT 1" }
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toContain("Missing required field: approval");
  });

  it("marks block as invalid when approval value is not allowed", () => {
    const text = qpAction(`{
  "id": "act-bad-approval",
  "name": "tab.updateContent",
  "params": { "content": "SELECT 1" },
  "approval": "always"
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toContain("Invalid approval");
  });

  it("marks block as invalid when approval mismatches command policy", () => {
    const text = qpAction(`{
  "id": "act-mismatch",
  "name": "crud.stage",
  "params": {
    "connectionId": "conn-1",
    "table": "users",
    "operation": "insert",
    "document": { "name": "Alice" }
  },
  "approval": "dangerous"
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toContain("Approval mismatch");
  });

  it("marks block as invalid when unknown top-level fields are present", () => {
    const text = qpAction(`{
  "id": "act-extra",
  "name": "workspace.listTabs",
  "params": {},
  "approval": "auto",
  "unexpected": true
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toContain("Unknown field");
  });

  it("parses tab.updateContent command", () => {
    const text = qpAction(`{
  "id": "act-2",
  "name": "tab.updateContent",
  "params": {
    "content": "SELECT * FROM users",
    "title": "User Query"
  },
  "approval": "auto"
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("tab.updateContent");
  });

  it("parses editor.insert command", () => {
    const text = qpAction(`{
  "id": "act-3",
  "name": "editor.insert",
  "params": { "text": "-- Comment", "position": "cursor" },
  "approval": "auto"
}`);

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe("editor.insert");
  });

  it("parses multiple commands", () => {
    const text = `First:\n${qpAction(`{
  "id": "a1",
  "name": "tab.updateContent",
  "params": {"content": "SELECT 1"},
  "approval": "auto"
}`)}\n\nSecond:\n${qpAction(`{
  "id": "a2",
  "name": "editor.insert",
  "params": {"text": "-- test"},
  "approval": "auto"
}`)}`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.name).toBe("tab.updateContent");
    expect(commands[1]?.name).toBe("editor.insert");
  });

  it("handles malformed JSON gracefully", () => {
    const text = qpAction(`{"id":"bad-1","name":"crud.stage","params":{ invalid }`);
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toBeDefined();
  });

  it("extracts command position in text", () => {
    const text = `Before\n${qpAction(`{"id":"a","name":"tab.updateContent","params":{},"approval":"auto"}`)}\nAfter`;
    const commands = parseCommands(text);
    expect(commands[0]?.startIndex).toBe(7);
  });

  it("marks unknown commands as errors", () => {
    const text = qpAction(`{"id":"x","name":"sql.execute","params":{},"approval":"auto"}`);
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.error).toContain("Unknown command");
  });

  it("ignores qp-action examples inside non-qp code fences", () => {
    const text = `Here is an example only:\n\n\`\`\`md\n${qpAction(`{"id":"x","name":"tab.updateContent","params":{"content":"SELECT 1"},"approval":"auto"}`)}\n\`\`\``;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(0);
  });

  it("parses non-canonical opening line with low confidence", () => {
    const text = "```qp-action json\n" +
      "{\"id\":\"a\",\"name\":\"tab.updateContent\",\"params\":{\"content\":\"SELECT 1\"},\"approval\":\"auto\"}\n" +
      "```";

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.confidence).toBe("low");
  });
});

describe("parseCommandsProgressive", () => {
  it("returns incomplete for partial qp-action block", () => {
    const text = "Here is a command:\n```qp-action\n{\"id\":\"x\",\"name\":\"crud.stage\",\"params\":";
    const result = parseCommandsProgressive(text);
    expect(result.complete).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("returns complete when qp-action block is finished", () => {
    const text = qpAction(`{"id":"a","name":"tab.updateContent","params":{"content":"SELECT 1"},"approval":"auto"}`);
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(false);
  });

  it("handles mix of complete and streaming", () => {
    const text = `${qpAction(`{"id":"a","name":"tab.updateContent","params":{"content":"test"},"approval":"auto"}`)}\nMore text...\n\`\`\`qp-action\n{"id":"b","name":"editor.insert","params":{"text":`;

    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });

  it("detects incomplete blocks when payload contains '<' characters", () => {
    const text = "```qp-action\n{" +
      "\"id\":\"q1\",\"name\":\"query.run\",\"params\":{\"connectionId\":\"c1\",\"query\":\"SELECT * FROM users WHERE age < 18\"}";

    const result = parseCommandsProgressive(text);
    expect(result.incomplete).toBe(true);
  });
});

describe("stripCommands", () => {
  it("removes qp-action blocks from text", () => {
    const text = `Before ${qpAction(`{"id":"x","name":"workspace.listTabs","params":{},"approval":"auto"}`)} After`;
    expect(stripCommands(text)).toBe("Before  After");
  });

  it("does not strip fenced qp-action examples in other languages", () => {
    const text = `Before\n\`\`\`md\n${qpAction(`{"id":"x","name":"tab.updateContent","params":{"content":"SELECT 1"},"approval":"auto"}`)}\n\`\`\`\nAfter`;
    expect(stripCommands(text)).toContain("```qp-action");
  });
});

describe("hasCommands", () => {
  it("returns true when qp-action blocks are present", () => {
    expect(hasCommands(qpAction(`{"id":"x","name":"workspace.listTabs","params":{},"approval":"auto"}`))).toBe(true);
  });

  it("returns false when no commands", () => {
    expect(hasCommands("Just plain text")).toBe(false);
  });
});

describe("getCommandDescription", () => {
  it("returns description for crud.stage", () => {
    const cmd = {
      id: "1",
      name: "crud.stage" as const,
      params: { operation: "insert" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(getCommandDescription(cmd)).toContain("Stage insert");
  });

  it("returns description for tab.updateContent", () => {
    const cmd = {
      id: "1",
      name: "tab.updateContent" as const,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(getCommandDescription(cmd)).toBe("Update tab content");
  });

  it("returns description for tab.create", () => {
    const cmd = {
      id: "1",
      name: "tab.create" as const,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(getCommandDescription(cmd)).toBe("Create new query tab");
  });

  it("returns description for editor.insert", () => {
    const cmd = {
      id: "1",
      name: "editor.insert" as const,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(getCommandDescription(cmd)).toBe("Insert at cursor");
  });
});

describe("validateCommand", () => {
  it("validates crud.stage requires operation", () => {
    const cmd = {
      id: "1",
      name: "crud.stage" as const,
      params: { connectionId: "c1" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(cmd)).toContain("operation");
  });

  it("validates editor.insert requires text", () => {
    const cmd = {
      id: "1",
      name: "editor.insert" as const,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(cmd)).toContain("text");
  });

  it("validates tab.updateContent and editor.insert don't need connectionId", () => {
    const tabCmd = {
      id: "1",
      name: "tab.updateContent" as const,
      params: { content: "test" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(tabCmd)).toBeNull();

    const editorCmd = {
      id: "2",
      name: "editor.insert" as const,
      params: { text: "test" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(editorCmd)).toBeNull();
  });

  it("validates crud.stage and tab.create need connectionId", () => {
    const crudCmd = {
      id: "1",
      name: "crud.stage" as const,
      params: { operation: "insert" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(crudCmd)).toContain("connectionId");

    const tabCreateCmd = {
      id: "2",
      name: "tab.create" as const,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(tabCreateCmd)).toContain("connectionId");
  });

  it("validates query.run language when provided", () => {
    const invalidQueryRun = {
      id: "3",
      name: "query.run" as const,
      params: {
        connectionId: "c1",
        query: "SELECT 1",
        language: "oracle",
      },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(invalidQueryRun)).toContain("Invalid language");
  });

  it("returns error for unknown command", () => {
    const cmd = {
      id: "1",
      name: "unknown.command" as AiCommandName,
      params: {},
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(cmd)).toContain("Unknown command");
  });
});
