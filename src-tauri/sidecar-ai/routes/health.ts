import { getCorsHeaders } from "../middleware/cors";

export function handleHealth(request: Request): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
}
