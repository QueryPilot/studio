import { CommandRegistry } from './CommandRegistry';
import { KeyNormalizer } from './KeyNormalizer';
import { ContextEvaluator } from './ContextEvaluator';
import type {
  Command,
  KeyboardContext,
  Keybinding,
  KeybindingOverride,
  UserKeybindings,
} from './types';

export class KeyboardManager {
  private static instance: KeyboardManager;
  private registry: CommandRegistry;
  private normalizer: KeyNormalizer;
  private contextEvaluator: ContextEvaluator;
  private context: KeyboardContext;
  private listeners: Set<(context: KeyboardContext) => void> = new Set();
  private isInitialized = false;
  private userOverrides: Map<string, Keybinding> = new Map();
  private disabledCommands: Set<string> = new Set();

  private constructor() {
    this.registry = new CommandRegistry();
    this.normalizer = new KeyNormalizer();
    this.contextEvaluator = new ContextEvaluator();

    // Initialize default context
    this.context = this.createDefaultContext();
  }

  static getInstance(): KeyboardManager {
    if (!KeyboardManager.instance) {
      KeyboardManager.instance = new KeyboardManager();
    }
    return KeyboardManager.instance;
  }

  private createDefaultContext(): KeyboardContext {
    const platform = this.normalizer.getPlatform();
    return {
      activeView: 'global',
      focusedElement: '',
      hasSelection: false,
      hasMultipleSelections: false,
      isEditing: false,
      isDirty: false,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      dialogOpen: false,
      commandPaletteOpen: false,
      isConnected: false,
      queryRunning: false,
      hasResults: false,
      platform,
      isMac: platform === 'mac',
      isWindows: platform === 'windows',
      isLinux: platform === 'linux',
    };
  }

  initialize(): void {
    if (this.isInitialized) return;

    // Add global keyboard listener
    window.addEventListener('keydown', this.handleKeyDown, true);
    this.isInitialized = true;
  }

  destroy(): void {
    if (!this.isInitialized) return;

    window.removeEventListener('keydown', this.handleKeyDown, true);
    this.registry.clear();
    this.listeners.clear();
    this.contextEvaluator.clearCache();
    this.isInitialized = false;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Skip if typing in an input/textarea (unless explicitly handled)
    const target = event.target as HTMLElement;
    const isInput = ['INPUT', 'TEXTAREA'].includes(target.tagName);
    const isContentEditable = target.contentEditable === 'true';

    // Get normalized key combination
    const normalized = this.normalizer.normalize(event);
    if (!normalized) return;

    // Find matching commands
    const commands = this.registry.getByKeybinding(normalized);
    if (commands.length === 0) return;

    // Filter by context and find the best match
    const validCommands = commands.filter(cmd => {
      // Skip disabled commands
      if (this.disabledCommands.has(cmd.id)) return false;

      // Check if command should work in input fields
      if ((isInput || isContentEditable) && !cmd.keybinding?.args?.allowInInput) {
        return false;
      }

      // Evaluate when clause
      return this.contextEvaluator.evaluate(cmd.when, this.context);
    });

    if (validCommands.length === 0) return;

    // Execute the highest priority command
    const command = validCommands[0];
    if (!command) return;

    // Prevent default if specified
    if (command.keybinding?.args?.preventDefault !== false) {
      event.preventDefault();
    }
    if (command.keybinding?.args?.stopPropagation !== false) {
      event.stopPropagation();
    }

    // Execute command
    void this.executeCommand(command.id, command.keybinding?.args);
  };

  registerCommand(command: Command): () => void {
    // Apply user overrides if any
    const override = this.userOverrides.get(command.id);
    if (override) {
      command.keybinding = override;
    }

    return this.registry.register(command);
  }

  unregisterCommand(commandId: string): void {
    this.registry.unregister(commandId);
  }

