import { getCorsHeaders } from "../middleware/cors";
import { ConfigService } from "../services/config.service";
import type { StatusResponse } from "../types";

export function handleStatus(request: Request): Response {
  const response: StatusResponse = {
    status: ConfigService.isConfigLoaded() ? "ready" : "initializing",
    configLoaded: ConfigService.isConfigLoaded(),
    configuredProviders: ConfigService.getConfiguredProviders(),
  };

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
}
