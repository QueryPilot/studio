import type { Platform, ModifierState, ParsedKey } from './types';

export class KeyNormalizer {
  private platform: Platform;

  constructor() {
    this.platform = this.detectPlatform();
  }

  private detectPlatform(): Platform {
    if (typeof navigator === 'undefined') return 'windows';

    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) return 'mac';
    if (userAgent.includes('linux')) return 'linux';
    return 'windows';
  }

  normalize(event: KeyboardEvent): string {
    const modifiers: string[] = [];

    // Order matters: Ctrl/Cmd, Alt, Shift
    if (this.platform === 'mac' ? event.metaKey : event.ctrlKey) {
      modifiers.push('cmd');
    }
    if (event.altKey) {
      modifiers.push('alt');
    }
    if (event.shiftKey) {
      modifiers.push('shift');
    }

    // Get the key
    let key = event.key.toLowerCase();

    // Normalize special keys
    const keyMap: Record<string, string> = {
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      'escape': 'esc',
      'control': 'ctrl',
      'meta': 'cmd',
      'command': 'cmd',
      'option': 'alt',
      'return': 'enter',
      'backspace': 'delete',
      ' ': 'space',
      'pageup': 'pageup',
      'pagedown': 'pagedown',
      'home': 'home',
      'end': 'end',
      'insert': 'insert',
      'delete': 'del',
      'tab': 'tab',
    };

    key = keyMap[key] || key;

    // Don't include modifier keys as the main key
    if (['ctrl', 'shift', 'alt', 'cmd', 'meta', 'control', 'option'].includes(key)) {
      return '';
    }

    // Build the normalized string
    if (modifiers.length > 0) {
      return `${modifiers.join('+')}+${key}`;
    }

    return key;
  }

  parse(keyString: string): ParsedKey {
    const parts = keyString.toLowerCase().split('+');
    const modifiers: ModifierState = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    };

    let key = '';
    const knownModifiers = ['cmd', 'ctrl', 'shift', 'alt', 'meta', 'control', 'option'];

    for (const part of parts) {
      if (part === 'cmd' || part === 'meta' || part === 'command') {
        if (this.platform === 'mac') {
          modifiers.meta = true;
        } else {
          modifiers.ctrl = true;
        }
      } else if (part === 'ctrl' || part === 'control') {
        modifiers.ctrl = true;
      } else if (part === 'shift') {
        modifiers.shift = true;
      } else if (part === 'alt' || part === 'option') {
        modifiers.alt = true;
      } else if (!knownModifiers.includes(part)) {
        key = part;
      }
    }

    // Handle chord sequences (e.g., "cmd+k cmd+s")
    if (keyString.includes(' ')) {
      const sequence = keyString.split(' ').map(s => s.trim()).filter(Boolean);
      return {
        key: '',
        modifiers,
        sequence,
      };
    }

    return { key, modifiers };
  }

  toPlatform(normalized: string, targetPlatform?: Platform): string {
    const platform = targetPlatform || this.platform;

    // Replace cmd with platform-specific modifier
    if (platform === 'mac') {
      return normalized.replace(/cmd\+/g, '⌘');
    } else {
      return normalized.replace(/cmd\+/g, 'Ctrl+');
    }
  }

  isValid(keyString: string): boolean {
    if (!keyString || typeof keyString !== 'string') return false;

    // Check for valid format
    const parts = keyString.split('+');
    if (parts.length === 0) return false;

    // Check if it's a chord sequence
    if (keyString.includes(' ')) {
      const chords = keyString.split(' ');
      return chords.every(chord => this.isValid(chord.trim()));
    }

    // Must have at least one non-modifier key
    const parsed = this.parse(keyString);
    return parsed.key !== '';
  }

  matches(event: KeyboardEvent, keyString: string): boolean {
    const normalized = this.normalize(event);
    const target = this.parse(keyString);

    // Build target string from parsed
    const targetNormalized = this.buildNormalized(target);

    return normalized === targetNormalized;
  }

  private buildNormalized(parsed: ParsedKey): string {
    const modifiers: string[] = [];

    if (this.platform === 'mac' ? parsed.modifiers.meta : parsed.modifiers.ctrl) {
      modifiers.push('cmd');
    }
    if (parsed.modifiers.alt) {
      modifiers.push('alt');
    }
    if (parsed.modifiers.shift) {
      modifiers.push('shift');
    }

    if (modifiers.length > 0 && parsed.key) {
      return `${modifiers.join('+')}+${parsed.key}`;
    }

    return parsed.key;
  }

  getPlatform(): Platform {
    return this.platform;
  }

  isMac(): boolean {
    return this.platform === 'mac';
  }

  isWindows(): boolean {
    return this.platform === 'windows';
  }

  isLinux(): boolean {
    return this.platform === 'linux';
  }
}