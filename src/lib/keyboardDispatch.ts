import { detectPlatform, type RuntimePlatform } from './platform';

const MODIFIER_ORDER: NormalizedModifier[] = ['meta', 'ctrl', 'alt', 'shift'];

type NormalizedModifier = 'meta' | 'ctrl' | 'alt' | 'shift';

interface NormalizedChord {
  dispatch: string;
  labelParts: string[];
}

const MODIFIER_ALIASES: Record<string, NormalizedModifier | 'cmdorctrl'> = {
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  windows: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  option: 'alt',
  alt: 'alt',
  shift: 'shift',
  cmdorctrl: 'cmdorctrl',
  primary: 'cmdorctrl',
};

const KEY_ALIASES: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  minus: 'Minus',
  plus: 'Equal',
  '=': 'Equal',
  '-': 'Minus',
  '`': 'Backquote',
  '~': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};

export function parseKeybindingInput(input: string, platform: RuntimePlatform = detectPlatform()): string[] {
  return input
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((chord) => normalizeChord(chord, platform).dispatch);
}

export function normalizeKeybindingLabel(input: string, platform: RuntimePlatform = detectPlatform()): string[] {
  return input
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((chord) => normalizeChord(chord, platform).labelParts.join('+'));
}

export function keyboardEventToDispatch(event: KeyboardEvent, platform: RuntimePlatform = detectPlatform()): string {
  const modifiers = new Set<NormalizedModifier>();
  if (event.metaKey) {
    modifiers.add('meta');
  }
  if (event.ctrlKey) {
    modifiers.add(platform === 'mac' ? 'ctrl' : 'ctrl');
  }
  if (event.altKey) {
    modifiers.add('alt');
  }
  if (event.shiftKey) {
    modifiers.add('shift');
  }

  if (platform !== 'mac' && modifiers.has('meta')) {
    modifiers.delete('meta');
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const keyCode = resolveKeyCode(event.code, event.key);

  return [...orderedModifiers, keyCode].filter(Boolean).join('+');
}

function normalizeChord(chord: string, platform: RuntimePlatform): NormalizedChord {
  const parts = chord.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set<NormalizedModifier>();
  let keyToken = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIER_ALIASES[lower]) {
      const alias = MODIFIER_ALIASES[lower];
      if (alias === 'cmdorctrl') {
        if (platform === 'mac') {
          modifiers.add('meta');
        } else {
          modifiers.add('ctrl');
        }
      } else if (alias === 'meta' && platform !== 'mac') {
        modifiers.add('ctrl');
      } else {
        modifiers.add(alias);
      }
      continue;
    }

    keyToken = part;
  }

  if (!keyToken) {
    throw new Error(`Missing key token in chord "${chord}"`);
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const keyCode = resolveKeyCodeFromToken(keyToken);

  return {
    dispatch: [...orderedModifiers, keyCode].filter(Boolean).join('+'),
    labelParts: [...orderedModifiers.map((modifier) => formatModifier(modifier, platform)), formatKeyLabel(keyCode, platform)],
  };
}

function resolveKeyCode(code: string, key: string): string {
  if (code && code !== 'Unidentified') {
    return code;
  }

  if (key.length === 1) {
    return buildKeyCodeFromChar(key);
  }

  const alias = KEY_ALIASES[key.toLowerCase()];
  return alias ?? key;
}

function resolveKeyCodeFromToken(token: string): string {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) {
    return KEY_ALIASES[lower];
  }

  if (/^f[0-9]{1,2}$/.test(lower)) {
    return lower.toUpperCase();
  }

  if (token.length === 1) {
    return buildKeyCodeFromChar(token);
  }

  return token;
}

function buildKeyCodeFromChar(char: string): string {
  if (/[a-zA-Z]/.test(char)) {
    return `Key${char.toUpperCase()}`;
  }

  if (/[0-9]/.test(char)) {
    return `Digit${char}`;
  }

  return char;
}

function formatModifier(modifier: NormalizedModifier, platform: RuntimePlatform): string {
  if (platform === 'mac') {
    switch (modifier) {
      case 'meta':
        return '⌘';
      case 'shift':
        return '⇧';
      case 'alt':
        return '⌥';
      case 'ctrl':
        return '⌃';
    }
  }

  switch (modifier) {
    case 'meta':
      return 'Win';
    case 'ctrl':
      return 'Ctrl';
    case 'alt':
      return 'Alt';
    case 'shift':
      return 'Shift';
    default:
      return modifier;
  }
}

function formatKeyLabel(keyCode: string, platform: RuntimePlatform): string {
  if (keyCode.startsWith('Key')) {
    return keyCode.slice(3);
  }

  if (keyCode.startsWith('Digit')) {
    return keyCode.slice(5);
  }

  switch (keyCode) {
    case 'Enter':
      return platform === 'mac' ? '⏎' : 'Enter';
    case 'Escape':
      return 'Esc';
    case 'Space':
      return 'Space';
    case 'Backspace':
      return platform === 'mac' ? '⌫' : 'Backspace';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'Backslash':
      return '\\';
    case 'Slash':
      return '/';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backquote':
      return '`';
    case 'Quote':
      return '\'';
    case 'Semicolon':
      return ';';
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    default:
      return keyCode;
  }
}
