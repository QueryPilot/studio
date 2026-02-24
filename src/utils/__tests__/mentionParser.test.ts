/**
 * Mention Parser Tests
 *
 * Tests for parsing @ mentions from user input for AI context.
 * Covers all mention formats including connection-qualified mentions.
 */

import { describe, it, expect } from "vitest";
import {
  parseMentions,
  getMentionAtCursor,
  formatMention,
  stripMentions,
  hasMentions,
  replaceMention,
} from "../mentionParser";

// ============================================================================
// parseMentions
// ============================================================================

describe("parseMentions", () => {
  it("returns empty array for text without mentions", () => {
    expect(parseMentions("SELECT * FROM users")).toEqual([]);
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions("no mentions here")).toEqual([]);
  });

  it("parses simple @table mention", () => {
    const result = parseMentions("tell me about @users");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: undefined,
      connectionName: undefined,
      raw: "@users",
    });
  });

  it("parses @schema.table mention", () => {
    const result = parseMentions("explain @public.users");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: "public",
      connectionName: undefined,
      raw: "@public.users",
    });
  });

  it("parses @ConnName/table mention", () => {
    const result = parseMentions("query @DevDB/users");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: undefined,
      connectionName: "DevDB",
      raw: "@DevDB/users",
    });
  });

  it("parses @ConnName/schema.table mention", () => {
    const result = parseMentions("compare @DevDB/public.users");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: "public",
      connectionName: "DevDB",
      raw: "@DevDB/public.users",
    });
  });

  it('parses @"Quoted Name"/schema.table mention', () => {
    const result = parseMentions('look at @"My Database"/public.users');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: "public",
      connectionName: "My Database",
      raw: '@"My Database"/public.users',
    });
  });

  it('parses @"Quoted Name"/table mention (no schema)', () => {
    const result = parseMentions('check @"My DB"/orders');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "table",
      name: "orders",
      schema: undefined,
      connectionName: "My DB",
      raw: '@"My DB"/orders',
    });
  });

  it("parses @tab:TabName mention", () => {
    const result = parseMentions("see @tab:MyQuery");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "tab",
      name: "MyQuery",
      raw: "@tab:MyQuery",
    });
  });

  it('parses @tab:"Quoted Tab Name" mention', () => {
    const result = parseMentions('check @tab:"User Analysis"');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "tab",
      name: "User Analysis",
      raw: '@tab:"User Analysis"',
    });
  });

  it("parses multiple mentions in a single string", () => {
    const result = parseMentions(
      "join @public.users with @DevDB/public.orders"
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "users",
      schema: "public",
      connectionName: undefined,
    });
    expect(result[1]).toMatchObject({
      name: "orders",
      schema: "public",
      connectionName: "DevDB",
    });
  });

  it("parses mixed object and tab mentions", () => {
    const result = parseMentions(
      "compare @public.users with @tab:MyQuery"
    );
    expect(result).toHaveLength(2);
    // Sorted by position: @public.users at 8, @tab:MyQuery at 27
    expect(result[0]).toMatchObject({
      type: "table",
      name: "users",
      schema: "public",
    });
    expect(result[1]).toMatchObject({ type: "tab", name: "MyQuery" });
    expect(result[0]!.start).toBeLessThan(result[1]!.start);
  });

  it("does not match @tab as an object mention (overlap prevention)", () => {
    const result = parseMentions("see @tab:MyQuery here");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "tab", name: "MyQuery" });
  });

  it("correctly tracks start/end positions", () => {
    const input = "hello @users world";
    const result = parseMentions(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(6);
    expect(result[0]!.end).toBe(12);
    expect(input.slice(result[0]!.start, result[0]!.end)).toBe("@users");
  });

  it("correctly tracks positions for connection-qualified mentions", () => {
    const input = 'x @"My DB"/public.users y';
    const result = parseMentions(input);
    expect(result).toHaveLength(1);
    expect(input.slice(result[0]!.start, result[0]!.end)).toBe(
      '@"My DB"/public.users'
    );
  });

  it("handles mention at start of string", () => {
    const result = parseMentions("@users is great");
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(0);
  });

  it("handles mention at end of string", () => {
    const result = parseMentions("describe @users");
    expect(result).toHaveLength(1);
    expect(result[0]!.end).toBe(15);
  });

  it("parses identifiers with underscores and digits", () => {
    const result = parseMentions("@public2.user_accounts_v3");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "user_accounts_v3",
      schema: "public2",
    });
  });
});

// ============================================================================
// getMentionAtCursor
// ============================================================================

