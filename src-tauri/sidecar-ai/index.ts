import { PORT } from "./config/constants";
import {
  handlePreflightRequest,
  getCorsHeaders,
  validateSecurityHeaders,
} from "./middleware/cors";
import { routes } from "./routes";
import { captureException as sentryCaptureException } from "./utils/sentry";
import { registry } from "./tools/registry";
import { sqlTools } from "./tools/sql";
import { documentTools } from "./tools/document";
import { keyvalueTools } from "./tools/keyvalue";
import { generateSuggestions } from "./services/suggestions";
import type { WorkspaceContext } from "./types";

// Initialize tool registry
console.log("⚙️  Initializing tool registry...");

// Register SQL tools
for (const tool of sqlTools) {
  registry.register(tool);
  console.log(`  ✓ Registered SQL tool: ${tool.name} (${tool.capabilities.join(", ")})`);
}

// Register Document tools
for (const tool of documentTools) {
  registry.register(tool);
  console.log(`  ✓ Registered Document tool: ${tool.name} (${tool.capabilities.join(", ")})`);
}

// Register Key-Value tools
for (const tool of keyvalueTools) {
  registry.register(tool);
  console.log(`  ✓ Registered Key-Value tool: ${tool.name} (${tool.capabilities.join(", ")})`);
}

console.log(`✅ Tool registry initialized with ${registry.getAll().length} tools`);

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
  "/text-to-sql": { method: "POST", handler: routes["/text-to-sql"] },
  "/openrouter-models": { method: "GET", handler: routes["/openrouter-models"] },
  "/tools": {
    method: "GET",
    handler: (req: Request) => {
      const stats = registry.stats();
      return new Response(
        JSON.stringify(
          {
            tools: registry.getAll().map((t) => ({
              name: t.name,
              friendlyName: t.friendlyName,
              description: t.description,
              category: t.category,
              capabilities: t.capabilities,
            })),
            stats,
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(req),
          },
        }
      );
    },
  },
  "/suggestions": {
    method: "POST",
    handler: async (req: Request) => {
      try {
        const body = await req.json();
        const context = body.context as WorkspaceContext;

        const suggestions = generateSuggestions(context);

        return new Response(
          JSON.stringify({ suggestions }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...getCorsHeaders(req),
            },
          }
        );
      } catch (error) {
        console.error("Error generating suggestions:", error);
        return new Response(
          JSON.stringify({ error: "Failed to generate suggestions" }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...getCorsHeaders(req),
            },
          }
        );
      }
    },
  },
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
