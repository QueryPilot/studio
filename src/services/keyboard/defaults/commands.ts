import type { Command } from "../types";
import keybindingsJson from "./keybindings.json";

// Command handlers will be implemented by components
// This file defines the command structure and metadata

export interface CommandDefinition {
  id: string;
  title: string;
  category?: string;
  defaultKeybinding?: string;
  when?: string;
}

// Parse keybindings.json to create command definitions
export function getDefaultCommands(): CommandDefinition[] {
  const commands: CommandDefinition[] = [];
  const seen = new Set<string>();

  keybindingsJson.keybindings.forEach((binding) => {
    if (!seen.has(binding.command)) {
      seen.add(binding.command);

      // Infer category from command ID
      const category = binding.command.split(".")[0];

      commands.push({
        id: binding.command,
        title: binding.description || binding.command,
        category,
        defaultKeybinding: binding.key,
        when: binding.when,
      });
    }
  });

  return commands;
}

// Helper to create a command with a handler
export function createCommand(
  definition: CommandDefinition,
  handler: () => void | Promise<void>,
): Command {
  return {
    id: definition.id,
    title: definition.title,
    category: definition.category as any,
    handler,
    when: definition.when,
    keybinding: definition.defaultKeybinding
      ? {
          key: definition.defaultKeybinding,
          when: definition.when,
        }
      : undefined,
  };
}

// Load default keybindings
export function loadDefaultKeybindings(): Map<string, string> {
  const keybindings = new Map<string, string>();

  keybindingsJson.keybindings.forEach((binding) => {
    // Store the first keybinding for each command
    if (!keybindings.has(binding.command)) {
      keybindings.set(binding.command, binding.key);
    }
  });

  return keybindings;
}

// Get all keybindings including duplicates (for conflict detection)
export function getAllDefaultKeybindings(): Array<{
  command: string;
  key: string;
  when?: string;
}> {
  return keybindingsJson.keybindings.map((binding) => ({
    command: binding.command,
    key: binding.key,
    when: binding.when,
  }));
}
