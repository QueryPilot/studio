/**
 * Batch processing utilities for limiting concurrent operations
 */

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items in batches with limited concurrency and retry logic.
 * Useful for avoiding overwhelming database connection pools.
 *
 * @param items - Array of items to process
 * @param fn - Async function to process each item
 * @param concurrency - Maximum number of concurrent operations (default: 5)
 * @param retries - Number of retries per item on failure (default: 2)
 * @returns Array of results in the same order as input items
 */
export async function batchWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
  retries = 2,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function processWithRetry(item: T, index: number): Promise<R> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(item, index);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Only retry on connection/timeout errors, not on data errors
        const isRetryable =
          lastError.message.includes("timed out") ||
          lastError.message.includes("connection") ||
          lastError.message.includes("timeout") ||
          lastError.message.includes("ECONNRESET") ||
          lastError.message.includes("Operation timed out");
        if (!isRetryable || attempt === retries) {
          throw lastError;
        }
        // Exponential backoff: 500ms, 1000ms, 2000ms...
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    throw lastError;
  }

  async function processNext(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await processWithRetry(item, index);
      }
    }
  }

  // Start workers up to concurrency limit
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => processNext(),
  );

  await Promise.all(workers);
  return results;
}
