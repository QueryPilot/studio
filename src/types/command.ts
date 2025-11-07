import { type ReactNode } from 'react';

import { type ContextSnapshot } from './context';

export type CommandHandler<TArgs = unknown> = (
  args: TArgs,
  context: CommandExecutionContext
) => void | Promise<void>;

export interface CommandExecutionContext {
  readonly id: string;
  readonly context: ContextSnapshot;
  readonly source: 'default' | 'user' | 'system';
}

export interface Command<TArgs = unknown> {
  id: string;
  label: string;
  description?: string;
  category?: string;
  icon?: ReactNode;
  handler: CommandHandler<TArgs>;
  when?: string;
  enabledWhen?: string;
  metadata?: Record<string, unknown>;
}

export interface CommandRegistration<TArgs = unknown> {
  command: Command<TArgs>;
  source: 'default' | 'user' | 'system';
}

export interface CommandDescriptor {
  id: string;
  label: string;
  category?: string;
  description?: string;
  icon?: ReactNode;
  when?: string;
  enabledWhen?: string;
  source: 'default' | 'user' | 'system';
  metadata?: Record<string, unknown>;
}
