import { KeyNormalizer } from '../KeyNormalizer';

describe('KeyNormalizer', () => {
  let normalizer: KeyNormalizer;

  beforeEach(() => {
    normalizer = new KeyNormalizer();
  });

  describe('normalize', () => {
    it('should normalize simple keys', () => {
      const event = new KeyboardEvent('keydown', { key: 'a' });
      expect(normalizer.normalize(event)).toBe('a');
    });

    it('should normalize with Cmd/Ctrl modifier', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true, // Mac
      });
      const normalized = normalizer.normalize(event);
      expect(normalized).toBe('cmd+enter');
    });

    it('should normalize multiple modifiers', () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        shiftKey: true,
      });
      expect(normalizer.normalize(event)).toBe('cmd+shift+s');
    });

    it('should normalize special keys', () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      expect(normalizer.normalize(event)).toBe('esc');
    });

    it('should handle arrow keys', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      expect(normalizer.normalize(event)).toBe('up');
    });
  });

  describe('parse', () => {
    it('should parse simple key string', () => {
      const parsed = normalizer.parse('enter');
      expect(parsed.key).toBe('enter');
      expect(parsed.modifiers.ctrl).toBe(false);
    });

    it('should parse with modifiers', () => {
      const parsed = normalizer.parse('cmd+shift+s');
      expect(parsed.key).toBe('s');
      expect(parsed.modifiers.shift).toBe(true);
    });

    it('should handle chord sequences', () => {
      const parsed = normalizer.parse('cmd+k cmd+s');
      expect(parsed.sequence).toEqual(['cmd+k', 'cmd+s']);
    });
  });

  describe('isValid', () => {
    it('should validate correct key strings', () => {
      expect(normalizer.isValid('cmd+s')).toBe(true);
      expect(normalizer.isValid('alt+f')).toBe(true);
      expect(normalizer.isValid('escape')).toBe(true);
    });

    it('should reject invalid key strings', () => {
      expect(normalizer.isValid('')).toBe(false);
      expect(normalizer.isValid('cmd+')).toBe(false);
      expect(normalizer.isValid('+++')).toBe(false);
    });
  });

  describe('matches', () => {
    it('should match keyboard event to key string', () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
      });
      expect(normalizer.matches(event, 'cmd+s')).toBe(true);
      expect(normalizer.matches(event, 'cmd+a')).toBe(false);
    });
  });

  describe('toPlatform', () => {
    it('should convert to platform-specific format', () => {
      // Mock Mac platform
      if (normalizer.isMac()) {
        expect(normalizer.toPlatform('cmd+s')).toBe('⌘s');
      } else {
        expect(normalizer.toPlatform('cmd+s')).toBe('Ctrl+s');
      }
    });
  });
});