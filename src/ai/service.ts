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

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
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
        callbacks.onError(
          error instanceof Error ? error.message : String(error),
        );
      },
    });

    // Consume the stream to completion
    await result.text;

    callbacks.onFinish();
  } catch (err) {
    if (abortSignal?.aborted) return;
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
}
