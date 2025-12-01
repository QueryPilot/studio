import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import { tools } from "../tools";
import type { ChatRequest } from "../types";
import { validateConnectionContext } from "../utils/security";
import { getChatSystemPrompt } from "../prompts/chat";
import { MAX_TOOL_STEPS } from "../config/constants";
import { metrics, ToolMetrics } from "../utils/metrics";
import { rateLimiter, addRateLimitHeaders } from "../utils/rate-limiter";
import {
  createError,
  toActionableError,
  errorResponse,
  ErrorCode,
} from "../utils/errors";

export async function handleChatStream(request: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(request);

  // Rate limiting check
  const rateLimitKey = request.headers.get("X-Connection-Id") || "anonymous";
  const rateLimitResult = rateLimiter.checkWithGlobal("chat", rateLimitKey);

  if (!rateLimitResult.allowed) {
    const error = createError(ErrorCode.RATE_LIMITED, {
      retryAfterMs: rateLimitResult.retryAfterMs,
      resetAt: new Date(rateLimitResult.resetAt).toISOString(),
    });
    return errorResponse(error, corsHeaders);
  }

  // Start metrics tracking
  const metric = ToolMetrics.chat("request");

  try {
    const body: ChatRequest = await request.json();
    const { messages, provider, model } = body;

    console.log(`📨 Chat request: provider=${provider}, model=${model}`);

    // Extract and validate connection context from headers
    const rawContext = {
      connectionId: request.headers.get("X-Connection-Id") || "",
      database: request.headers.get("X-Connection-Database") || "",
      schema: request.headers.get("X-Connection-Schema") || "",
    };

    const validation = validateConnectionContext(rawContext);

    if (!validation.isValid) {
      console.warn(
        `⚠️ Invalid connection context: ${validation.errors.join(", ")}`,
      );
      const error = createError(ErrorCode.INVALID_CONNECTION, {
        errors: validation.errors,
      });
      metrics.endOperation(metric, false, error.message);
      return errorResponse(error, corsHeaders);
    }

    const { connectionId, database, schema } = validation.sanitized;

    console.log(
      `🔗 Connection context (validated): id=${connectionId}, db=${database}, schema=${schema}`,
    );

    // Create AI provider (uses stored API keys)
    const aiProvider = ProviderService.createProvider(provider);
    const aiModel = aiProvider(model);

    // Convert UIMessages to ModelMessages (CoreMessages)
    const modelMessages = convertToModelMessages(messages);

    // Build system prompt with connection context
    const systemPrompt = getChatSystemPrompt(
      connectionId ? { connectionId, database, schema } : undefined,
    );

    // Track AI generation with metrics
    const aiMetric = ToolMetrics.chat(provider);

    // Stream response using AI SDK
    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      onFinish: ({ finishReason, usage }) => {
        // Track completion metrics
        const isSuccess = finishReason !== "error";
        metrics.endOperation(aiMetric, isSuccess, isSuccess ? undefined : finishReason);
        metrics.endOperation(metric, isSuccess, isSuccess ? undefined : finishReason);
        console.log(
          `📊 Chat completed: reason=${finishReason}, tokens=${usage?.totalTokens || "unknown"}`,
        );
      },
    });

    // Use AI SDK v5's UI message stream response for tool calls, markdown, and proper formatting
    // This is what useChat() with streamProtocol: "data" expects
    const response = result.toUIMessageStreamResponse();

    // Add CORS and rate limit headers to the response
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return addRateLimitHeaders(response, "chat", rateLimitKey);
  } catch (error) {
    console.error("❌ Chat stream error:", error);

    // Convert to actionable error
    const actionableError = toActionableError(error);
    metrics.endOperation(metric, false, actionableError.message);
    return errorResponse(actionableError, corsHeaders);
  }
}
