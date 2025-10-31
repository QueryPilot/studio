import { getCorsHeaders } from "../middleware/cors";
import { ConfigService } from "../services/config.service";
import type { ConfigRequest, ConfigResponse } from "../types";

export async function handleConfig(request: Request): Promise<Response> {
  try {
    const body: ConfigRequest = await request.json();
    const configured = ConfigService.setApiKeys(body);

    const response: ConfigResponse = {
      status: "ok",
      configured,
    };

    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(request),
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Failed to configure API keys",
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