describe("getMentionAtCursor", () => {
  it("returns null when cursor is not in a mention", () => {
    expect(getMentionAtCursor("hello world", 5)).toBeNull();
    expect(getMentionAtCursor("", 0)).toBeNull();
  });

  it("detects simple mention being typed", () => {
    //                         0123456789012
    const input = "tell me @us";
    const result = getMentionAtCursor(input, 11); // cursor after 's'
    expect(result).toMatchObject({
      prefix: "us",
      start: 8,
      type: "object",
    });
  });

  it("detects schema-qualified mention being typed", () => {
    const input = "tell me @public.us";
    const result = getMentionAtCursor(input, 18);
    expect(result).toMatchObject({
      prefix: "public.us",
      start: 8,
      type: "object",
    });
  });

  it("detects connection-qualified mention being typed", () => {
    const input = "tell me @DevDB/pub";
    const result = getMentionAtCursor(input, 18);
    expect(result).toMatchObject({
      prefix: "DevDB/pub",
      start: 8,
      type: "object",
    });
  });

  it("detects connection-qualified mention with schema being typed", () => {
    const input = "tell me @DevDB/public.us";
    // cursor at end of string = input.length
    const result = getMentionAtCursor(input, input.length);
    expect(result).toMatchObject({
      prefix: "DevDB/public.us",
      start: 8,
      type: "object",
    });
  });

  it("detects quoted connection name with spaces", () => {
    const input = 'tell me @"My DB"/pub';
    const result = getMentionAtCursor(input, 20);
    expect(result).toMatchObject({
      prefix: '"My DB"/pub',
      start: 8,
      type: "object",
    });
  });

  it("detects tab mention being typed", () => {
    const input = "see @tab:My";
    const result = getMentionAtCursor(input, 11);
    expect(result).toMatchObject({
      prefix: "My",
      start: 4,
      type: "tab",
    });
  });

  it("returns null when cursor is after a space following a mention", () => {
    const input = "@users ";
    const result = getMentionAtCursor(input, 7); // cursor after space
    expect(result).toBeNull();
  });

  it("detects mention at very start of input", () => {
    const input = "@u";
    const result = getMentionAtCursor(input, 2);
    expect(result).toMatchObject({
      prefix: "u",
      start: 0,
      type: "object",
    });
  });

  it("returns prefix for just @ with no text after", () => {
    const input = "test @";
    const result = getMentionAtCursor(input, 6);
    expect(result).toMatchObject({
      prefix: "",
      start: 5,
      type: "object",
    });
  });
});

// ============================================================================
// formatMention
// ============================================================================

describe("formatMention", () => {
  it("formats simple table mention", () => {
    expect(formatMention("table", "users")).toBe("@users");
  });

  it("formats schema-qualified mention", () => {
    expect(formatMention("table", "users", "public")).toBe("@public.users");
  });

  it("formats connection-qualified mention without schema", () => {
    expect(formatMention("table", "users", undefined, "DevDB")).toBe(
      "@DevDB/users"
    );
  });

  it("formats connection-qualified mention with schema", () => {
    expect(formatMention("table", "users", "public", "DevDB")).toBe(
      "@DevDB/public.users"
    );
  });

  it("quotes connection name with spaces", () => {
    expect(formatMention("table", "users", "public", "My Database")).toBe(
      '@"My Database"/public.users'
    );
  });

  it("quotes connection name with special characters", () => {
    expect(formatMention("table", "users", undefined, "db-prod")).toBe(
      '@"db-prod"/users'
    );
  });

  it("does not quote simple connection names", () => {
    expect(formatMention("table", "users", undefined, "DevDB")).toBe(
      "@DevDB/users"
    );
    expect(formatMention("table", "users", undefined, "_internal")).toBe(
      "@_internal/users"
    );
  });

  it("formats view mention same as table", () => {
    expect(formatMention("view", "active_users", "public")).toBe(
      "@public.active_users"
    );
  });

  it("formats function mention same as table", () => {
    expect(formatMention("function", "get_user", "public", "DevDB")).toBe(
      "@DevDB/public.get_user"
    );
  });

  it("formats tab mention without quotes", () => {
    expect(formatMention("tab", "MyQuery")).toBe("@tab:MyQuery");
  });

  it("formats tab mention with quotes when name has spaces", () => {
    expect(formatMention("tab", "My Query")).toBe('@tab:"My Query"');
  });

  it("ignores connectionName for tab mentions", () => {
    // Tab mentions don't use connection prefix
    expect(formatMention("tab", "MyQuery", undefined, "DevDB")).toBe(
      "@tab:MyQuery"
    );
  });
});

