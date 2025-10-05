// Core classes
export { KeyboardManager } from './KeyboardManager';
export { CommandRegistry } from './CommandRegistry';
export { KeyNormalizer } from './KeyNormalizer';
export { ContextEvaluator } from './ContextEvaluator';
export { ChordManager } from './ChordManager';

// React components
export { KeyboardProvider, useKeyboardContext, KeyboardScope } from './KeyboardProvider';

// React hooks
export { useShortcut, usePlatformShortcut } from './hooks/useShortcut';
export { useCommand, useCommands } from './hooks/useCommand';
export { useKeybindingHint, useAllKeybindings } from './hooks/useKeybindingHint';

// Types
export type {
  Platform,
  ViewContext,
  CommandCategory,
  ModifierState,
  ParsedKey,
  Keybinding,
  Command,
  CommandHandler,
  KeyboardContext,
  ShortcutOptions,
  CommandRegistration,
  KeybindingOverride,
  UserKeybindings,
} from './types';