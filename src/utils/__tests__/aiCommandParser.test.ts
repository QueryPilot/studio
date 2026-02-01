import { describe, it, expect } from "vitest";
import {
  parseCommands,
  parseCommandsProgressive,
  stripCommands,
  hasCommands,
} from "../aiCommandParser";

describe("parseCommands", () => {
  it("returns empty array for text without commands", () => {
    const text = "Here is some SQL:\n```sql\nSELECT * FROM users\n```";
    expect(parseCommands(text)).toEqual([]);
  });

  it("parses sql.execute command", () => {
    const text = `Let me query that.

<command name="sql.execute">
{
  "connectionId": "conn-123",
  "sql": "SELECT * FROM users LIMIT 10"
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("sql.execute");
    expect((commands[0]!.params as { connectionId: string }).connectionId).toBe("conn-123");
  });

  it("parses mongodb.find command", () => {
    const text = `<command name="mongodb.find">
{
  "connectionId": "conn-mongo",
  "collection": "users",
  "filter": { "active": true },
  "limit": 20
}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("mongodb.find");
    expect((commands[0]!.params as { collection: string }).collection).toBe("users");
  });

  it("parses redis.get command", () => {
    const text = `<command name="redis.get">
{"connectionId": "conn-redis", "key": "user:123"}
</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("redis.get");
  });

  it("parses multiple commands", () => {
    const text = `First query:
<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 1"}</command>

Second query:
<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 2"}</command>`;

    const commands = parseCommands(text);
    expect(commands).toHaveLength(2);
  });

  it("handles malformed JSON gracefully", () => {
    const text = `<command name="sql.execute">{ invalid }</command>`;
    const commands = parseCommands(text);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.error).toBeDefined();
  });

  it("extracts position in text", () => {
    const text = 'Before\n<command name="sql.execute">{}</command>\nAfter';
    const commands = parseCommands(text);
    expect(commands[0]!.startIndex).toBe(7);
  });
});

describe("parseCommandsProgressive", () => {
  it("returns incomplete for partial command", () => {
    const text = 'Here is a command: <command name="sql.execute">{"sql":';
    const result = parseCommandsProgressive(text);
    expect(result.complete).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("returns complete when command is finished", () => {
    const text = `<command name="sql.execute">{"connectionId": "c1", "sql": "SELECT 1"}</command>`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(false);
  });

  it("handles mix of complete and streaming", () => {
    const text = `<command name="sql.execute">{"connectionId": "c1"}</command>
More text...
<command name="sql.execute">{"connectionId":`;
    const result = parseCommandsProgressive(text);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toBe(true);
  });
});

describe("stripCommands", () => {
  it("removes command blocks from text", () => {
    const text = `Before <command name="test">{}</command> After`;
    expect(stripCommands(text)).toBe("Before  After");
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
