import { commandService, CommandService } from './commandService';
import { ContextService, contextService } from './contextService';

import { Keybinding, KeybindingSerialization } from '@/types/keybinding';

interface DeserializeResult {
  bindings: Keybinding[];
  errors: string[];
}

export class KeybindingIO {
  constructor(
    private readonly commandSvc: CommandService = commandService,
    private readonly contextSvc: ContextService = contextService
  ) {}

  deserialize(json: string): DeserializeResult {
    const errors: string[] = [];

    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch (error) {
      return {
        bindings: [],
        errors: [`Failed to parse JSON: ${(error as Error).message}`],
      };
    }

    if (!Array.isArray(payload)) {
      return {
        bindings: [],
        errors: ['Expected array of keybindings'],
      };
    }

    const bindings: Keybinding[] = [];

    for (const entry of payload) {
      const validation = this.validateEntry(entry as KeybindingSerialization);
      if (validation) {
        errors.push(validation);
        continue;
      }

      bindings.push({
        command: entry.command,
        key: entry.key,
        when: entry.when,
        args: entry.args,
      });
    }

    return { bindings, errors };
  }

  serialize(bindings: Keybinding[]): string {
    const payload: KeybindingSerialization[] = bindings.map((binding) => ({
      key: binding.key,
      command: binding.command,
      when: binding.when,
      args: binding.args,
    }));

    return JSON.stringify(payload, null, 2);
  }

  private validateEntry(entry?: KeybindingSerialization): string | undefined {
    if (!entry) {
      return 'Invalid keybinding entry';
    }

    if (!entry.command) {
      return 'Missing "command" property';
    }

    if (!this.commandSvc.has(entry.command)) {
      return `Unknown command: ${entry.command}`;
    }

    if (!entry.key) {
      return `Keybinding for command "${entry.command}" is missing "key" property`;
    }

    if (entry.when) {
      try {
        this.contextSvc.parseExpression(entry.when);
      } catch {
        return `Invalid when clause "${entry.when}" for "${entry.command}"`;
      }
    }

    return undefined;
  }
}

export const keybindingIO = new KeybindingIO();
