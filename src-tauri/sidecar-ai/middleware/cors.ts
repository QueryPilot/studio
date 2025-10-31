import { ALLOWED_ORIGINS } from "../config/constants";

/**
 * Validate that request is from localhost only
 * Prevents remote access to the AI sidecar
 */
export function isLocalhost(request: Request): boolean {
  const url = new URL(request.url);
  const hostname = url.hostname;

  // Only allow localhost and 127.0.0.1
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

/**
 * Validate request origin is from allowed sources
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Allow requests without origin (same-origin)

  return ALLOWED_ORIGINS.includes(origin);
}

export function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("origin") || "";

  const corsOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : "tauri://localhost";
  console.log("corsOrigin", corsOrigin);
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, user-agent, accept, authorization, x-requested-with, x-connection-id, x-connection-database, x-connection-schema",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function handlePreflightRequest(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(request) });
  }
  return null;
}

/**
 * Security check middleware - validates localhost and origin
 */
export function validateSecurityHeaders(request: Request): Response | null {
  // Check if request is from localhost
  if (!isLocalhost(request)) {
    console.warn(
      `🚨 Blocked non-localhost request from: ${new URL(request.url).hostname}`,
    );
    return new Response("Forbidden: Only localhost access allowed", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Validate origin for non-OPTIONS requests
  if (request.method !== "OPTIONS" && !isAllowedOrigin(request)) {
    console.warn(
      `🚨 Blocked request from unauthorized origin: ${request.headers.get(
        "origin",
      )}`,
    );
    return new Response("Forbidden: Invalid origin", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return null;
}
