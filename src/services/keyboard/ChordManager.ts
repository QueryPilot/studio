/**
 * ChordManager - Manages keyboard chord sequences (e.g., "cmd+k left")
 *
 * A chord is a multi-key sequence where the first key acts as a prefix,
 * and the second key completes the command.
 *
 * Example: "cmd+k left" -> Press cmd+k, then press left arrow within timeout
 */

export interface ChordState {
  prefix: string | null;
  timestamp: number;
  timeoutId: NodeJS.Timeout | null;
}

export class ChordManager {
  private state: ChordState = {
    prefix: null,
    timestamp: 0,
    timeoutId: null,
  };

  private readonly CHORD_TIMEOUT = 1000; // 1 second to complete chord
  private listeners: Set<(prefix: string | null) => void> = new Set();

  /**
   * Start a chord sequence with the given prefix
   * @param prefix The first key combination (e.g., "cmd+k")
   */
  startChord(prefix: string): void {
    // Clear any existing chord state
    this.clearChord();

    this.state.prefix = prefix;
    this.state.timestamp = Date.now();

    // Set timeout to auto-clear chord state
    this.state.timeoutId = setTimeout(() => {
      console.log(`[ChordManager] Chord timeout for prefix: ${prefix}`);
      this.clearChord();
    }, this.CHORD_TIMEOUT);

    console.log(`[ChordManager] Started chord with prefix: ${prefix}`);
    this.notifyListeners(prefix);
  }

  /**
   * Complete a chord sequence by combining prefix with suffix
   * @param suffix The second key (e.g., "left")
   * @returns The complete chord string (e.g., "cmd+k left") or null if no prefix
   */
  completeChord(suffix: string): string | null {
    if (!this.state.prefix) {
      return null;
    }

    const chord = `${this.state.prefix} ${suffix}`;
    console.log(`[ChordManager] Completed chord: ${chord}`);

    this.clearChord();
    return chord;
  }

  /**
   * Clear the current chord state
   */
  clearChord(): void {
    // Clear timeout if active
    if (this.state.timeoutId) {
      clearTimeout(this.state.timeoutId);
      this.state.timeoutId = null;
    }

    const hadPrefix = this.state.prefix !== null;
    this.state.prefix = null;
    this.state.timestamp = 0;

    if (hadPrefix) {
      console.log('[ChordManager] Cleared chord state');
      this.notifyListeners(null);

      // Dispatch event for UI components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('keyboard:chord-cleared'));
      }
    }
  }

  /**
   * Get the current chord prefix (if any)
   * @returns The current prefix or null
   */
  getPrefix(): string | null {
    return this.state.prefix;
  }

  /**
   * Check if currently waiting for a chord completion
   * @returns true if waiting for second key
   */
  isWaitingForChord(): boolean {
    return this.state.prefix !== null;
  }

  /**
   * Get the time elapsed since chord started (in ms)
   * @returns Milliseconds since chord started, or 0 if no active chord
   */
  getElapsedTime(): number {
    if (!this.state.prefix) return 0;
    return Date.now() - this.state.timestamp;
  }

  /**
   * Subscribe to chord state changes
   * @param listener Callback invoked when chord state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: (prefix: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of chord state change
   */
  private notifyListeners(prefix: string | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(prefix);
      } catch (error) {
        console.error('[ChordManager] Error in listener:', error);
      }
    });
  }

  /**
   * Reset the manager to initial state
   */
  reset(): void {
    this.clearChord();
    this.listeners.clear();
  }
}
