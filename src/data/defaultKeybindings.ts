import { type Keybinding } from '@/types/keybinding';

export const defaultKeybindings: Keybinding[] = [
  {
    command: 'quickOpen.show',
    key: 'cmd+p',
  },
  {
    command: 'quickOpen.showCommands',
    key: 'cmd+shift+p',
  },
  {
    command: 'quickOpen.close',
    key: 'escape',
    when: 'inQuickOpen',
  },
  {
    command: 'preferences.open',
    key: 'cmd+,',
  },
  {
    command: 'help.keyboardShortcuts',
    key: 'cmd+shift+/',
  },
  {
    command: 'window.action.newMainWindow',
    key: 'cmd+shift+n',
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
    command: 'ai.action.openWithContext',
    key: 'cmd+l',
  },
  {
    command: 'workbench.action.splitPanelRight',
    key: 'cmd+\\',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.splitPanelLeft',
    key: 'cmd+alt+left',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.splitPanelUp',
    key: 'cmd+alt+up',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.focusNextPanel',
    key: 'cmd+]',
    when: 'hasMultipleEditors && !inQuickOpen',
  },
  {
    command: 'workbench.action.focusPreviousPanel',
    key: 'cmd+[',
    when: 'hasMultipleEditors && !inQuickOpen',
  },
  {
    command: 'workbench.action.splitPanelDown',
    key: 'cmd+shift+\\',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.newQueryTab',
    key: 'cmd+t',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.openErd',
    key: 'cmd+e',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'editor.action.executeQuery',
    key: 'cmd+enter',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'editor.action.executeAll',
    key: 'cmd+shift+enter',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'editor.action.formatQuery',
    key: 'alt+f',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'query.explain',
    key: 'alt+e',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'workbench.action.closeActiveTab',
    key: 'cmd+w',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.closeAllTabs',
    key: 'cmd+shift+w',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.refreshAll',
    key: 'cmd+r',
    when: '!inQuickOpen',
  },
  {
    command: 'workbench.action.nextTab',
    key: 'cmd+shift+]',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'workbench.action.previousTab',
    key: 'cmd+shift+[',
    when: 'activeEditor && !inQuickOpen',
  },
  {
    command: 'pendingEdits.open',
    key: 'cmd+shift+e',
    when: 'pendingEditsAvailable && !inQuickOpen',
  },
  // Data Grid keybindings
  {
    command: 'dataGrid.action.focusFilter',
    key: 'cmd+f',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.focusFilter',
    key: '/',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.copySelection',
    key: 'cmd+c',
    when: 'dataGridFocus && !editingCell && !selectionEmpty && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.copyAsJson',
    key: 'cmd+shift+c',
    when: 'dataGridFocus && !editingCell && !selectionEmpty && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.fillDown',
    key: 'ctrl+d',
    when: 'dataGridFocus && !editingCell && !isMac && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.fillRight',
    key: 'ctrl+r',
    when: 'dataGridFocus && !editingCell && !isMac && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.deleteRows',
    key: 'cmd+d',
    when: 'dataGridFocus && !editingCell && dataGridEditable && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.showContextMenu',
    key: 'cmd+.',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.toggleInspector',
    key: 'cmd+i',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.clearSelection',
    key: 'delete',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'dataGrid.action.clearSelection',
    key: 'backspace',
    when: 'dataGridFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workspace.commitAll',
    key: 'cmd+s',
    when: '!editorTextFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workspace.discardAll',
    key: 'cmd+shift+d',
    when: '!editorTextFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workspace.reviewChanges',
    key: 'cmd+shift+g',
    when: '!editorTextFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workspace.undo',
    key: 'cmd+z',
    when: '!editorTextFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workspace.redo',
    key: 'cmd+shift+z',
    when: '!editorTextFocus && !editingCell && !inQuickOpen',
  },
  {
    command: 'workbench.action.reloadWindow',
    key: 'cmd+shift+r',
    when: '!inQuickOpen',
  },
  // Tab Group Navigation (Cmd/Ctrl + 1-9)
  {
    command: 'tabs.switchToTab1',
    key: 'cmd+1',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab2',
    key: 'cmd+2',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab3',
    key: 'cmd+3',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab4',
    key: 'cmd+4',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab5',
    key: 'cmd+5',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab6',
    key: 'cmd+6',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab7',
    key: 'cmd+7',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab8',
    key: 'cmd+8',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  {
    command: 'tabs.switchToTab9',
    key: 'cmd+9',
    when: 'tabGroupFocused && !inQuickOpen',
  },
  // Query History
  {
    command: 'query.history.show',
    key: 'cmd+shift+h',
    when: '!inQuickOpen',
  },
  {
    command: 'query.saved.create',
    key: 'cmd+shift+s',
    when: 'editorTextFocus && queryEditor',
  },
  {
    command: 'query.saved.search',
    key: 'cmd+shift+o',
    when: '!inQuickOpen',
  },
  // Query Panel
  {
    command: 'query.toggleResults',
    key: 'cmd+j',
    when: 'queryEditor && !inQuickOpen',
  },
];
