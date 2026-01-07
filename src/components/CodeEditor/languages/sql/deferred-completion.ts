import type { CompletionContext } from '@codemirror/autocomplete';

const TRIGGER_KEYWORDS = [
  'FROM',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'ON',
  'WHERE',
  'AND',
  'OR',
  'SET',
  'INTO',
  'VALUES',
  'SELECT',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UPDATE',
  'DELETE',
  'INSERT',
];

/**
 * Determines if completion should be triggered based on the typed character
 * and the text before the cursor. This enables smart completion that only
 * activates on meaningful keypresses instead of every character.
 *
 * @param typed - The character just typed
 * @param textBefore - Text before the cursor position
 * @param explicit - Whether completion was explicitly requested (Ctrl+Space)
 * @returns true if completion should be triggered
 */
export function shouldTriggerCompletion(
  typed: string,
  textBefore: string,
  explicit = false
): boolean {
  if (explicit) return true;

  if (typed === '.') return true;

  if (typed === ' ') {
    const upperBefore = textBefore.toUpperCase().trim();
    for (const keyword of TRIGGER_KEYWORDS) {
      if (upperBefore.endsWith(keyword)) return true;
    }
  }

  if (typed === "'" || typed === '"') return true;

  if (typed === '>' && textBefore.endsWith('-')) return true;

  return false;
}

interface CacheEntry<T> {
  result: T;
  timestamp: number;
}

/**
 * Manages deferred completion state including request deduplication and caching.
 * Prevents redundant fetches by tracking in-flight requests and caching results
 * with a configurable TTL.
 */
export class DeferredCompletionState {
  private inFlight = new Map<string, Promise<unknown>>();
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly cacheTTL = 5000;

  /**
   * Fetches completion data with deduplication and caching.
   * Multiple calls with the same key will share a single in-flight request.
   *
   * @param key - Unique cache key for the request
   * @param fetchFn - Function to fetch completion data
   * @returns Promise resolving to the fetched data
   */
  async fetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result as T;
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fetchFn()
      .then((result) => {
        this.cache.set(key, { result, timestamp: Date.now() });
        this.inFlight.delete(key);
        return result;
      })
      .catch((err) => {
        this.inFlight.delete(key);
        throw err;
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Invalidates cached entries. If no key is provided, clears entire cache.
   *
   * @param key - Optional specific key to invalidate
   */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

export const deferredState = new DeferredCompletionState();

/**
 * Generates a unique cache key for a completion context based on cursor
 * position and text before cursor.
 *
 * @param ctx - CodeMirror completion context
 * @returns Unique string key for caching
 */
export function getCompletionKey(ctx: CompletionContext): string {
  const line = ctx.state.doc.lineAt(ctx.pos);
  return `${ctx.pos}:${line.text.slice(0, ctx.pos - line.from)}`;
}
