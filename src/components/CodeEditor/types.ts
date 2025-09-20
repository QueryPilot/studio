export type CodeEditorLanguage = "sql" | "json" | "text" | "dbml";
export type SqlDialect = "postgresql" | "mysql" | "sqlite";
export type EditorTheme = "light" | "dark" | "auto";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onExecute?: () => void;
  language?: CodeEditorLanguage;
  dialect?: SqlDialect;
  connectionId?: string;
  database?: string;
  schema?: string;
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
