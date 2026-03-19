import { logger } from "@/lib/logger";
import { keyboardEventToDispatch } from '@/lib/keyboardDispatch';
import { detectPlatform, type RuntimePlatform } from '@/lib/platform';

import { type CommandService, commandService } from './commandService';
import { type ContextService, contextService } from './contextService';
import { type KeybindingService, keybindingService } from './keybindingService';
import { keyboardTelemetry } from './keyboardTelemetry';

const DEFAULT_CHORD_TIMEOUT = 1000;
const nowMs = (): number => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

const isElementInCodeMirror = (element: EventTarget | null): boolean => (
  element instanceof HTMLElement && Boolean(element.closest(".cm-editor"))
);

const isNativeTextInputElement = (element: EventTarget | null, inCodeMirror?: boolean): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  // Exclude GlideDataGrid's internal hidden keyboard-capture input
  // (lives inside `.gdg-style`) — it's not a real user-facing text field.
  // But DO NOT exclude real text inputs inside cell editor overlays
  // (which also render inside `.gdg-style` in Glide's portal).
  if (element.closest(".gdg-style") && !element.closest(".gdg-editor-shell")) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    (inCodeMirror ?? isElementInCodeMirror(element))
  );
};

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
  private windowKeyUpListener?: (event: KeyboardEvent) => void;
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
    this.windowKeyUpListener = (event) => { this.handleKeyup(event); };
    window.addEventListener('keydown', this.windowListener, true);
    window.addEventListener('keyup', this.windowKeyUpListener, true);
    this.initialized = true;
  }

  dispose(): void {
    if (!this.initialized || !this.windowListener || !this.windowKeyUpListener) {
      return;
    }

    window.removeEventListener('keydown', this.windowListener, true);
    window.removeEventListener('keyup', this.windowKeyUpListener, true);
    if (this.chordTimer) {
      window.clearTimeout(this.chordTimer);
    }
    this.chordSequence = [];
    this.initialized = false;
  }

  private handleKeydown(event: KeyboardEvent): void {
    keyboardTelemetry.recordKeyEvent("keydown");

    if (event.defaultPrevented) {
      return;
    }

    if (event.isComposing) {
      return;
    }

    // Check if focus is on a native text input
    // This allows browser's native undo/redo and text editing shortcuts to work
    const target = event.target as HTMLElement | null;
    const activeElement = document.activeElement as HTMLElement | null;
    // Compute CodeMirror focus once and reuse — avoids repeated .closest() DOM walks
    const targetInCM = isElementInCodeMirror(target);
    const activeInCM = isElementInCodeMirror(activeElement);
    const codeMirrorFocused = targetInCM || activeInCM;
    const isNativeTextInput =
      isNativeTextInputElement(target, targetInCM) ||
      isNativeTextInputElement(activeElement, activeInCM);

    // Always defer Mod-D to CodeMirror multi-cursor when editor is focused.
    // This prevents global bindings from hijacking a core editor shortcut.
    if (
      codeMirrorFocused &&
      event.code === "KeyD" &&
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey
    ) {
      return;
    }

    const dispatch = keyboardEventToDispatch(event, this.platform);
    if (!dispatch) {
      return;
    }

    const hadChordInProgress = this.chordSequence.length > 0;
    const nextSequence = [...this.chordSequence, dispatch];
    const activeScopes = this.contextService.getActiveScopes();
    const resolveStart = nowMs();

    // Temporarily override context keys for native text inputs during keybinding
    // resolution. This ensures keybindings with negated conditions like
    // "!editorTextFocus", "!editingCell", or "!selectionEmpty" don't fire when
    // the user is typing in a real input/textarea. We must set values in ALL
    // active scopes (not just globally) because scoped values override global
    // values in the context snapshot. Without this, a stale scoped value of
    // false (e.g. from a previously-focused QuickFilter or DataGrid) would
    // override the global true and let keybindings fire incorrectly.
    const scopeOverrides: { key: string; scope: string | null; prev: unknown }[] = [];
    if (isNativeTextInput) {
      // Keys that use negated conditions in keybindings and are set in scopes.
      // When focus is in a native text input, these must all be true so their
      // negated conditions evaluate to false, preventing the keybinding from firing.
      const keysToOverride = ['editorTextFocus', 'editingCell'] as const;

      for (const key of keysToOverride) {
        const globalPrev = this.contextService.getValue(key);
        if (!globalPrev) {
          scopeOverrides.push({ key, scope: null, prev: globalPrev });
          this.contextService.setValue(key, true);
        }
        for (const scope of activeScopes) {
          const prev = this.contextService.getValue(key, [scope]);
          if (prev !== undefined && prev !== true) {
            scopeOverrides.push({ key, scope, prev });
            this.contextService.setValue(key, true, scope);
          }
        }
      }
    }

    try {
      const { match, isChordPending } = this.keybindingService.resolve(nextSequence, activeScopes);
      keyboardTelemetry.recordResolve(nowMs() - resolveStart, Boolean(match));

      if (match) {
        this.execute(match.command, match.resolved.args);
        this.resetChord();
        if (hadChordInProgress) {
          keyboardTelemetry.recordChordComplete();
        }
        if (this.preventDefault) {
          event.preventDefault();
          keyboardTelemetry.recordPreventDefault();
        }
        return;
      }

      if (isChordPending) {
        this.startChord(nextSequence);
        if (this.preventDefault) {
          event.preventDefault();
          keyboardTelemetry.recordPreventDefault();
        }
        return;
      }

      if (this.chordSequence.length > 0) {
        keyboardTelemetry.recordChordCancel();
      }
      this.resetChord();
    } finally {
      // Restore all overridden values even if resolve() throws
      for (const { key, scope, prev } of scopeOverrides) {
        const value = (prev ?? false) as boolean;
        if (scope === null) {
          this.contextService.setValue(key, value);
        } else {
          this.contextService.setValue(key, value, scope);
        }
      }
    }
  }

  private handleKeyup(_event: KeyboardEvent): void {
    keyboardTelemetry.recordKeyEvent("keyup");
  }

  private execute(commandId: string, args: unknown): void {
    const executeStart = nowMs();
    void (async () => {
      try {
        await this.commandService.execute(commandId, args);
        keyboardTelemetry.recordCommand(commandId, nowMs() - executeStart, true);
      } catch (error: unknown) {
        keyboardTelemetry.recordCommand(commandId, nowMs() - executeStart, false);
        logger.error(`[keyboardHandler] Failed to execute command ${commandId}:`, error);
      }
    })();
  }

  private startChord(sequence: string[]): void {
    keyboardTelemetry.recordChordStart();
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
