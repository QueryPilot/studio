import { describe, it, expect } from 'vitest';
import {
  createCellKey,
  parseCellKey,
  isValidTransition,
} from './cellState';

describe('createCellKey', () => {
  it('creates a cell key from components', () => {
    const key = createCellKey('conn:db:schema:table', 5, 'name');
    expect(key).toBe('conn:db:schema:table:5:name');
  });

  it('handles table keys with colons', () => {
    const key = createCellKey('a:b:c:d', 0, 'field');
    expect(key).toBe('a:b:c:d:0:field');
  });
});

describe('parseCellKey', () => {
  it('parses a cell key into components', () => {
    const result = parseCellKey('conn:db:schema:table:5:name');
    expect(result).toEqual({
      tableKey: 'conn:db:schema:table',
      rowIndex: 5,
      columnField: 'name',
    });
  });

  it('returns null for invalid keys', () => {
    expect(parseCellKey('invalid')).toBeNull();
    expect(parseCellKey('a:b')).toBeNull();
    expect(parseCellKey('a:notanumber:c')).toBeNull();
  });
});

describe('isValidTransition', () => {
  it('allows FOCUS from idle', () => {
    expect(isValidTransition('idle', 'FOCUS')).toBe(true);
  });

  it('disallows START_EDIT from idle', () => {
    expect(isValidTransition('idle', 'START_EDIT')).toBe(false);
  });

  it('allows START_EDIT from focused', () => {
    expect(isValidTransition('focused', 'START_EDIT')).toBe(true);
  });

  it('allows CANCEL_EDIT from editing', () => {
    expect(isValidTransition('editing', 'CANCEL_EDIT')).toBe(true);
  });

  it('allows COMMIT_START from dirty', () => {
    expect(isValidTransition('dirty', 'COMMIT_START')).toBe(true);
  });
});
