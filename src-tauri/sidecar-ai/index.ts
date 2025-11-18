import { PORT } from "./config/constants";
import {
  handlePreflightRequest,
  getCorsHeaders,
  validateSecurityHeaders,
} from "./middleware/cors";
import { routes } from "./routes";
import { captureException as sentryCaptureException } from "./utils/sentry";

// Route configuration with methods
const routeConfig: Record<
  string,
  { method: string; handler: (req: Request) => Response | Promise<Response> }
> = {
  "/health": { method: "GET", handler: routes["/health"] },
  "/status": { method: "GET", handler: routes["/status"] },
  "/config": { method: "POST", handler: routes["/config"] },
  "/providers": { method: "GET", handler: routes["/providers"] },
  "/chat": { method: "POST", handler: routes["/chat"] },
};

// HTTP server using Bun's built-in server
// @ts-ignore
const server = Bun.serve({
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

console.log(`✅ AI Sidecar server running on http://localhost:${PORT}`);

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log("⚠️  Shutdown already in progress...");
    return;
  }

  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);

  try {
    // Stop accepting new connections
    server.stop();
    console.log("✓ Server stopped accepting new connections");

    // Give in-flight requests time to complete (max 5 seconds)
    console.log("⏳ Waiting for in-flight requests to complete...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("✅ Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
}

// Handle termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught exception:", error);
  sentryCaptureException(error, { operation: "uncaughtException" });
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled rejection at:", promise, "reason:", reason);
  if (reason instanceof Error) {
    sentryCaptureException(reason, { operation: "unhandledRejection" });
  }
  gracefulShutdown("unhandledRejection");
});
