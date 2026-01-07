import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldTriggerCompletion, DeferredCompletionState } from './deferred-completion';

describe('shouldTriggerCompletion', () => {
  it('should trigger on dot', () => {
    expect(shouldTriggerCompletion('.', 'users')).toBe(true);
  });

  it('should trigger after FROM keyword', () => {
    expect(shouldTriggerCompletion(' ', 'SELECT * FROM')).toBe(true);
  });

  it('should trigger after JOIN keyword', () => {
    expect(shouldTriggerCompletion(' ', 'FROM users JOIN')).toBe(true);
  });

  it('should NOT trigger on regular typing', () => {
    expect(shouldTriggerCompletion('e', 'SELECT nam')).toBe(false);
  });

  it('should trigger on explicit activation (empty)', () => {
    expect(shouldTriggerCompletion('', '', true)).toBe(true);
  });

  it('should trigger after SELECT keyword', () => {
    expect(shouldTriggerCompletion(' ', 'SELECT')).toBe(true);
  });

  it('should trigger after WHERE keyword', () => {
    expect(shouldTriggerCompletion(' ', 'FROM users WHERE')).toBe(true);
  });

  it('should trigger after ON keyword', () => {
    expect(shouldTriggerCompletion(' ', 'JOIN orders ON')).toBe(true);
  });

  it('should trigger on single quote for string completion', () => {
    expect(shouldTriggerCompletion("'", "WHERE status = ")).toBe(true);
  });

  it('should trigger on double quote', () => {
    expect(shouldTriggerCompletion('"', 'SELECT ')).toBe(true);
  });

  it('should trigger on arrow operator (->)', () => {
    expect(shouldTriggerCompletion('>', 'data-')).toBe(true);
  });

  it('should NOT trigger on random characters', () => {
    expect(shouldTriggerCompletion('x', 'SELECT ')).toBe(false);
  });

  it('should NOT trigger on space without keyword', () => {
    expect(shouldTriggerCompletion(' ', 'SELECT name')).toBe(false);
  });
});

describe('DeferredCompletionState', () => {
  let state: DeferredCompletionState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new DeferredCompletionState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should deduplicate in-flight requests', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['result']);

    const promise1 = state.fetch('key1', fetchFn);
    const promise2 = state.fetch('key1', fetchFn);

    await vi.runAllTimersAsync();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await promise1).toEqual(await promise2);
  });

  it('should cache results within TTL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['cached-result']);

    await state.fetch('key2', fetchFn);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await state.fetch('key2', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['cached-result']);
  });

  it('should refetch after cache TTL expires', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(['first'])
      .mockResolvedValueOnce(['second']);

    await state.fetch('key3', fetchFn);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await state.fetch('key3', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual(['second']);
  });

  it('should handle fetch errors gracefully', async () => {
    const error = new Error('Fetch failed');
    const fetchFn = vi.fn().mockRejectedValue(error);

    await expect(state.fetch('key4', fetchFn)).rejects.toThrow('Fetch failed');
    expect(state['inFlight'].has('key4')).toBe(false);
  });

  it('should invalidate specific cache key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['data']);

    await state.fetch('key5', fetchFn);
    state.invalidate('key5');
    await state.fetch('key5', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('should invalidate all cache entries', async () => {
    const fetchFn1 = vi.fn().mockResolvedValue(['data1']);
    const fetchFn2 = vi.fn().mockResolvedValue(['data2']);

    await state.fetch('key6', fetchFn1);
    await state.fetch('key7', fetchFn2);
    state.invalidate();
    await state.fetch('key6', fetchFn1);
    await state.fetch('key7', fetchFn2);

    expect(fetchFn1).toHaveBeenCalledTimes(2);
    expect(fetchFn2).toHaveBeenCalledTimes(2);
  });
});
