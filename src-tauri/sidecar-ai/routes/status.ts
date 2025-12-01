import { getCorsHeaders } from "../middleware/cors";
import { ConfigService } from "../services/config.service";
import { metrics } from "../utils/metrics";
import { rateLimiter } from "../utils/rate-limiter";
import type { StatusResponse } from "../types";

export function handleStatus(request: Request): Response {
  // Check if detailed metrics are requested
  const url = new URL(request.url);
  const includeMetrics = url.searchParams.get("metrics") === "true";

  const response: StatusResponse & {
    metrics?: ReturnType<typeof metrics.getAggregatedMetrics>;
    rateLimits?: ReturnType<typeof rateLimiter.getLimits>;
  } = {
    status: ConfigService.isConfigLoaded() ? "ready" : "initializing",
    configLoaded: ConfigService.isConfigLoaded(),
    configuredProviders: ConfigService.getConfiguredProviders(),
  };

  // Include metrics if requested
  if (includeMetrics) {
    response.metrics = metrics.getAggregatedMetrics();
    response.rateLimits = rateLimiter.getLimits();
  }

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
}
