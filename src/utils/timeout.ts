/**
 * Utility for adding timeouts to promises
 * Prevents hanging operations from freezing the UI
 */

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Wraps a promise with a timeout
 * @param promise The promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param operation Description of the operation (for error message)
 * @returns The promise result or throws TimeoutError
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Wraps a promise with a timeout, returning a default value on timeout instead of throwing
 * Useful for non-critical operations where we want to continue gracefully
 * @param promise The promise to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param defaultValue Value to return on timeout
 * @param operation Description of the operation (for logging)
 * @returns The promise result or defaultValue on timeout
 */
export function withTimeoutDefault<T>(
  promise: Promise<T>,
  timeoutMs: number,
  defaultValue: T,
  operation?: string,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (operation) {
        console.warn(`[Timeout] ${operation} timed out after ${timeoutMs}ms, using default value`);
      }
      resolve(defaultValue);
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(defaultValue);
      });
  });
}
