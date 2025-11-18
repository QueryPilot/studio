import { getCorsHeaders } from "../middleware/cors";
import { ConfigService } from "../services/config.service";
import type { ConfigRequest, ConfigResponse } from "../types";
import { initializeSentry } from "../utils/sentry";

const SIDECAR_VERSION = "1.0.0"; // Should match package.json version

export async function handleConfig(request: Request): Promise<Response> {
  try {
    const body: ConfigRequest = await request.json();

    // Initialize Sentry if enabled
    if (body.sentryEnabled !== undefined) {
      initializeSentry(
        body.sentryEnabled,
        body.sentryDsn,
        SIDECAR_VERSION,
      );
    }

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
