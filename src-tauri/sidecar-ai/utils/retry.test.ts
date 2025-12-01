/**
 * Tests for retry utility
 */

import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test";
import { withRetry, isTransientError, makeRetryable, withToolRetry } from "./retry";

describe("isTransientError", () => {
  it("should return true for fetch failed errors", () => {
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
    expect(isTransientError(new Error("FETCH FAILED: network issue"))).toBe(true);
  });

  it("should return true for network errors", () => {
    expect(isTransientError(new Error("network error"))).toBe(true);
    expect(isTransientError(new Error("Network unavailable"))).toBe(true);
  });

  it("should return true for connection errors", () => {
    expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
  });

  it("should return true for timeout errors", () => {
    expect(isTransientError(new Error("timeout waiting for response"))).toBe(true);
    expect(isTransientError(new Error("Request TIMEOUT"))).toBe(true);
  });

  it("should return true for temporarily unavailable", () => {
    expect(isTransientError(new Error("service temporarily unavailable"))).toBe(true);
  });

  it("should return false for invalid errors", () => {
    expect(isTransientError(new Error("invalid input"))).toBe(false);
    expect(isTransientError(new Error("INVALID_TOKEN"))).toBe(false);
  });

  it("should return false for forbidden errors", () => {
    expect(isTransientError(new Error("forbidden access"))).toBe(false);
    expect(isTransientError(new Error("403 Forbidden"))).toBe(false);
  });

  it("should return false for not found errors", () => {
    expect(isTransientError(new Error("resource not found"))).toBe(false);
    expect(isTransientError(new Error("404 Not Found"))).toBe(false);
  });

  it("should return false for unauthorized errors", () => {
    expect(isTransientError(new Error("unauthorized request"))).toBe(false);
    expect(isTransientError(new Error("401 Unauthorized"))).toBe(false);
  });

  it("should return true for unknown error types (default behavior)", () => {
    expect(isTransientError(new Error("some random error"))).toBe(true);
    expect(isTransientError("string error")).toBe(true);
    expect(isTransientError({ code: "UNKNOWN" })).toBe(true);
  });
});

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = mock(() => Promise.resolve("success"));

    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on transient failure", async () => {
    let attempts = 0;
    const fn = mock(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve("success");
    });

    const result = await withRetry(fn, {
      initialDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after max attempts", async () => {
    const fn = mock(() => Promise.reject(new Error("network error")));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      })
    ).rejects.toThrow("network error");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should not retry non-retryable errors", async () => {
    const fn = mock(() => Promise.reject(new Error("invalid input")));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
      })
    ).rejects.toThrow("invalid input");

    // Should only try once since "invalid" errors are not retryable
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should use custom isRetryable function", async () => {
    let attempts = 0;
    const fn = mock(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("custom retry"));
      }
      return Promise.resolve("success");
    });

    const result = await withRetry(fn, {
      initialDelayMs: 10,
      isRetryable: (error) =>
        error instanceof Error && error.message.includes("custom retry"),
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should call onRetry callback on each retry", async () => {
    let attempts = 0;
    const fn = mock(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve("success");
    });

    const onRetry = mock((_attempt: number, _error: unknown, _delayMs: number) => {});

    await withRetry(fn, {
      initialDelayMs: 10,
      maxDelayMs: 50,
      onRetry,
    });

    // onRetry should be called twice (after attempt 1 and 2, before retry)
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1); // First retry attempt number
    expect(onRetry.mock.calls[1][0]).toBe(2); // Second retry attempt number
  });

  it("should apply exponential backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fn = mock(() => {
      attempts++;
      if (attempts < 4) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve("success");
    });

    await withRetry(fn, {
      maxAttempts: 5,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      maxDelayMs: 1000,
      onRetry: (_attempt, _error, delayMs) => {
        delays.push(delayMs);
      },
    });

    expect(delays.length).toBe(3);
    // First delay should be ~100ms (initial)
    expect(delays[0]).toBe(100);
    // Subsequent delays should increase (with jitter)
    expect(delays[1]).toBeGreaterThan(100);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it("should cap delay at maxDelayMs", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fn = mock(() => {
      attempts++;
      if (attempts < 6) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve("success");
    });

    await withRetry(fn, {
      maxAttempts: 6,
      initialDelayMs: 100,
      backoffMultiplier: 3,
      maxDelayMs: 200,
      onRetry: (_attempt, _error, delayMs) => {
        delays.push(delayMs);
      },
    });

    // All delays after initial should be capped
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(200);
    }
  });

  it("should respect default options", async () => {
    let attempts = 0;
    const fn = mock(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve("success");
    });

    // Use defaults (3 attempts, 100ms initial delay)
    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("makeRetryable", () => {
  it("should create a retryable version of a function", async () => {
    let attempts = 0;
    const fn = async (x: number) => {
      attempts++;
      if (attempts < 2) {
        throw new Error("network error");
      }
      return x * 2;
    };

    const retryableFn = makeRetryable(fn, { initialDelayMs: 10 });
    const result = await retryableFn(5);

    expect(result).toBe(10);
    expect(attempts).toBe(2);
  });

  it("should preserve function arguments", async () => {
    const fn = async (a: number, b: string, c: boolean) => {
      return { a, b, c };
    };

    const retryableFn = makeRetryable(fn);
    const result = await retryableFn(1, "hello", true);

    expect(result).toEqual({ a: 1, b: "hello", c: true });
  });
});

describe("withToolRetry", () => {
  it("should return success result on success", async () => {
    const execute = async (input: { query: string }) => ({
      success: true as const,
      data: input.query.toUpperCase(),
    });

    const retryableExecute = withToolRetry(execute);
    const result = await retryableExecute({ query: "test" });

    expect(result).toEqual({ success: true, data: "TEST" });
  });

  it("should return structured error on failure", async () => {
    const execute = async (_input: { query: string }) => {
      throw new Error("invalid query");
    };

    const retryableExecute = withToolRetry(execute, { maxAttempts: 1 });
    const result = await retryableExecute({ query: "bad query" });

    expect(result).toEqual({
      success: false,
      error: "invalid query",
      retried: false,
    });
  });

  it("should indicate when retries occurred", async () => {
    let attempts = 0;
    const execute = async (_input: { query: string }) => {
      attempts++;
      if (attempts < 3) {
        throw new Error("network error");
      }
      return { success: true as const, data: "ok" };
    };

    const retryableExecute = withToolRetry(execute, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });
    const result = await retryableExecute({ query: "test" });

    expect(result).toEqual({ success: true, data: "ok" });
    expect(attempts).toBe(3);
  });

  it("should indicate retried=true on failure after retries", async () => {
    const execute = async (_input: { query: string }) => {
      throw new Error("network error");
    };

    const retryableExecute = withToolRetry(execute, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });
    const result = await retryableExecute({ query: "test" });

    expect(result).toEqual({
      success: false,
      error: "network error",
      retried: true,
    });
  });

  it("should handle non-Error exceptions", async () => {
    const execute = async (_input: { query: string }) => {
      throw "string error";
    };

    const retryableExecute = withToolRetry(execute, { maxAttempts: 1 });
    const result = await retryableExecute({ query: "test" });

    expect(result).toEqual({
      success: false,
      error: "Unknown error",
      retried: false,
    });
  });

  it("should call custom onRetry from options", async () => {
    let attempts = 0;
    const customOnRetry = mock((_attempt: number, _error: unknown, _delayMs: number) => {});

    const execute = async (_input: { query: string }) => {
      attempts++;
      if (attempts < 2) {
        throw new Error("network error");
      }
      return { success: true as const };
    };

    const retryableExecute = withToolRetry(execute, {
      initialDelayMs: 10,
      onRetry: customOnRetry,
    });
    await retryableExecute({ query: "test" });

    expect(customOnRetry).toHaveBeenCalledTimes(1);
  });
});
