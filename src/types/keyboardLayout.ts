export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';

export interface KeyboardLayoutInfo {
  id: string;
  label: string;
  locale?: string;
  platform: 'mac' | 'windows' | 'linux';
}

export interface KeybindingLabelOptions {
  useMacSymbols?: boolean;
  separator?: string;
}

export interface ResolvedModifierLabels {
  ctrl: string;
  alt: string;
  shift: string;
  meta: string;
}

export interface KeyboardLayoutServiceEvents {
  onDidChangeLayout(callback: (layout: KeyboardLayoutInfo) => void): () => void;
}
