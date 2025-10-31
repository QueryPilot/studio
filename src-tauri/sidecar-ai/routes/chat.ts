import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import { tools } from "../tools";
import type { ChatRequest } from "../types";
import { validateConnectionContext } from "../utils/security";
import { MAX_TOOL_STEPS } from "../config/constants";

export async function handleChatStream(request: Request): Promise<Response> {
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
      return new Response(
        JSON.stringify({
          error: `Invalid connection context: ${validation.errors.join(", ")}`,
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(request),
          },
        },
      );
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
    const systemPrompt = connectionId
      ? `You are an AI assistant helping users explore and query their database.

Current Database Connection:
- Connection ID: ${connectionId}
- Database: ${database || "default"}
- Schema: ${schema || "public"}

IMPORTANT: When using database tools (list_tables, get_table_structure, etc.), you MUST use these exact values:
- connectionId: "${connectionId}"
- database: "${database || "default"}"
- schema: "${schema || "public"}"

Always use these values for tool parameters unless the user explicitly specifies different ones.`
      : "You are an AI assistant helping users explore and query their database.";

    // Stream response using AI SDK
    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });

    // Use AI SDK v5's UI message stream response for tool calls, markdown, and proper formatting
    // This is what useChat() with streamProtocol: "data" expects
    const response = result.toUIMessageStreamResponse();

    // Add CORS headers to the response
    const corsHeaders = getCorsHeaders(request);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    console.error("❌ Chat stream error:", error);

    // Return error in AI SDK's expected format for useChat
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      },
    );
  }
}
