import { Keybinding } from '@/types/keybinding';

export const defaultKeybindings: Keybinding[] = [
  {
    command: 'commandPalette.open',
    key: 'cmd+shift+p',
  },
  {
    command: 'quickOpen.show',
    key: 'cmd+p',
  },
  {
    command: 'commandPalette.open',
    key: 'f1',
  },
  {
    command: 'commandPalette.toggle',
    key: 'cmd+k cmd+p',
  },
  {
    command: 'commandPalette.close',
    key: 'escape',
    when: 'inQuickOpen',
  },
  {
    command: 'preferences.open',
    key: 'cmd+,',
  },
  {
    command: 'preferences.openKeyboardShortcuts',
    key: 'cmd+k cmd+s',
  },
  {
    command: 'help.keyboardShortcuts',
    key: 'cmd+shift+/',
  },
  {
    command: 'workbench.action.toggleLeftSidebar',
    key: 'cmd+b',
  },
  {
    command: 'workbench.action.toggleRightSidebar',
    key: 'cmd+alt+b',
  },
  {
    command: 'workbench.action.toggleRightSidebar',
    key: 'cmd+l',
  },
  {
    command: 'workbench.action.splitPanelRight',
    key: 'cmd+\\',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.splitPanelLeft',
    key: 'cmd+alt+left',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.splitPanelUp',
    key: 'cmd+alt+up',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.focusNextPanel',
    key: 'cmd+]',
    when: 'hasMultipleEditors',
  },
  {
    command: 'workbench.action.focusPreviousPanel',
    key: 'cmd+[',
    when: 'hasMultipleEditors',
  },
  {
    command: 'workbench.action.splitPanelDown',
    key: 'cmd+shift+\\',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.newQueryTab',
    key: 'cmd+t',
    when: 'activeEditor',
  },
  {
    command: 'editor.action.executeQuery',
    key: 'cmd+enter',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'workbench.action.closeActiveTab',
    key: 'cmd+w',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.closeAllTabs',
    key: 'cmd+shift+w',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.nextTab',
    key: 'cmd+shift+]',
    when: 'activeEditor',
  },
  {
    command: 'workbench.action.previousTab',
    key: 'cmd+shift+[',
    when: 'activeEditor',
  },
  {
    command: 'pendingEdits.open',
    key: 'cmd+shift+e',
    when: 'pendingEditsAvailable',
  },
  {
    command: 'dataGrid.action.copy',
    key: 'cmd+c',
    when: 'dataGridFocus && !editingCell && !selectionEmpty',
  },
  {
    command: 'dataGrid.action.copyAsJson',
    key: 'cmd+shift+c',
    when: 'dataGridFocus && !editingCell && !selectionEmpty',
  },
  {
    command: 'dataGrid.action.undo',
    key: 'cmd+z',
    when: 'dataGridFocus && dataGridEditable && !editingCell',
  },
  {
    command: 'dataGrid.action.redo',
    key: 'cmd+shift+z',
    when: 'dataGridFocus && dataGridEditable && !editingCell',
  },
  {
    command: 'dataGrid.action.insertRowBelow',
    key: 'cmd+enter',
    when: 'dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty',
  },
  {
    command: 'dataGrid.action.insertRowAbove',
    key: 'cmd+shift+enter',
    when: 'dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty',
  },
  {
    command: 'dataGrid.action.deleteRows',
    key: 'cmd+backspace',
    when: 'dataGridFocus && dataGridEditable && !editingCell && !selectionEmpty',
  },
  {
    command: 'workbench.action.discardAllChanges',
    key: 'cmd+r',
  },
  {
    command: 'workbench.action.reloadWindow',
    key: 'cmd+shift+r',
  },
];
