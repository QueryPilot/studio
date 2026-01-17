/**
 * Count Documents Tool
 *
 * Counts documents matching a filter in a MongoDB collection.
 */

import { defineTool } from "../base";

export const countDocuments = defineTool({
  name: "count_documents",
  friendlyName: "Count Documents",
  description: "Count documents in a collection matching an optional filter",
  category: "data",
  capabilities: ["document"],

  parameters: {
    connectionId: { type: "string", required: true },
    collection: { type: "string", required: true },
    filter: { type: "object", required: false, default: {} },
  },

  messages: {
    pending: (input) =>
      `Counting documents in ${input.collection}${input.filter && Object.keys(input.filter).length > 0 ? " with filter" : ""}...`,
    success: (input, output) =>
      `Found ${output.count || 0} document${output.count === 1 ? "" : "s"} in ${input.collection}`,
    error: (input, err) =>
      `Failed to count documents in ${input.collection}: ${err.message}`,
  },

  async execute({ connectionId, collection, filter }, ctx) {
    const result = await ctx.tauri.invoke("ai_document_execute", {
      connectionId,
      operation: {
        type: "Count",
        collection,
        filter: filter || {},
      },
    });

    // Extract count from result (DocumentResult::Count returns {type: "count", data: number})
    return {
      count: result.type === "count" ? result.data : 0,
    };
  },
});
