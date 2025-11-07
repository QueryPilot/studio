import { type ContextKeyExpr } from './context';

export type KeybindingSource = 'default' | 'user' | 'extension';

export interface Keybinding {
  command: string;
  key: string;
  when?: string;
  args?: unknown;
  weight?: number;
  source?: KeybindingSource;
}

export interface ParsedKeybinding {
  dispatch: string[];
  chords: string[];
}

export interface ResolvedKeybinding extends Keybinding {
  dispatchParts: string[];
  whenExpr?: ContextKeyExpr;
  resolvedLabel: string;
  source: KeybindingSource;
  weight: number;
}

export interface KeybindingMatch {
  command: string;
  resolved: ResolvedKeybinding;
}

export interface KeybindingConflict {
  existing: ResolvedKeybinding;
  incoming: ResolvedKeybinding;
  reason: 'dispatch' | 'context' | 'priority';
}

export interface KeybindingSerialization {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
}
