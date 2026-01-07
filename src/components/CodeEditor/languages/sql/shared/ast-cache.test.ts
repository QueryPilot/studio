import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AstCache } from './ast-cache';

describe('AstCache', () => {
  let cache: AstCache;

  beforeEach(() => {
    cache = new AstCache();
  });

  it('should cache derived data for document version', () => {
    const docId = 'test-doc';
    const version = 1;
    const data = { tables: ['users'], columns: ['id', 'name'] };
    cache.set(docId, version, data);
    expect(cache.get(docId, version)).toEqual(data);
  });

  it('should invalidate on version change', () => {
    const docId = 'test-doc';
    cache.set(docId, 1, { tables: ['old'], columns: [] });
    expect(cache.get(docId, 2)).toBeNull();
  });

  it('should return null for missing entries', () => {
    expect(cache.get('missing', 1)).toBeNull();
  });

  it('should invalidate specific document', () => {
    cache.set('doc1', 1, { tables: ['t1'], columns: [] });
    cache.set('doc2', 1, { tables: ['t2'], columns: [] });
    cache.invalidate('doc1');
    expect(cache.get('doc1', 1)).toBeNull();
    expect(cache.get('doc2', 1)).toEqual({ tables: ['t2'], columns: [] });
  });

  it('should clear all entries', () => {
    cache.set('doc1', 1, { tables: ['t1'], columns: [] });
    cache.set('doc2', 1, { tables: ['t2'], columns: [] });
    cache.clear();
    expect(cache.get('doc1', 1)).toBeNull();
    expect(cache.get('doc2', 1)).toBeNull();
  });

  it('should expire entries after maxAge', () => {
    vi.useFakeTimers();
    cache.set('doc', 1, { tables: ['t'], columns: [] });
    expect(cache.get('doc', 1)).not.toBeNull();
    vi.advanceTimersByTime(31000); // 31 seconds
    expect(cache.get('doc', 1)).toBeNull();
    vi.useRealTimers();
  });

  it('should store complex data with ctes and aliases', () => {
    const data = {
      tables: ['users', 'orders'],
      columns: ['id', 'name', 'order_id'],
      ctes: ['user_summary', 'order_totals'],
      aliases: new Map([['u', 'users'], ['o', 'orders']]),
    };
    cache.set('complex-doc', 5, data);
    const retrieved = cache.get('complex-doc', 5);
    expect(retrieved).toEqual(data);
    expect(retrieved?.ctes).toEqual(['user_summary', 'order_totals']);
    expect(retrieved?.aliases?.get('u')).toBe('users');
  });
});
