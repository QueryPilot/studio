import { detectPlatform } from '@/lib/platform';
import { ContextKeyDefinition } from '@/types/context';

const platform = detectPlatform();

export const contextKeyDefinitions: ContextKeyDefinition[] = [
  {
    key: 'isMac',
    defaultValue: platform === 'mac',
    description: 'True when running on macOS',
    owner: 'platform',
  },
  {
    key: 'isWindows',
    defaultValue: platform === 'windows',
    description: 'True when running on Windows',
    owner: 'platform',
  },
  {
    key: 'isLinux',
    defaultValue: platform === 'linux',
    description: 'True when running on Linux',
    owner: 'platform',
  },
  {
    key: 'inQuickOpen',
    defaultValue: false,
    description: 'Quick open (command palette) is visible',
    owner: 'commandPalette',
  },
  {
    key: 'inCommandPalette',
    defaultValue: false,
    description: 'Command palette currently focused',
    owner: 'commandPalette',
  },
  {
    key: 'hasMultipleEditors',
    defaultValue: false,
    description: 'Multiple editor tabs are open',
    owner: 'workbench',
  },
  {
    key: 'activeEditor',
    defaultValue: false,
    description: 'An editor has focus',
    owner: 'workbench',
  },
  {
    key: 'editorCount',
    defaultValue: 0,
    description: 'Number of open editors',
    owner: 'workbench',
  },
  {
    key: 'editorTextFocus',
    defaultValue: false,
    description: 'Text editor content has focus',
    owner: 'editor',
  },
  {
    key: 'editorReadonly',
    defaultValue: false,
    description: 'Focused editor is read-only',
    owner: 'editor',
  },
  {
    key: 'findWidgetVisible',
    defaultValue: false,
    description: 'Find widget is open in editor',
    owner: 'editor',
  },
  {
    key: 'renameInputVisible',
    defaultValue: false,
    description: 'Rename input is active in editor',
    owner: 'editor',
  },
  {
    key: 'parameterHintsVisible',
    defaultValue: false,
    description: 'Parameter hints are visible',
    owner: 'editor',
  },
  {
    key: 'queryEditor',
    defaultValue: false,
    description: 'Focused editor is a SQL query editor',
    owner: 'editor',
  },
  {
    key: 'dataGridFocus',
    defaultValue: false,
    description: 'Data grid has focus',
    owner: 'dataGrid',
  },
  {
    key: 'editingCell',
    defaultValue: false,
    description: 'Editing a cell in data grid',
    owner: 'dataGrid',
  },
  {
    key: 'selectionEmpty',
    defaultValue: true,
    description: 'Data grid selection empty',
    owner: 'dataGrid',
  },
  {
    key: 'dataGridEditable',
    defaultValue: false,
    description: 'Data grid allows inline edits',
    owner: 'dataGrid',
  },
  {
    key: 'dataGridCanUndo',
    defaultValue: false,
    description: 'Data grid history contains undo entries',
    owner: 'dataGrid',
  },
  {
    key: 'dataGridCanRedo',
    defaultValue: false,
    description: 'Data grid history contains redo entries',
    owner: 'dataGrid',
  },
  {
    key: 'filterActive',
    defaultValue: false,
    description: 'Data grid filters active',
    owner: 'dataGrid',
  },
  {
    key: 'assistantVisible',
    defaultValue: false,
    description: 'AI assistant panel visible',
    owner: 'assistant',
  },
  {
    key: 'assistantInputFocus',
    defaultValue: false,
    description: 'AI assistant input focused',
    owner: 'assistant',
  },
  {
    key: 'keyboardChordPending',
    defaultValue: false,
    description: 'User is entering a multi-step chord',
    owner: 'keyboard',
  },
  {
    key: 'pendingEditsAvailable',
    defaultValue: false,
    description: 'True when there are pending table edits',
    owner: 'pendingEdits',
  },
];
