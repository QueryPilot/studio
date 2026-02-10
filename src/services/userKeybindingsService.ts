import { logger } from "@/lib/logger";
import { parseKeybindingInput } from "@/lib/keyboardDispatch";
import { detectPlatform } from "@/lib/platform";
import { type Keybinding, type KeybindingSerialization } from "@/types/keybinding";

import { keybindingService } from "./keybindingService";

const STORAGE_KEY = "querypilot.userKeybindings.v1";

type ChangeListener = (bindings: KeybindingSerialization[]) => void;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function areBindingsEqual(a: KeybindingSerialization, b: KeybindingSerialization): boolean {
  return (
    a.command === b.command &&
    a.key === b.key &&
    (a.when ?? "") === (b.when ?? "") &&
    JSON.stringify(a.args ?? null) === JSON.stringify(b.args ?? null)
  );
}

function normalizeEntry(entry: KeybindingSerialization): KeybindingSerialization | null {
  if (!entry.command || typeof entry.command !== "string") {
    return null;
  }
  if (!entry.key || typeof entry.key !== "string") {
    return null;
  }

  try {
    const dispatchParts = parseKeybindingInput(entry.key, detectPlatform());
    if (dispatchParts.length === 0) {
      return null;
    }
  } catch (error) {
    logger.warn("[userKeybindings] Ignoring invalid keybinding", entry, error);
    return null;
  }

  return {
    command: entry.command.trim(),
    key: entry.key.trim(),
    when: entry.when?.trim() || undefined,
    args: entry.args,
  };
}

function normalizeEntries(entries: KeybindingSerialization[]): KeybindingSerialization[] {
  const unique: KeybindingSerialization[] = [];
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    const exists = unique.some((existing) => areBindingsEqual(existing, normalized));
    if (!exists) {
      unique.push(normalized);
    }
  }
  return unique;
}

function sameWhen(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

class UserKeybindingsService {
  private bindings: KeybindingSerialization[] = [];
  private initialized = false;
  private readonly listeners = new Set<ChangeListener>();

  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.bindings = this.readFromStorage();
    this.applyToResolver();
    this.initialized = true;
  }

  onDidChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): KeybindingSerialization[] {
    return [...this.bindings];
  }

  setAll(bindings: KeybindingSerialization[]): void {
    this.bindings = normalizeEntries(bindings);
    this.persist();
    this.applyToResolver();
    this.emitChange();
  }

  upsert(binding: KeybindingSerialization): void {
    const normalized = normalizeEntry(binding);
    if (!normalized) {
      throw new Error("Invalid keybinding entry");
    }

    const isRemoval = normalized.command.startsWith("-");
    const targetCommand = isRemoval ? normalized.command.slice(1) : normalized.command;

    let next = [...this.bindings];

    if (isRemoval) {
      next = next.filter((entry) => !areBindingsEqual(entry, normalized));
      next.push(normalized);
    } else {
      next = next.filter((entry) => {
        const matchesCommand = entry.command === targetCommand;
        const matchesRemoval = entry.command === `-${targetCommand}`;
        if (!sameWhen(entry.when, normalized.when)) {
          return true;
        }
        if (matchesCommand) {
          return false;
        }
        if (matchesRemoval && entry.key === normalized.key) {
          // Ensure the new active key is not shadowed by an old removal entry.
          return false;
        }
        return true;
      });

      next.push(normalized);

      const activeBindings = keybindingService
        .list()
        .filter(
          (entry) =>
            entry.command === targetCommand &&
            sameWhen(entry.when, normalized.when) &&
            entry.key !== normalized.key,
        );

      for (const activeBinding of activeBindings) {
        next.push({
          command: `-${targetCommand}`,
          key: activeBinding.key,
          when: activeBinding.when,
        });
      }
    }

    this.bindings = normalizeEntries(next);
    this.persist();
    this.applyToResolver();
    this.emitChange();
  }

  remove(binding: KeybindingSerialization): void {
    this.bindings = this.bindings.filter((entry) => !areBindingsEqual(entry, binding));
    this.persist();
    this.applyToResolver();
    this.emitChange();
  }

  resetCommand(commandId: string): void {
    this.bindings = this.bindings.filter((entry) => {
      if (entry.command === commandId) {
        return false;
      }
      if (entry.command === `-${commandId}`) {
        return false;
      }
      return true;
    });
    this.persist();
    this.applyToResolver();
    this.emitChange();
  }

  resetAll(): void {
    this.bindings = [];
    this.persist();
    this.applyToResolver();
    this.emitChange();
  }

  private applyToResolver(): void {
    const payload: Keybinding[] = this.bindings.map((binding) => ({
      command: binding.command,
      key: binding.key,
      when: binding.when,
      args: binding.args,
    }));

    keybindingService.replaceSourceBindings(payload, "user");
  }

  private readFromStorage(): KeybindingSerialization[] {
    if (!hasWindowStorage()) {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return normalizeEntries(parsed as KeybindingSerialization[]);
    } catch (error) {
      logger.warn("[userKeybindings] Failed to read user keybindings", error);
      return [];
    }
  }

  private persist(): void {
    if (!hasWindowStorage()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (error) {
      logger.warn("[userKeybindings] Failed to persist user keybindings", error);
    }
  }

  private emitChange(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const userKeybindingsService = new UserKeybindingsService();
