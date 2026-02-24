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
  maxToolSteps?: number;
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
      stopWhen: stepCountIs(options.maxToolSteps ?? MAX_TOOL_STEPS),
      abortSignal,
      onChunk: ({ chunk }) => {
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
        for (const tr of toolResults) {
          callbacks.onToolResult(tr.toolCallId, tr.output);
        }
      },
      onError: ({ error }) => {
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

    // Get the full response messages (includes tool call/result pairs)
    const response = await result.response;
    callbacks.onFinish(response.messages);
  } catch (err) {
    if (abortSignal?.aborted) return;
    if (!state.errorReported) {
      state.errorReported = true;
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  }
}
