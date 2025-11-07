import { normalizeKeybindingLabel, parseKeybindingInput } from '@/lib/keyboardDispatch';
import { detectPlatform, type RuntimePlatform } from '@/lib/platform';
import { type Keybinding, type KeybindingConflict, type KeybindingMatch, type KeybindingSource, type ResolvedKeybinding } from '@/types/keybinding';

import { type ContextService, contextService } from './contextService';

const SOURCE_WEIGHT: Record<KeybindingSource, number> = {
  default: 0,
  extension: 50,
  user: 100,
};

interface MatchResult {
  match?: KeybindingMatch;
  isChordPending: boolean;
}

type KeybindingListener = (binding: ResolvedKeybinding) => void;
type KeybindingChangeListener = () => void;
type KeybindingConflictListener = (conflict: KeybindingConflict) => void;

export class KeybindingService {
  private bindings: ResolvedKeybinding[] = [];
  private readonly contextService: ContextService;
  private readonly platform: RuntimePlatform;
  private readonly registerListeners = new Set<KeybindingListener>();
  private readonly unregisterListeners = new Set<KeybindingListener>();
  private readonly changeListeners = new Set<KeybindingChangeListener>();
  private readonly conflictListeners = new Set<KeybindingConflictListener>();

  constructor(contextServiceInstance: ContextService = contextService, platform: RuntimePlatform = detectPlatform()) {
    this.contextService = contextServiceInstance;
    this.platform = platform;
  }

  register(binding: Keybinding, source: KeybindingSource = 'default'): void {
    const dispatchParts = parseKeybindingInput(binding.key, this.platform);
    if (dispatchParts.length === 0) {
      throw new Error(`Invalid keybinding: ${binding.key}`);
    }

    const resolved: ResolvedKeybinding = {
      ...binding,
      key: binding.key,
      source,
      weight: binding.weight ?? SOURCE_WEIGHT[source],
      dispatchParts,
      resolvedLabel: normalizeKeybindingLabel(binding.key, this.platform).join(' '),
      whenExpr: this.contextService.parseExpression(binding.when),
    };

    this.detectConflicts(resolved);
    this.bindings.push(resolved);
    this.emitRegister(resolved);
    this.emitChange();
  }

  registerMany(bindings: Keybinding[], source: KeybindingSource = 'default'): void {
    for (const binding of bindings) {
      this.register(binding, source);
    }
  }

  unregister(predicate: (binding: ResolvedKeybinding) => boolean): void {
    const retained: ResolvedKeybinding[] = [];
    const removed: ResolvedKeybinding[] = [];

    for (const binding of this.bindings) {
      if (predicate(binding)) {
        removed.push(binding);
      } else {
        retained.push(binding);
      }
    }

    this.bindings = retained;

    if (removed.length > 0) {
      removed.forEach((binding) => { this.emitUnregister(binding); });
      this.emitChange();
    }
  }

  resolve(dispatchSequence: string[], scopes?: string[]): MatchResult {
    const potential = this.findPotentialBindings(dispatchSequence);
    const exact: ResolvedKeybinding[] = [];
    const partial: ResolvedKeybinding[] = [];

    for (const binding of potential) {
      if (binding.dispatchParts.length === dispatchSequence.length) {
        exact.push(binding);
      } else {
        partial.push(binding);
      }
    }

    const match = this.pickBestMatch(exact, scopes);

    if (match) {
      return {
        match: {
          command: match.command,
          resolved: match,
        },
        isChordPending: partial.length > 0,
      };
    }

    return {
      match: undefined,
      isChordPending: partial.length > 0,
    };
  }

  list(): ResolvedKeybinding[] {
    return [...this.bindings];
  }

  onDidRegister(listener: KeybindingListener): () => void {
    this.registerListeners.add(listener);
    return () => this.registerListeners.delete(listener);
  }

  onDidUnregister(listener: KeybindingListener): () => void {
    this.unregisterListeners.add(listener);
    return () => this.unregisterListeners.delete(listener);
  }

  onDidChange(listener: KeybindingChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onDidConflict(listener: KeybindingConflictListener): () => void {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  private findPotentialBindings(dispatchSequence: string[]): ResolvedKeybinding[] {
    return this.bindings.filter((binding) => {
      if (binding.dispatchParts.length < dispatchSequence.length) {
        return false;
      }

      for (let index = 0; index < dispatchSequence.length; index += 1) {
        if (binding.dispatchParts[index] !== dispatchSequence[index]) {
          return false;
        }
      }

      return true;
    });
  }

  private pickBestMatch(bindings: ResolvedKeybinding[], scopes?: string[]): ResolvedKeybinding | undefined {
    let best: ResolvedKeybinding | undefined;
    const snapshot = this.contextService.snapshot(scopes);

    for (const binding of bindings) {
      let whenMatches = true;

      if (binding.whenExpr) {
        whenMatches = binding.whenExpr.evaluate(snapshot);
      } else if (binding.when) {
        whenMatches = this.contextService.evaluate(binding.when, { scopes });
      }

      if (!whenMatches) {
        continue;
      }

      if (!best || binding.weight > best.weight) {
        best = binding;
      }
    }

    return best;
  }

  private detectConflicts(incoming: ResolvedKeybinding): void {
    for (const existing of this.bindings) {
      if (existing.dispatchParts.join(' ') !== incoming.dispatchParts.join(' ')) {
        continue;
      }

      const sameContext = (existing.when ?? '') === (incoming.when ?? '');
      if (!sameContext) {
        continue;
      }

      if ((existing.weight ?? 0) >= (incoming.weight ?? 0)) {
        this.emitConflict({
          existing,
          incoming,
          reason: 'priority',
        });
      } else {
        this.emitConflict({
          existing,
          incoming,
          reason: 'priority',
        });
      }
    }
  }

  private emitRegister(binding: ResolvedKeybinding): void {
    for (const listener of this.registerListeners) {
      listener(binding);
    }
  }

  private emitUnregister(binding: ResolvedKeybinding): void {
    for (const listener of this.unregisterListeners) {
      listener(binding);
    }
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private emitConflict(conflict: KeybindingConflict): void {
    for (const listener of this.conflictListeners) {
      listener(conflict);
    }
  }
}

export const keybindingService = new KeybindingService();
