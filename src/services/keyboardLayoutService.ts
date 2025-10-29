import { normalizeKeybindingLabel } from '@/lib/keyboardDispatch';
import { detectPlatform, RuntimePlatform } from '@/lib/platform';
import { KeyboardLayoutInfo } from '@/types/keyboardLayout';
import { ResolvedKeybinding } from '@/types/keybinding';

type LayoutListener = (layout: KeyboardLayoutInfo) => void;

const DEFAULT_LAYOUT_LABEL: Record<RuntimePlatform, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};

export class KeyboardLayoutService {
  private readonly listeners = new Set<LayoutListener>();
  private layout: KeyboardLayoutInfo;

  constructor(platform: RuntimePlatform = detectPlatform()) {
    this.layout = {
      id: platform,
      label: DEFAULT_LAYOUT_LABEL[platform],
      platform,
    };
  }

  getLayout(): KeyboardLayoutInfo {
    return this.layout;
  }

  formatKeybinding(keybinding: string): string {
    return normalizeKeybindingLabel(keybinding, this.layout.platform).join(' ');
  }

  formatResolved(binding: ResolvedKeybinding): string {
    if (binding.resolvedLabel) {
      return binding.resolvedLabel;
    }

    return this.formatKeybinding(binding.key);
  }

  setLayout(layout: KeyboardLayoutInfo): void {
    this.layout = layout;
    this.emit(layout);
  }

  onDidChangeLayout(listener: LayoutListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(layout: KeyboardLayoutInfo): void {
    for (const listener of this.listeners) {
      listener(layout);
    }
  }
}

export const keyboardLayoutService = new KeyboardLayoutService();
