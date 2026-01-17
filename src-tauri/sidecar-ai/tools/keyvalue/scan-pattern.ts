/**
 * Scan Pattern Tool
 *
 * Scans Redis keys matching a specific pattern.
 */

import { defineTool } from "../base";

export const scanPattern = defineTool({
  name: "scan_keys",
  friendlyName: "Scan Keys",
  description: "Scan keys matching a pattern (e.g., 'user:*', 'session:*')",
  category: "discovery",
  capabilities: ["keyvalue"],

  parameters: {
    connectionId: { type: "string", required: true },
    pattern: { type: "string", required: false, default: "*" },
    count: { type: "number", required: false, default: 100 },
  },

  messages: {
    pending: (input) => `Scanning keys matching '${input.pattern || "*"}'...`,
    success: (input, output) =>
      `Found ${output.keys?.length || 0} key${output.keys?.length === 1 ? "" : "s"} matching '${input.pattern || "*"}'`,
    error: (input, err) =>
      `Failed to scan keys: ${err.message}`,
  },

  async execute({ connectionId, pattern, count }, ctx) {
    const result = await ctx.tauri.invoke("ai_keyvalue_execute", {
      connectionId,
      operation: {
        type: "Scan",
        pattern: pattern || "*",
        cursor: 0,
        count: count || 100,
      },
    });

    // Extract keys from scan result (KeyValueResult::Scan returns {type: "scan", data: {keys: string[], cursor: number}})
    return {
      keys: result.type === "scan" && result.data ? result.data.keys : [],
      cursor: result.type === "scan" && result.data ? result.data.cursor : 0,
    };
  },
});
