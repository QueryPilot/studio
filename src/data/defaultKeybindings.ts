import { type Keybinding } from '@/types/keybinding';

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
    command: 'editor.action.formatQuery',
    key: 'alt+f',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'query.action.toggleHistory',
    key: 'alt+h',
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
    command: 'workspace.commitAll',
    key: 'cmd+s',
    when: '!editorTextFocus && !editingCell',
  },
  {
    command: 'workspace.discardAll',
    key: 'cmd+shift+d',
    when: '!editorTextFocus && !editingCell',
  },
  {
    command: 'workbench.action.discardAllChanges',
    key: 'cmd+r',
  },
  {
    command: 'workbench.action.reloadWindow',
    key: 'cmd+shift+r',
  },
  // Tab Group Navigation (Cmd/Ctrl + 1-9)
  {
    command: 'tabs.switchToTab1',
    key: 'cmd+1',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab2',
    key: 'cmd+2',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab3',
    key: 'cmd+3',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab4',
    key: 'cmd+4',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab5',
    key: 'cmd+5',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab6',
    key: 'cmd+6',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab7',
    key: 'cmd+7',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab8',
    key: 'cmd+8',
    when: 'tabGroupFocused',
  },
  {
    command: 'tabs.switchToTab9',
    key: 'cmd+9',
    when: 'tabGroupFocused',
  },
];
