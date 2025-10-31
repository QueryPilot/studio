import { getCorsHeaders } from "../middleware/cors";
import { SUPPORTED_PROVIDERS } from "../config/providers";

export function handleProviders(request: Request): Response {
  return new Response(JSON.stringify(SUPPORTED_PROVIDERS), {
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
}
