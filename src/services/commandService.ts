import { Command, CommandDescriptor, CommandExecutionContext, CommandRegistration } from '@/types/command';
import { ContextSnapshot } from '@/types/context';

import { ContextService, contextService } from './contextService';

type CommandListener = (command: CommandRegistration) => void;
type CommandExecutionListener = (commandId: string, args: unknown) => void;

export class CommandService {
  private readonly commands = new Map<string, CommandRegistration>();
  private readonly registerListeners = new Set<CommandListener>();
  private readonly unregisterListeners = new Set<CommandListener>();
  private readonly executeListeners = new Set<CommandExecutionListener>();
  private contextService?: ContextService;

  constructor(contextService?: ContextService) {
    this.contextService = contextService;
  }

  setContextService(contextService: ContextService): void {
    this.contextService = contextService;
  }

  register(command: Command, source: CommandRegistration['source'] = 'default'): void {
    const registration: CommandRegistration = {
      command,
      source,
    };

    const existed = this.commands.has(command.id);
    this.commands.set(command.id, registration);
    if (existed) {
      this.emitRegister(registration);
      return;
    }

    this.emitRegister(registration);
  }

  registerMany(commands: Command[], source: CommandRegistration['source'] = 'default'): void {
    for (const command of commands) {
      this.register(command, source);
    }
  }

  unregister(commandId: string): void {
    const registration = this.commands.get(commandId);
    if (!registration) {
      return;
    }

    this.commands.delete(commandId);
    this.emitUnregister(registration);
  }

  has(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  get(commandId: string): CommandDescriptor | undefined {
    const registration = this.commands.get(commandId);
    if (!registration) {
      return undefined;
    }

    return this.toDescriptor(registration);
  }

  list(): CommandDescriptor[] {
    return Array.from(this.commands.values(), (registration) => this.toDescriptor(registration));
  }

  async execute<TArgs = unknown>(commandId: string, args?: TArgs): Promise<void> {
    const registration = this.commands.get(commandId);
    if (!registration) {
      throw new Error(`Command ${commandId} is not registered`);
    }

    if (!this.ensureContextAllows(registration.command.when)) {
      return;
    }

    if (!this.ensureContextAllows(registration.command.enabledWhen)) {
      return;
    }

    const snapshot = this.contextService?.snapshot() ?? new Map<string, unknown>();
    const executionContext: CommandExecutionContext = {
      id: registration.command.id,
      context: snapshot as ContextSnapshot,
      source: registration.source,
    };

    await registration.command.handler(args as TArgs, executionContext);
    this.emitExecute(commandId, args);
  }

  onDidRegister(listener: CommandListener): () => void {
    this.registerListeners.add(listener);
    return () => this.registerListeners.delete(listener);
  }

  onDidUnregister(listener: CommandListener): () => void {
    this.unregisterListeners.add(listener);
    return () => this.unregisterListeners.delete(listener);
  }

  onDidExecute(listener: CommandExecutionListener): () => void {
    this.executeListeners.add(listener);
    return () => this.executeListeners.delete(listener);
  }

  private ensureContextAllows(expression: string | undefined): boolean {
    if (!expression) {
      return true;
    }

    if (!this.contextService) {
      console.warn(`[commandService] No context service available to evaluate expression "${expression}"`);
      return false;
    }

    return this.contextService.evaluate(expression);
  }

  private emitRegister(registration: CommandRegistration): void {
    for (const listener of this.registerListeners) {
      listener(registration);
    }
  }

  private emitUnregister(registration: CommandRegistration): void {
    for (const listener of this.unregisterListeners) {
      listener(registration);
    }
  }

  private emitExecute(commandId: string, args: unknown): void {
    for (const listener of this.executeListeners) {
      listener(commandId, args);
    }
  }

  private toDescriptor(registration: CommandRegistration): CommandDescriptor {
    const { command, source } = registration;
    return {
      id: command.id,
      label: command.label,
      category: command.category,
      description: command.description,
      icon: command.icon,
      when: command.when,
      enabledWhen: command.enabledWhen,
      metadata: command.metadata,
      source,
    };
  }
}

export const commandService = new CommandService();
commandService.setContextService(contextService);
