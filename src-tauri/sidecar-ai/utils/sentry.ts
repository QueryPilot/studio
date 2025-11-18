/**
 * Sentry integration for AI Sidecar
 *
 * Handles crash reporting and error tracking for the AI sidecar process.
 * Only active when user opts in via preferences.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initialize Sentry for error tracking
 */
export function initializeSentry(
  enabled: boolean,
  dsn: string | undefined,
  version: string,
): void {
  // Don't initialize if already initialized
  if (initialized) {
    console.log("[Sentry] Already initialized, skipping");
    return;
  }

  // Only initialize if user has opted in
  if (!enabled) {
    console.log("[Sentry] Skipping initialization (user opted out)");
    return;
  }

  // Validate DSN
  if (!dsn || dsn.trim() === "") {
    console.warn("[Sentry] DSN not configured, skipping initialization");
    return;
  }

  try {
    Sentry.init({
      dsn,
      release: `qp-ai-sidecar@${version}`,
      environment: process.env.NODE_ENV || "production",
      tracesSampleRate: 0.1, // 10% of performance traces

      beforeSend(event) {
        // Sanitize sensitive data
        sanitizeEvent(event);
        return event;
      },

      integrations: [
        Sentry.httpIntegration(),
      ],
    });

    // Set tags for filtering in Sentry
    Sentry.setTag("component", "sidecar");
    Sentry.setTag("platform", "node");
    Sentry.setTag("os", process.platform);
    Sentry.setTag("arch", process.arch);
    Sentry.setTag("node_version", process.version);

    initialized = true;
    console.log("[Sentry] Initialized successfully");
  } catch (error) {
    console.error("[Sentry] Failed to initialize:", error);
  }
}

/**
 * Sanitize event data to remove sensitive information
 */
function sanitizeEvent(event: Sentry.Event): void {
  // Remove request data (might contain user messages or API keys)
  if (event.request) {
    event.request.data = undefined;
    event.request.cookies = undefined;
    event.request.headers = undefined;
  }

  // Sanitize breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      // Remove data from breadcrumbs that might contain sensitive info
      if (breadcrumb.message) {
        if (
          breadcrumb.message.toLowerCase().includes("api_key") ||
          breadcrumb.message.toLowerCase().includes("token") ||
          breadcrumb.message.toLowerCase().includes("password") ||
          breadcrumb.message.toLowerCase().includes("secret")
        ) {
          return {
            ...breadcrumb,
            message: "[REDACTED - sensitive data]",
            data: undefined,
          };
        }
      }

      // Always clear data field to be safe
      return {
        ...breadcrumb,
        data: undefined,
      };
    });
  }

  // Sanitize extra data
  if (event.extra) {
    const keysToRemove = Object.keys(event.extra).filter(
      (key) =>
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("credential"),
    );

    for (const key of keysToRemove) {
      delete event.extra[key];
    }
  }
}

/**
 * Capture an exception with Sentry if initialized
 */
export function captureException(
  error: Error,
  context?: {
    operation?: string;
    provider?: string;
    [key: string]: unknown;
  },
): void {
  if (!initialized) {
    return;
  }

  Sentry.captureException(error, {
    tags: {
      operation: context?.operation,
      provider: context?.provider,
    },
    extra: {
      ...context,
      // Remove provider-specific data that might be sensitive
      provider: context?.provider || "unknown",
    },
  });
}

/**
 * Add a breadcrumb for debugging context
 */
export function addBreadcrumb(
  message: string,
  category: string,
): void {
  if (!initialized) {
    return;
  }

  Sentry.addBreadcrumb({
    message,
    category,
    level: "info",
  });
}

/**
 * Check if Sentry is initialized
 */
export function isInitialized(): boolean {
  return initialized;
}