  async executeCommand(commandId: string, args?: any): Promise<void> {
    if (this.disabledCommands.has(commandId)) {
      console.warn(`Command "${commandId}" is disabled`);
      return;
    }

    await this.registry.execute(commandId, args);
  }

  setKeybinding(commandId: string, keybinding: Keybinding): void {
    this.registry.setKeybinding(commandId, keybinding);
    this.userOverrides.set(commandId, keybinding);
  }

  removeKeybinding(commandId: string): void {
    this.registry.removeKeybinding(commandId);
    this.userOverrides.delete(commandId);
  }

  getKeybinding(commandId: string): Keybinding | undefined {
    return this.registry.getKeybindingForCommand(commandId);
  }

  updateContext(partial: Partial<KeyboardContext>): void {
    const oldContext = this.context;
    this.context = { ...this.context, ...partial };

    // Clear cache if context changed significantly
    if (oldContext.activeView !== this.context.activeView) {
      this.contextEvaluator.clearCache();
    }

    // Notify listeners
    this.notifyContextChange();
  }

  getContext(): KeyboardContext {
    return { ...this.context };
  }

  subscribeToContext(listener: (context: KeyboardContext) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyContextChange(): void {
    const context = this.getContext();
    this.listeners.forEach(listener => { listener(context); });
  }

  evaluateWhen(expression: string | undefined): boolean {
    return this.contextEvaluator.evaluate(expression, this.context);
  }

  findConflicts(keybinding: Keybinding): Command[] {
    return this.registry.findConflicts(keybinding);
  }

  resolveConflict(commands: Command[]): Command | undefined {
    if (commands.length === 0) return undefined;
    if (commands.length === 1) return commands[0];

    // Filter by context
    const validCommands = commands.filter(cmd =>
      this.contextEvaluator.evaluate(cmd.when, this.context)
    );

    if (validCommands.length === 0) return undefined;
    if (validCommands.length === 1) return validCommands[0];

    // Return highest priority
    return validCommands.sort((a, b) => {
      const aPriority = a.keybinding?.priority || 0;
      const bPriority = b.keybinding?.priority || 0;
      return bPriority - aPriority;
    })[0];
  }

  getAllCommands(): Command[] {
    return this.registry.getAll();
  }

  searchCommands(query: string): Command[] {
    return this.registry.search(query);
  }

  getCommandsByCategory(category: string): Command[] {
    return this.registry.getByCategory(category);
  }

  loadUserKeybindings(keybindings: UserKeybindings): void {
    // Clear existing overrides
    this.userOverrides.clear();
    this.disabledCommands.clear();

    // Apply overrides
    keybindings.overrides.forEach(override => {
      this.userOverrides.set(override.commandId, override.keybinding);

      // Update existing command if registered
      const command = this.registry.get(override.commandId);
      if (command) {
        this.registry.setKeybinding(override.commandId, override.keybinding);
      }
    });

    // Apply disabled commands
    keybindings.disabled.forEach(commandId => {
      this.disabledCommands.add(commandId);
    });
  }

  exportUserKeybindings(): UserKeybindings {
    const overrides: KeybindingOverride[] = [];

    this.userOverrides.forEach((keybinding, commandId) => {
      overrides.push({
        commandId,
        keybinding,
        timestamp: Date.now(),
      });
    });

    return {
      version: '1.0.0',
      overrides,
      disabled: Array.from(this.disabledCommands),
    };
  }

  enableCommand(commandId: string): void {
    this.disabledCommands.delete(commandId);
  }

  disableCommand(commandId: string): void {
    this.disabledCommands.add(commandId);
  }

  isCommandEnabled(commandId: string): boolean {
    return !this.disabledCommands.has(commandId);
  }

  reset(): void {
    this.userOverrides.clear();
    this.disabledCommands.clear();
    this.contextEvaluator.clearCache();
    this.context = this.createDefaultContext();
  }

  getNormalizer(): KeyNormalizer {
    return this.normalizer;
  }
}