export type CodeEditorLanguage = 'sql' | 'json' | 'text';
export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite';
export type EditorTheme = 'light' | 'dark' | 'auto';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onExecute?: () => void;
  language?: CodeEditorLanguage;
  dialect?: SqlDialect;
  readOnly?: boolean;
  height?: string;
  theme?: EditorTheme;
  placeholder?: string;
  autoFocus?: boolean;
  lineNumbers?: boolean;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
}