import { PORT } from "./config/constants";
import {
  handlePreflightRequest,
  getCorsHeaders,
  validateSecurityHeaders,
} from "./middleware/cors";
import { routes } from "./routes";

// Route configuration with methods
const routeConfig: Record<string, { method: string; handler: (req: Request) => Response | Promise<Response> }> = {
  "/health": { method: "GET", handler: routes["/health"] },
  "/status": { method: "GET", handler: routes["/status"] },
  "/config": { method: "POST", handler: routes["/config"] },
  "/providers": { method: "GET", handler: routes["/providers"] },
  "/chat": { method: "POST", handler: routes["/chat"] },
};

// HTTP server using Bun's built-in server
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Security validation
    const securityError = validateSecurityHeaders(req);
    if (securityError) {
      return securityError;
    }

    // Handle preflight requests
    const preflightResponse = handlePreflightRequest(req);
    if (preflightResponse) {
      return preflightResponse;
    }

    // Route matching
    const route = routeConfig[url.pathname];
    if (route && req.method === route.method) {
      return route.handler(req);
    }

    // 404 handler
    return new Response("Not Found", {
      status: 404,
      headers: getCorsHeaders(req),
    });
  },
});

console.log(`AI Sidecar server running on http://localhost:${PORT}`);
