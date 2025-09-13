export type Platform = 'mac' | 'windows' | 'linux';
export type ViewContext =
  | 'queryEditor'
  | 'tableView'
  | 'schemaView'
  | 'resultView'
  | 'functionView'
  | 'erdView'
  | 'workbench'
  | 'sidebar.database'
  | 'sidebar.ai'
  | 'global';

export type CommandCategory =
  | 'file'
  | 'edit'
  | 'view'
  | 'database'
  | 'navigation'
  | 'help';

export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface ParsedKey {
  key: string;
  modifiers: ModifierState;
  sequence?: string[];
}

export interface Keybinding {
  key: string;
  when?: string;
  priority?: number;
  args?: any;
}

export interface Command {
  id: string;
  title: string;
  category?: CommandCategory;
  handler: CommandHandler;
  when?: string;
  keybinding?: Keybinding;
  icon?: string;
  description?: string;
}

export type CommandHandler = (args?: any) => void | Promise<void>;

export interface KeyboardContext {
  activeView: ViewContext;
  focusedElement: string;
  hasSelection: boolean;
  hasMultipleSelections: boolean;
  isEditing: boolean;
  isDirty: boolean;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  dialogOpen: boolean;
  commandPaletteOpen: boolean;
  isConnected: boolean;
  queryRunning: boolean;
  hasResults: boolean;
  focusedPanel?: boolean;
  platform: Platform;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  [key: string]: any;
}

export interface KeyboardEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface ShortcutOptions {
  when?: string;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  description?: string;
  priority?: number;
}

export interface CommandRegistration {
  command: Command;
  disposer: () => void;
}

export interface KeybindingOverride {
  commandId: string;
  keybinding: Keybinding;
  timestamp: number;
}

export interface UserKeybindings {
  version: string;
  overrides: KeybindingOverride[];
  disabled: string[];
}