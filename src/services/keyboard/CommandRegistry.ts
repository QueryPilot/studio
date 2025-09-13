import type { Command, Keybinding } from './types';

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private keybindings: Map<string, Set<string>> = new Map(); // key -> command IDs
  private disposers: Map<string, () => void> = new Map();

  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      console.warn(`Command "${command.id}" is already registered. Overwriting.`);
      this.unregister(command.id);
    }

    // Store command
    this.commands.set(command.id, command);

    // Register keybinding if provided
    if (command.keybinding?.key) {
      const key = command.keybinding.key.toLowerCase();
      if (!this.keybindings.has(key)) {
        this.keybindings.set(key, new Set());
      }
      this.keybindings.get(key)!.add(command.id);
    }

    // Return disposer function
    const disposer = () => { this.unregister(command.id); };
    this.disposers.set(command.id, disposer);
    return disposer;
  }

  unregister(commandId: string): void {
    const command = this.commands.get(commandId);
    if (!command) return;

    // Remove from commands
    this.commands.delete(commandId);

    // Remove keybinding
    if (command.keybinding?.key) {
      const key = command.keybinding.key.toLowerCase();
      const commandIds = this.keybindings.get(key);
      if (commandIds) {
        commandIds.delete(commandId);
        if (commandIds.size === 0) {
          this.keybindings.delete(key);
        }
      }
    }

    // Remove disposer
    this.disposers.delete(commandId);
  }

  get(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getByCategory(category: string): Command[] {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  getByKeybinding(key: string): Command[] {
    const commandIds = this.keybindings.get(key.toLowerCase());
    if (!commandIds) return [];

    return Array.from(commandIds)
      .map(id => this.commands.get(id))
      .filter((cmd): cmd is Command => cmd !== undefined)
      .sort((a, b) => {
        // Sort by priority (higher priority first)
        const aPriority = a.keybinding?.priority || 0;
        const bPriority = b.keybinding?.priority || 0;
        return bPriority - aPriority;
      });
  }

  async execute(commandId: string, args?: any): Promise<void> {
    const command = this.commands.get(commandId);
    if (!command) {
      console.warn(`Command "${commandId}" not found`);
      return;
    }

    try {
      await command.handler(args);
    } catch (error) {
      console.error(`Error executing command "${commandId}":`, error);
      throw error;
    }
  }

  setKeybinding(commandId: string, keybinding: Keybinding): void {
    const command = this.commands.get(commandId);
    if (!command) {
      console.warn(`Command "${commandId}" not found`);
      return;
    }

    // Remove old keybinding
    if (command.keybinding?.key) {
      const oldKey = command.keybinding.key.toLowerCase();
      const commandIds = this.keybindings.get(oldKey);
      if (commandIds) {
        commandIds.delete(commandId);
        if (commandIds.size === 0) {
          this.keybindings.delete(oldKey);
        }
      }
    }

    // Set new keybinding
    command.keybinding = keybinding;
    if (keybinding.key) {
      const key = keybinding.key.toLowerCase();
      if (!this.keybindings.has(key)) {
        this.keybindings.set(key, new Set());
      }
      this.keybindings.get(key)!.add(commandId);
    }
  }

  removeKeybinding(commandId: string): void {
    const command = this.commands.get(commandId);
    if (!command || !command.keybinding?.key) return;

    const key = command.keybinding.key.toLowerCase();
    const commandIds = this.keybindings.get(key);
    if (commandIds) {
      commandIds.delete(commandId);
      if (commandIds.size === 0) {
        this.keybindings.delete(key);
      }
    }

    delete command.keybinding;
  }

  findConflicts(keybinding: Keybinding): Command[] {
    if (!keybinding.key) return [];
    return this.getByKeybinding(keybinding.key);
  }

  search(query: string): Command[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(cmd =>
      cmd.id.toLowerCase().includes(lowerQuery) ||
      cmd.title.toLowerCase().includes(lowerQuery) ||
      cmd.description?.toLowerCase().includes(lowerQuery)
    );
  }

  clear(): void {
    this.commands.clear();
    this.keybindings.clear();
    this.disposers.clear();
  }

  getKeybindingForCommand(commandId: string): Keybinding | undefined {
    return this.commands.get(commandId)?.keybinding;
  }

  getAllKeybindings(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [key, commandIds] of this.keybindings.entries()) {
      result.set(key, Array.from(commandIds));
    }
    return result;
  }
}