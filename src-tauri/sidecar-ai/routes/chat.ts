import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import { tools } from "../tools";
import { registry } from "../tools/registry";
import { createAiSdkTools } from "../tools/base";
import type { ChatRequest, TauriClient } from "../types";
import { validateConnectionContext } from "../utils/security";
import { getPromptEngine } from "../prompts/engine";
import { MAX_TOOL_STEPS, TAURI_API_URL } from "../config/constants";
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
    const { messages, provider, model, context } = body;

    // Extract and validate connection context from request body
    const rawContext = {
      connectionId: context?.connectionId || request.headers.get("X-Connection-Id") || "",
      database: context?.database || "",
      schema: context?.schema || "",
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

    // Create AI provider (uses stored API keys)
    const aiProvider = ProviderService.createProvider(provider);
    const aiModel = aiProvider(model);

    // Convert UIMessages to ModelMessages (CoreMessages) - v6: now async
    const modelMessages = await convertToModelMessages(messages);

    // Create TauriClient for registry tools
    const tauri: TauriClient = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        const response = await fetch(`${TAURI_API_URL}/__tauri__/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: command, args }),
        });

        if (!response.ok) {
          throw new Error(`Tauri command ${command} failed: ${response.statusText}`);
        }

        return response.json();
      },
    };

    // Get capability-aware tools from registry
    let registryTools = {};
    let registeredToolsList: any[] = [];
    if (connectionId) {
      try {
        const registeredTools = await registry.getToolsForConnection(connectionId, tauri);
        registeredToolsList = registeredTools;
        const toolContext = {
          connectionId,
          conversationId: request.headers.get("X-Conversation-Id") || "",
        };
        registryTools = createAiSdkTools(registeredTools, toolContext, tauri);
      } catch (error) {
        console.warn("Failed to load registry tools, using legacy tools only:", error);
      }
    }

    // Merge legacy tools with registry tools
    const allTools = { ...tools, ...registryTools };

    // Build system prompt using PromptEngine
    const promptEngine = await getPromptEngine();
    const systemPrompt = promptEngine.render("system", {
      connection: connectionId
        ? {
            connectionId,
            database,
            schema,
            paradigm: "sql", // TODO: Get from capabilities
            activeTable: context?.activeTable,
            activeCollection: context?.activeCollection,
            activeKey: context?.activeKey,
            recentTables: context?.recentTables || [],
            recentCollections: context?.recentCollections || [],
            lastAction: context?.lastAction,
          }
        : undefined,
      tools: registeredToolsList.map((tool) => ({
        name: tool.name,
        friendlyName: tool.friendlyName,
        description: tool.description,
        category: tool.category || "general",
        capabilities: tool.capabilities || [],
      })),
      maxToolSteps: MAX_TOOL_STEPS,
    });

    // Track AI generation with metrics
    const aiMetric = ToolMetrics.chat(provider);

    // Stream response using AI SDK
    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: modelMessages,
      tools: allTools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      onFinish: ({ finishReason }) => {
        // Track completion metrics
        const isSuccess = finishReason !== "error";
        metrics.endOperation(aiMetric, isSuccess, isSuccess ? undefined : finishReason);
        metrics.endOperation(metric, isSuccess, isSuccess ? undefined : finishReason);
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
