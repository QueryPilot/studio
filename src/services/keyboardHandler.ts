import { logger } from "@/lib/logger";
import { keyboardEventToDispatch } from '@/lib/keyboardDispatch';
import { detectPlatform, type RuntimePlatform } from '@/lib/platform';

import { type CommandService, commandService } from './commandService';
import { type ContextService, contextService } from './contextService';
import { type KeybindingService, keybindingService } from './keybindingService';

const DEFAULT_CHORD_TIMEOUT = 1000;

export interface KeyboardHandlerOptions {
  chordTimeoutMs?: number;
  preventDefault?: boolean;
}

export class KeyboardHandler {
  private readonly commandService: CommandService;
  private readonly keybindingService: KeybindingService;
  private readonly contextService: ContextService;
  private readonly platform: RuntimePlatform;
  private readonly chordTimeoutMs: number;
  private readonly preventDefault: boolean;
  private windowListener?: (event: KeyboardEvent) => void;
  private chordSequence: string[] = [];
  private chordTimer?: number;
  private initialized = false;

  constructor(
    commandServiceInstance: CommandService = commandService,
    keybindingServiceInstance: KeybindingService = keybindingService,
    contextServiceInstance: ContextService = contextService,
    options?: KeyboardHandlerOptions,
    platform: RuntimePlatform = detectPlatform()
  ) {
    this.commandService = commandServiceInstance;
    this.keybindingService = keybindingServiceInstance;
    this.contextService = contextServiceInstance;
    this.platform = platform;
    this.chordTimeoutMs = options?.chordTimeoutMs ?? DEFAULT_CHORD_TIMEOUT;
    this.preventDefault = options?.preventDefault ?? true;
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.windowListener = (event) => { this.handleKeydown(event); };
    window.addEventListener('keydown', this.windowListener, true);
    this.initialized = true;
  }

  dispose(): void {
    if (!this.initialized || !this.windowListener) {
      return;
    }

    window.removeEventListener('keydown', this.windowListener, true);
    if (this.chordTimer) {
      window.clearTimeout(this.chordTimer);
    }
    this.chordSequence = [];
    this.initialized = false;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }

    // Check if focus is on a native text input
    // This allows browser's native undo/redo and text editing shortcuts to work
    const target = event.target as HTMLElement | null;
    const isNativeTextInput = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );

    const dispatch = keyboardEventToDispatch(event, this.platform);
    if (!dispatch) {
      return;
    }

    const nextSequence = [...this.chordSequence, dispatch];
    const activeScopes = this.contextService.getActiveScopes();

    // Temporarily set editorTextFocus for native inputs during keybinding resolution
    // This ensures keybindings with "!editorTextFocus" don't fire when typing in inputs
    const prevEditorTextFocus = this.contextService.getValue('editorTextFocus');
    if (isNativeTextInput && !prevEditorTextFocus) {
      this.contextService.setValue('editorTextFocus', true);
    }

    const { match, isChordPending } = this.keybindingService.resolve(nextSequence, activeScopes);

    // Restore previous value
    if (isNativeTextInput && !prevEditorTextFocus) {
      this.contextService.setValue('editorTextFocus', prevEditorTextFocus ?? false);
    }

    if (isChordPending) {
      this.startChord(nextSequence);
      if (this.preventDefault) {
        event.preventDefault();
      }
      return;
    }

    if (match) {
      this.execute(match.command, match.resolved.args);
      this.resetChord();
      if (this.preventDefault) {
        event.preventDefault();
      }
      return;
    }

    this.resetChord();
  }

  private execute(commandId: string, args: unknown): void {
    void this.commandService.execute(commandId, args).catch((error: unknown) => {
      logger.error(`[keyboardHandler] Failed to execute command ${commandId}:`, error);
    });
  }

  private startChord(sequence: string[]): void {
    this.chordSequence = sequence;
    this.contextService.setValue('keyboardChordPending', true);
    if (this.chordTimer) {
      window.clearTimeout(this.chordTimer);
    }
    this.chordTimer = window.setTimeout(() => { this.resetChord(); }, this.chordTimeoutMs);
  }

  private resetChord(): void {
    this.chordSequence = [];
    if (this.chordTimer) {
      window.clearTimeout(this.chordTimer);
      this.chordTimer = undefined;
    }
    this.contextService.setValue('keyboardChordPending', false);
  }
}

export const keyboardHandler = new KeyboardHandler();
