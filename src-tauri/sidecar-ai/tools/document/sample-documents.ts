/**
 * Sample Documents Tool
 *
 * Retrieves a random sample of documents from a MongoDB collection.
 */

import { defineTool } from "../base";

export const sampleDocuments = defineTool({
  name: "sample_documents",
  friendlyName: "Sample Documents",
  description: "Get random sample documents from a collection",
  category: "data",
  capabilities: ["document"],

  parameters: {
    connectionId: { type: "string", required: true },
    collection: { type: "string", required: true },
    size: { type: "number", required: false, default: 5 },
  },

  messages: {
    pending: (input) => `Sampling ${input.size || 5} documents from ${input.collection}...`,
    success: (input, output) =>
      `Retrieved ${output.documents?.length || 0} sample document${output.documents?.length === 1 ? "" : "s"}`,
    error: (input, err) =>
      `Failed to sample documents from ${input.collection}: ${err.message}`,
  },

  async execute({ connectionId, collection, size }, ctx) {
    // MongoDB $sample aggregation pipeline stage
    const result = await ctx.tauri.invoke("ai_document_execute", {
      connectionId,
      operation: {
        type: "Aggregate",
        collection,
        pipeline: [{ $sample: { size: size || 5 } }],
      },
    });

    // Extract documents from aggregate result
    return {
      documents: result.type === "documents" ? result.data : [],
    };
  },
});
