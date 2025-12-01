/**
 * Retry utility for handling transient failures in tool executions
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 2000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
  /** Callback when a retry is attempted */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry" | "isRetryable">> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

/**
 * Default retryable error checker
 * Retries on network errors and timeouts, not on validation errors
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network/connection errors
    if (
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("timeout") ||
      message.includes("temporarily unavailable")
    ) {
      return true;
    }
    // Don't retry validation or user errors
    if (
      message.includes("invalid") ||
      message.includes("forbidden") ||
      message.includes("not found") ||
      message.includes("unauthorized")
    ) {
      return false;
    }
  }
  return true; // Default to retrying unknown errors
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    initialDelayMs = DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    isRetryable = isTransientError,
    onRetry,
  } = options;

  let lastError: unknown;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, error, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      // Exponential backoff with jitter
      const jitter = Math.random() * 0.2 * delayMs; // 20% jitter
      delayMs = Math.min(delayMs * backoffMultiplier + jitter, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Retry decorator for tool execute functions
 * Returns a wrapper that catches errors and returns them in a structured format
 */
export function withToolRetry<TInput, TOutput>(
  execute: (input: TInput) => Promise<TOutput>,
  options: RetryOptions = {}
): (input: TInput) => Promise<TOutput | { success: false; error: string; retried: boolean }> {
  return async (input: TInput) => {
    let retried = false;
    try {
      return await withRetry(() => execute(input), {
        ...options,
        onRetry: (attempt, error, delayMs) => {
          retried = true;
          console.log(
            `🔄 [Retry] Attempt ${attempt} failed, retrying in ${delayMs}ms:`,
            error instanceof Error ? error.message : error
          );
          options.onRetry?.(attempt, error, delayMs);
        },
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        retried,
      };
    }
  };
}
