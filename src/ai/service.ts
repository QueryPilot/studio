// src/ai/service.ts
import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { StreamCallbacks } from "./types";
import { MAX_TOOL_STEPS } from "./constants";

export async function streamChat(options: {
  model: LanguageModel;
  systemPrompt: string;
  messages: ModelMessage[];
  tools: ToolSet;
  callbacks: StreamCallbacks;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { model, systemPrompt, messages, tools, callbacks, abortSignal } =
    options;

  // Track whether onError was already called (e.g. from the stream's onError
  // callback) so we don't report the same failure twice in the catch block.
  const state = { errorReported: false };

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal,
      onChunk: ({ chunk }) => {
        if (abortSignal?.aborted) return;
        if (chunk.type === "text-delta") {
          callbacks.onChunk(chunk.text);
        } else if (chunk.type === "tool-call") {
          callbacks.onToolCall({
            id: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.input,
          });
        }
      },
      onStepFinish: ({ toolResults }) => {
        if (abortSignal?.aborted) return;
        for (const tr of toolResults) {
          callbacks.onToolResult(tr.toolCallId, tr.output);
        }
      },
      onError: ({ error }) => {
        // Ignore errors triggered by abort — cancelGeneration already set
        // a clean state; reporting the abort error would overwrite it.
        if (abortSignal?.aborted) return;
        if (!state.errorReported) {
          state.errorReported = true;
          callbacks.onError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    });

    // Consume the stream to completion
    await result.text;

    // Only call onFinish if no error was reported
    if (!state.errorReported) {
      const response = await result.response;
      // Filter out OpenAI Responses API-specific parts (e.g. item_reference)
      // that non-OpenAI providers like Ollama can't parse
      const cleanMessages = response.messages.map((msg) => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const filtered = msg.content.filter(
            (part) => (part as { type: string }).type !== "item_reference",
          );
          return { ...msg, content: filtered };
        }
        return msg;
      });
      callbacks.onFinish(cleanMessages);
    }
  } catch (err) {
    if (abortSignal?.aborted) return;
    if (!state.errorReported) {
      state.errorReported = true;
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }
}
