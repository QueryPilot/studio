/**
 * Sentry integration utilities
 *
 * Handles initialization and error capture for crash reporting.
 * Only active in production builds when user opts in via preferences.
 */

import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/react";
import type { TelemetryPreferences } from "@/stores/preferencesStore";


/**
 * Check if Sentry should be initialized based on environment and user preference
 */
export function shouldInitializeSentry(
  telemetryPrefs: TelemetryPreferences,
): boolean {
  // Never initialize in development
  if (import.meta.env.DEV) {
    return false;
  }

  // Only initialize if user has opted in
  return telemetryPrefs.sentryEnabled;
}

/**
 * Initialize Sentry with appropriate configuration
 */
export function initializeSentry(
  telemetryPrefs: TelemetryPreferences,
  appVersion: string,
): void {
  if (!shouldInitializeSentry(telemetryPrefs)) {
    logger.info("[Sentry] Skipping initialization (disabled or dev mode)");
    return;
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    logger.warn(
      "[Sentry] DSN not configured (set VITE_SENTRY_DSN), skipping initialization",
    );
    return;
  }

  try {
    Sentry.init({
      dsn,
      integrations: [
        Sentry.browserTracingIntegration(),
        ...(telemetryPrefs.sessionReplay
          ? [
              Sentry.replayIntegration({
                maskAllText: true, // Privacy: mask all text content
                blockAllMedia: true, // Privacy: block all media
              }),
            ]
          : []),
      ],

      // Performance monitoring
      tracesSampleRate: telemetryPrefs.performanceMonitoring ? 0.1 : 0, // 10% of transactions

      // Session replay settings
      replaysSessionSampleRate: 0, // Don't record normal sessions
      replaysOnErrorSampleRate: telemetryPrefs.sessionReplay ? 0.5 : 0, // 50% of errors

      // Environment and release tracking
      environment: import.meta.env.MODE,
      release: `query-pilot@${appVersion}`,

      // Component tagging for filtering in Sentry
      initialScope: {
        tags: {
          component: "frontend",
          platform: "javascript",
        },
      },

      // Privacy: strip sensitive data before sending
      beforeSend(event) {
        // Remove request bodies that might contain SQL or credentials
        if (event.request?.data) {
          delete event.request.data;
        }

        // Remove cookies
        if (event.request?.cookies) {
          delete event.request.cookies;
        }

        // Sanitize breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
            // Remove SQL queries from breadcrumbs
            if (breadcrumb.message?.includes("SQL")) {
              return {
                ...breadcrumb,
                message: "[SQL query - redacted for privacy]",
              };
            }
            return breadcrumb;
          });
        }

        return event;
      },

      // Ignore certain errors
      ignoreErrors: [
        // Network errors that are expected
        "NetworkError",
        "Failed to fetch",
        // Browser extension errors
        "chrome-extension://",
        "moz-extension://",
      ],
    });

    logger.info("[Sentry] Initialized successfully");
  } catch (error) {
    logger.error("[Sentry] Failed to initialize:", error);
  }
}

/**
 * Capture an exception with Sentry if initialized
 */
export function captureException(
  error: Error,
  context?: {
    operation?: string;
    adapter?: string;
    connectionId?: string;
    [key: string]: unknown;
  },
): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  Sentry.captureException(error, {
    tags: {
      operation: context?.operation,
      adapter: context?.adapter,
    },
    extra: {
      ...context,
      // Remove potentially sensitive data
      connectionId: context?.connectionId ? "redacted" : undefined,
    },
  });
}

/**
 * Add a breadcrumb for debugging context
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}

/**
 * Set user context (use anonymous IDs only)
 */
export function setUserContext(anonymousId: string): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  Sentry.setUser({
    id: anonymousId, // Never send identifying information
  });
}

/**
 * Clear user context (on logout or preference change)
 */
export function clearUserContext(): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  Sentry.setUser(null);
}

/**
 * Disable Sentry by closing the client
 * Called when user disables error tracking in preferences
 */
export function disableSentry(): void {
  if (!Sentry.isInitialized()) {
    logger.info("[Sentry] Already disabled");
    return;
  }

  try {
    const client = Sentry.getClient();
    if (client) {
      client.close(2000); // Wait up to 2 seconds for events to flush
      logger.info("[Sentry] Disabled successfully");
    }
  } catch (error) {
    logger.error("[Sentry] Failed to disable:", error);
  }
}

/**
 * Configure telemetry across all components (Frontend, Backend, AI Sidecar)
 * Call this when user changes preferences or on app startup
 */
export async function configureTelemetryBackend(
  sentryEnabled: boolean,
): Promise<void> {
  // Note: Backend telemetry is configured via environment variables and Cargo features
  // No runtime configuration needed - backend initializes Sentry based on SENTRY_DSN env var
  logger.info(
    `[Sentry] Backend telemetry preference updated: ${sentryEnabled} (requires restart)`,
  );
}
