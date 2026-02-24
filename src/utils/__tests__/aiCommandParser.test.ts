/**
 * AI Command Parser Tests
 *
 * Tests for parsing AI commands from agent responses.
 * Note: Read commands have been removed - AI uses MCP tools for database reads.
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

describe("parseCommands", () => {
  it("returns empty array for text without commands", () => {
    const text = "Here is some SQL:\n```sql\nSELECT * FROM users\n```";
    expect(parseCommands(text)).toEqual([]);
  });

  it("parses crud.stage command", () => {
    const text = `Let me stage that change.

<command name="crud.stage">
{
  "connectionId": "conn-123",
  "table": "users",
  "operation": "insert",
  "document": { "name": "Alice" }
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.name).toBe("crud.stage");
    expect((first.params as { connectionId: string }).connectionId).toBe("conn-123");
  });

  it("parses tab.update command", () => {
    const text = `<command name="tab.update">
{
  "content": "SELECT * FROM users",
  "title": "User Query"
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.name).toBe("tab.update");
  });

  it("parses editor.insert command", () => {
    const text = `<command name="editor.insert">
{"text": "-- Comment", "position": "cursor"}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.name).toBe("editor.insert");
  });

  it("parses multiple commands", () => {
    const text = `First update:
<command name="tab.update">{"content": "SELECT 1"}</command>

Second update:
<command name="editor.insert">{"text": "-- test"}</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(2);
  });

  it("handles malformed JSON gracefully", () => {
    const text = `<command name="crud.stage">{ invalid }</command>`;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.error).toBeDefined();
  });

  it("extracts position in text", () => {
    const text = 'Before\n<command name="tab.update">{}</command>\nAfter';
    const commands = parseCommands(text);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.startIndex).toBe(7);
  });

  it("marks unknown commands as errors", () => {
    const text = `<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 1"}</command>`;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.error).toContain("Unknown command");
  });

  it("ignores command-like tags inside fenced code blocks", () => {
    const text = `Here is an example only:

\`\`\`xml
<command name="tab.update">{"content":"SELECT 1"}</command>
\`\`\``;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(0);
  });

  it("parses non-canonical command syntax with low confidence", () => {
    const text = `<command   name='tab.update' >{"content":"SELECT 1"}</command>`;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    const first = commands[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected command");
    expect(first.name).toBe("tab.update");
    expect(first.confidence).toBe("low");
  });
});

describe("parseCommandsProgressive", () => {
  it("returns incomplete for partial command", () => {
    const text = 'Here is a command: <command name="crud.stage">{"operation":';
    const result = parseCommandsProgressive(text);
    expect(result.complete).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("returns complete when command is finished", () => {
    const text = `<command name="tab.update">{"content": "SELECT 1"}</command>`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(false);
  });

  it("handles mix of complete and streaming", () => {
    const text = `<command name="tab.update">{"content": "test"}</command>
More text...
<command name="editor.insert">{"text":`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });

  it("detects incomplete commands even when payload contains '<' characters", () => {
    const text =
      '<command name="query.run">{"connectionId":"c1","query":"SELECT * FROM users WHERE age < 18"';
    const result = parseCommandsProgressive(text);
    expect(result.incomplete).toBe(true);
  });
});

describe("stripCommands", () => {
  it("removes command blocks from text", () => {
    const text = `Before <command name="test">{}</command> After`;
    expect(stripCommands(text)).toBe("Before  After");
  });

  it("does not strip fenced command examples", () => {
    const text = `Before
\`\`\`xml
<command name="tab.update">{"content":"SELECT 1"}</command>
\`\`\`
After`;
    expect(stripCommands(text)).toContain("<command name=\"tab.update\">");
  });
});

describe("hasCommands", () => {
  it("returns true when commands present", () => {
    expect(hasCommands(`<command name="test">{}</command>`)).toBe(true);
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

  it("returns description for tab.update", () => {
    const cmd = {
      id: "1",
      name: "tab.update" as const,
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
    expect(getCommandDescription(cmd)).toBe("Create new tab");
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

  it("validates tab.update and editor.insert don't need connectionId", () => {
    const tabCmd = {
      id: "1",
      name: "tab.update" as const,
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
      params: { type: "query" },
      raw: "",
      startIndex: 0,
      endIndex: 0,
    };
    expect(validateCommand(tabCreateCmd)).toContain("connectionId");
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
