/**
 * Rate limiting utilities for AI endpoints
 * Implements token bucket algorithm with per-endpoint and global limits
 */

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional: burst limit (extra requests allowed temporarily) */
  burstLimit?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  windowStart: number;
  requestCount: number;
}

// Default rate limits
export const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  // AI generation endpoints (expensive)
  chat: { maxRequests: 100, windowMs: 60_000, burstLimit: 20 },
  "text-to-sql": { maxRequests: 200, windowMs: 60_000, burstLimit: 30 },

  // Tool calls (moderate)
  tool: { maxRequests: 500, windowMs: 60_000 },

  // Metadata endpoints (cheap)
  health: { maxRequests: 2000, windowMs: 60_000 },
  status: { maxRequests: 200, windowMs: 60_000 },

  // Global limit across all endpoints
  global: { maxRequests: 1000, windowMs: 60_000 },
};

class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private limits: Record<string, RateLimitConfig>;

  constructor(limits: Record<string, RateLimitConfig> = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  /**
   * Check if request is allowed and consume a token
   */
  check(endpoint: string, key: string = "default"): RateLimitResult {
    const bucketKey = `${endpoint}:${key}`;
    const config = this.limits[endpoint] || this.limits["global"];

    if (!config) {
      // No limit configured, allow
      return { allowed: true, remaining: Infinity, resetAt: Date.now() };
    }

    const now = Date.now();
    let bucket = this.buckets.get(bucketKey);

    // Initialize or reset bucket if window expired
    if (!bucket || now - bucket.windowStart >= config.windowMs) {
      bucket = {
        tokens: config.maxRequests + (config.burstLimit || 0),
        lastRefill: now,
        windowStart: now,
        requestCount: 0,
      };
      this.buckets.set(bucketKey, bucket);
    }

    // Refill tokens based on time elapsed (for smooth rate limiting)
    const elapsed = now - bucket.lastRefill;
    const refillRate = config.maxRequests / config.windowMs; // tokens per ms
    const tokensToAdd = elapsed * refillRate;
    bucket.tokens = Math.min(
      bucket.tokens + tokensToAdd,
      config.maxRequests + (config.burstLimit || 0)
    );
    bucket.lastRefill = now;

    // Check if we have tokens available
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.requestCount += 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: bucket.windowStart + config.windowMs,
      };
    }

    // Rate limited
    const resetAt = bucket.windowStart + config.windowMs;
    const retryAfterMs = Math.ceil((1 / refillRate) * (1 - bucket.tokens));

    console.warn(
      `⚠️ [RateLimit] ${endpoint} rate limited for ${key}, retry in ${retryAfterMs}ms`
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterMs,
    };
  }

  /**
   * Check global + endpoint limits
   */
  checkWithGlobal(endpoint: string, key: string = "default"): RateLimitResult {
    // Check global limit first
    const globalResult = this.check("global", key);
    if (!globalResult.allowed) {
      return globalResult;
    }

    // Check endpoint-specific limit
    return this.check(endpoint, key);
  }

  /**
   * Get current status for an endpoint
   */
  getStatus(
    endpoint: string,
    key: string = "default"
  ): { requestCount: number; remaining: number; windowResetAt: number } | null {
    const bucketKey = `${endpoint}:${key}`;
    const bucket = this.buckets.get(bucketKey);
    const config = this.limits[endpoint];

    if (!bucket || !config) {
      return null;
    }

    return {
      requestCount: bucket.requestCount,
      remaining: Math.floor(bucket.tokens),
      windowResetAt: bucket.windowStart + config.windowMs,
    };
  }

  /**
   * Reset limits for an endpoint
   */
  reset(endpoint: string, key: string = "default"): void {
    const bucketKey = `${endpoint}:${key}`;
    this.buckets.delete(bucketKey);
  }

  /**
   * Reset all limits
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Update limits dynamically
   */
  updateLimits(newLimits: Partial<Record<string, RateLimitConfig>>): void {
    this.limits = { ...this.limits, ...newLimits };
  }

  /**
   * Get all current limits configuration
   */
  getLimits(): Record<string, RateLimitConfig> {
    return { ...this.limits };
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Rate limit middleware for request handlers
 */
export function withRateLimit<T>(
  endpoint: string,
  handler: (request: Request) => Promise<T>,
  getKey?: (request: Request) => string
): (request: Request) => Promise<T | Response> {
  return async (request: Request): Promise<T | Response> => {
    const key = getKey?.(request) || request.headers.get("X-Connection-Id") || "anonymous";
    const result = rateLimiter.checkWithGlobal(endpoint, key);

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfterMs: result.retryAfterMs,
          resetAt: new Date(result.resetAt).toISOString(),
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": Math.ceil((result.retryAfterMs || 1000) / 1000).toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
            "X-RateLimit-Reset": result.resetAt.toString(),
          },
        }
      );
    }

    return handler(request);
  };
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(
  response: Response,
  endpoint: string,
  key: string = "default"
): Response {
  const status = rateLimiter.getStatus(endpoint, key);
  if (status) {
    response.headers.set("X-RateLimit-Remaining", status.remaining.toString());
    response.headers.set("X-RateLimit-Reset", status.windowResetAt.toString());
  }
  return response;
}
