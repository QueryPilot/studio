import { ChordManager } from '../ChordManager';

describe('ChordManager', () => {
  let manager: ChordManager;

  beforeEach(() => {
    manager = new ChordManager();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('startChord', () => {
    test('starts a chord sequence', () => {
      manager.startChord('cmd+k');

      expect(manager.getPrefix()).toBe('cmd+k');
      expect(manager.isWaitingForChord()).toBe(true);
    });

    test('notifies listeners when chord starts', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.startChord('cmd+k');

      expect(listener).toHaveBeenCalledWith('cmd+k');
    });

    test('clears previous chord when starting new one', () => {
      manager.startChord('cmd+k');
      manager.startChord('cmd+j');

      expect(manager.getPrefix()).toBe('cmd+j');
    });
  });

  describe('completeChord', () => {
    test('completes chord sequence and returns combined string', () => {
      manager.startChord('cmd+k');
      const result = manager.completeChord('left');

      expect(result).toBe('cmd+k left');
      expect(manager.isWaitingForChord()).toBe(false);
      expect(manager.getPrefix()).toBeNull();
    });

    test('returns null if no chord in progress', () => {
      const result = manager.completeChord('left');

      expect(result).toBeNull();
    });

    test('notifies listeners when chord completes', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.startChord('cmd+k');
      listener.mockClear(); // Clear the start notification

      manager.completeChord('left');

      expect(listener).toHaveBeenCalledWith(null);
    });
  });

  describe('clearChord', () => {
    test('clears chord state', () => {
      manager.startChord('cmd+k');
      manager.clearChord();

      expect(manager.getPrefix()).toBeNull();
      expect(manager.isWaitingForChord()).toBe(false);
    });

    test('notifies listeners when chord clears', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.startChord('cmd+k');
      listener.mockClear();

      manager.clearChord();

      expect(listener).toHaveBeenCalledWith(null);
    });

    test('does not notify if no chord was active', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.clearChord();

      expect(listener).not.toHaveBeenCalled();
    });

    test('clears timeout when clearing chord', () => {
      manager.startChord('cmd+k');
      manager.clearChord();

      // Advance time to when timeout would have fired
      jest.advanceTimersByTime(1000);

      // Should still be null (timeout was cleared)
      expect(manager.getPrefix()).toBeNull();
    });
  });

  describe('timeout behavior', () => {
    test('times out after 1 second', () => {
      manager.startChord('cmd+k');

      // Advance time by 1 second
      jest.advanceTimersByTime(1000);

      expect(manager.isWaitingForChord()).toBe(false);
      expect(manager.getPrefix()).toBeNull();
    });

    test('notifies listeners on timeout', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.startChord('cmd+k');
      listener.mockClear();

      jest.advanceTimersByTime(1000);

      expect(listener).toHaveBeenCalledWith(null);
    });

    test('does not timeout if chord is completed before timeout', () => {
      manager.startChord('cmd+k');

      // Complete before timeout
      jest.advanceTimersByTime(500);
      manager.completeChord('left');

      // Advance past original timeout
      jest.advanceTimersByTime(600);

      // Should not have any issues
      expect(manager.getPrefix()).toBeNull();
    });

    test('does not timeout after 999ms', () => {
      manager.startChord('cmd+k');

      jest.advanceTimersByTime(999);

      expect(manager.isWaitingForChord()).toBe(true);
      expect(manager.getPrefix()).toBe('cmd+k');
    });
  });

  describe('getElapsedTime', () => {
    test('returns 0 when no chord is active', () => {
      expect(manager.getElapsedTime()).toBe(0);
    });

    test('returns time elapsed since chord started', () => {
      manager.startChord('cmd+k');

      jest.advanceTimersByTime(250);

      const elapsed = manager.getElapsedTime();
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(300);
    });

    test('returns 0 after chord completes', () => {
      manager.startChord('cmd+k');
      jest.advanceTimersByTime(250);
      manager.completeChord('left');

      expect(manager.getElapsedTime()).toBe(0);
    });
  });

  describe('subscribe/unsubscribe', () => {
    test('allows subscribing to chord state changes', () => {
      const listener = jest.fn();
      manager.subscribe(listener);

      manager.startChord('cmd+k');
      manager.clearChord();

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, 'cmd+k');
      expect(listener).toHaveBeenNthCalledWith(2, null);
    });

    test('returns unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = manager.subscribe(listener);

      manager.startChord('cmd+k');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      listener.mockClear();

      manager.startChord('cmd+j');
      expect(listener).not.toHaveBeenCalled();
    });

    test('handles listener errors gracefully', () => {
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      manager.subscribe(errorListener);
      manager.startChord('cmd+k');

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(manager.getPrefix()).toBe('cmd+k'); // State should not be affected

      consoleErrorSpy.mockRestore();
    });
  });

  describe('reset', () => {
    test('clears all state and listeners', () => {
      const listener = jest.fn();
      manager.subscribe(listener);
      manager.startChord('cmd+k');

      manager.reset();

      expect(manager.getPrefix()).toBeNull();
      expect(manager.isWaitingForChord()).toBe(false);

      // Listener should be removed
      manager.startChord('cmd+j');
      expect(listener).toHaveBeenCalledTimes(1); // Only the initial call before reset
    });
  });

  describe('edge cases', () => {
    test('handles rapid chord starts', () => {
      manager.startChord('cmd+k');
      manager.startChord('cmd+j');
      manager.startChord('cmd+h');

      expect(manager.getPrefix()).toBe('cmd+h');
    });

    test('handles completing chord with empty suffix', () => {
      manager.startChord('cmd+k');
      const result = manager.completeChord('');

      expect(result).toBe('cmd+k ');
      expect(manager.isWaitingForChord()).toBe(false);
    });

    test('handles special characters in prefix', () => {
      manager.startChord('cmd+shift+alt+k');
      const result = manager.completeChord('left');

      expect(result).toBe('cmd+shift+alt+k left');
    });

    test('multiple complete calls return null after first', () => {
      manager.startChord('cmd+k');
      const first = manager.completeChord('left');
      const second = manager.completeChord('right');

      expect(first).toBe('cmd+k left');
      expect(second).toBeNull();
    });
  });
});