// ============================================================================
// stripMentions
// ============================================================================

describe("stripMentions", () => {
  it("returns clean text for input without mentions", () => {
    expect(stripMentions("hello world")).toBe("hello world");
  });

  it("strips simple mention to object name", () => {
    expect(stripMentions("describe @users please")).toBe(
      "describe users please"
    );
  });

  it("strips schema-qualified mention to object name", () => {
    expect(stripMentions("describe @public.users please")).toBe(
      "describe users please"
    );
  });

  it("strips connection-qualified mention to object name", () => {
    expect(stripMentions("describe @DevDB/users please")).toBe(
      "describe users please"
    );
  });

  it("strips connection+schema mention to object name", () => {
    expect(stripMentions("describe @DevDB/public.users please")).toBe(
      "describe users please"
    );
  });

  it("strips quoted connection mention to object name", () => {
    expect(stripMentions('describe @"My DB"/public.users please')).toBe(
      "describe users please"
    );
  });

  it("strips tab mention to tab name", () => {
    expect(stripMentions("see @tab:MyQuery here")).toBe("see MyQuery here");
  });

  it("strips quoted tab mention to tab name", () => {
    expect(stripMentions('see @tab:"My Query" here')).toBe(
      "see My Query here"
    );
  });

  it("strips multiple mentions", () => {
    expect(
      stripMentions("join @public.users and @DevDB/orders")
    ).toBe("join users and orders");
  });

  it("collapses extra whitespace after stripping", () => {
    expect(stripMentions("  @users  @orders  ")).toBe("users orders");
  });
});

// ============================================================================
// hasMentions
// ============================================================================

describe("hasMentions", () => {
  it("returns false for text without mentions", () => {
    expect(hasMentions("hello world")).toBe(false);
    expect(hasMentions("")).toBe(false);
  });

  it("returns true for simple mention", () => {
    expect(hasMentions("see @users")).toBe(true);
  });

  it("returns true for schema-qualified mention", () => {
    expect(hasMentions("see @public.users")).toBe(true);
  });

  it("returns true for connection-qualified mention", () => {
    expect(hasMentions("see @DevDB/users")).toBe(true);
  });

  it("returns true for tab mention", () => {
    expect(hasMentions("see @tab:MyQuery")).toBe(true);
  });

  it("returns correct result on repeated calls (no g-flag statefulness)", () => {
    // This specifically tests the fix for the lastIndex bug
    const input = "see @users";
    expect(hasMentions(input)).toBe(true);
    expect(hasMentions(input)).toBe(true);
    expect(hasMentions(input)).toBe(true);
  });

  it("returns correct result alternating different inputs", () => {
    expect(hasMentions("no mentions")).toBe(false);
    expect(hasMentions("@users")).toBe(true);
    expect(hasMentions("no mentions")).toBe(false);
    expect(hasMentions("@users")).toBe(true);
  });
});

// ============================================================================
// replaceMention
// ============================================================================

describe("replaceMention", () => {
  it("replaces mention at specified position", () => {
    const input = "tell me @us something";
    const result = replaceMention(input, 8, 11, "@public.users");
    expect(result).toBe("tell me @public.users something");
  });

  it("replaces mention at start of string", () => {
    const result = replaceMention("@us rest", 0, 3, "@users");
    expect(result).toBe("@users rest");
  });

  it("replaces mention at end of string", () => {
    const result = replaceMention("start @us", 6, 9, "@users");
    expect(result).toBe("start @users");
  });
});

// ============================================================================
// Round-trip: formatMention -> parseMentions
// ============================================================================

describe("round-trip: format then parse", () => {
  it("simple table", () => {
    const formatted = formatMention("table", "users");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "users", schema: undefined, connectionName: undefined });
  });

  it("schema-qualified", () => {
    const formatted = formatMention("table", "users", "public");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "users", schema: "public", connectionName: undefined });
  });

  it("connection-qualified", () => {
    const formatted = formatMention("table", "users", "public", "DevDB");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "users", schema: "public", connectionName: "DevDB" });
  });

  it("quoted connection name", () => {
    const formatted = formatMention("table", "users", "public", "My Database");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "users", schema: "public", connectionName: "My Database" });
  });

  it("connection without schema", () => {
    const formatted = formatMention("table", "orders", undefined, "DevDB");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "orders", schema: undefined, connectionName: "DevDB" });
  });

  it("tab mention", () => {
    const formatted = formatMention("tab", "My Query");
    const parsed = parseMentions(formatted);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: "tab", name: "My Query" });
  });
});
