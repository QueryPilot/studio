import { getCorsHeaders } from "../middleware/cors";

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  architecture?: {
    modality?: string;
  };
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface SearchParams {
  query?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch all models from OpenRouter API and optionally search/filter
 * GET /openrouter-models?query=claude&limit=20&offset=0
 */
export async function handleOpenRouterModels(
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.toLowerCase() || "";
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    console.log(
      `📡 Fetching OpenRouter models (query="${query}", limit=${limit}, offset=${offset})`,
    );

    // Fetch models from OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("❌ OpenRouter API error:", response.status);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch models from OpenRouter",
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(request),
          },
        },
      );
    }

    const data: OpenRouterModelsResponse = await response.json();
    let models = data.data || [];

    console.log(`✅ Fetched ${models.length} models from OpenRouter`);

    // Filter by search query if provided
    if (query) {
      models = models.filter(
        (model) =>
          model.id.toLowerCase().includes(query) ||
          model.name.toLowerCase().includes(query) ||
          model.description?.toLowerCase().includes(query),
      );
      console.log(`🔍 Filtered to ${models.length} models matching "${query}"`);
    }

    // Sort by name for better UX
    models.sort((a, b) => a.name.localeCompare(b.name));

    // Apply pagination
    const total = models.length;
    const paginatedModels = models.slice(offset, offset + limit);

    // Transform to simpler format for frontend
    const simplifiedModels = paginatedModels.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description || "",
      contextLength: model.context_length,
      pricing: {
        prompt: parseFloat(model.pricing.prompt),
        completion: parseFloat(model.pricing.completion),
      },
      modality: model.architecture?.modality || "text",
    }));

    return new Response(
      JSON.stringify({
        models: simplifiedModels,
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      },
    );
  } catch (error) {
    console.error("❌ Error fetching OpenRouter models:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch OpenRouter models",
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
