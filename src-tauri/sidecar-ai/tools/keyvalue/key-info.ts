/**
 * Key Info Tool
 *
 * Gets comprehensive information about a Redis key (type, TTL, size).
 */

import { defineTool } from "../base";

export const keyInfo = defineTool({
  name: "key_info",
  friendlyName: "Get Key Info",
  description: "Get key type, TTL, and size information",
  category: "introspection",
  capabilities: ["keyvalue"],

  parameters: {
    connectionId: { type: "string", required: true },
    key: { type: "string", required: true },
  },

  messages: {
    pending: (input) => `Getting info for key '${input.key}'...`,
    success: (input, output) =>
      `Key '${input.key}' is type ${output.type || "unknown"}${output.ttl ? ` with TTL ${output.ttl}s` : ""}`,
    error: (input, err) =>
      `Failed to get info for key '${input.key}': ${err.message}`,
  },

  async execute({ connectionId, key }, ctx) {
    // Get type
    const typeResult = await ctx.tauri.invoke("ai_keyvalue_execute", {
      connectionId,
      operation: {
        type: "Type",
        key,
      },
    });

    // Get TTL
    const ttlResult = await ctx.tauri.invoke("ai_keyvalue_execute", {
      connectionId,
      operation: {
        type: "Ttl",
        key,
      },
    });

    // Extract values from results
    // KeyValueResult::KeyType returns {type: "keyType", data: RedisType}
    // KeyValueResult::Ttl returns {type: "ttl", data: number}
    const keyType = typeResult.type === "keyType" ? typeResult.data : "none";
    const ttl = ttlResult.type === "ttl" ? ttlResult.data : -1;

    return {
      key,
      type: keyType,
      ttl,
      exists: keyType !== "none",
    };
  },
});
