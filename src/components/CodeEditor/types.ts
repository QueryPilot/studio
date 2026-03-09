// CodeEditor-specific types
export type CodeEditorLanguage = "sql" | "json" | "text" | "dbml" | "redis";
export type SqlDialect = "postgresql" | "plsql" | "mysql" | "sqlite" | "mssql";
export type EditorTheme = "light" | "dark" | "auto";
export type EditorDiagnosticsStatus =
  | "idle"
  | "validating"
  | "ready"
  | "stale_schema"
  | "unavailable";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onExecute?: (query?: string) => void;
  onEnter?: () => boolean; // Return true to prevent default behavior
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

// Re-export core types for backward compatibility
export type {
  EntityMeta,
  FieldMeta,
  EntityDetails,
  MetadataProvider,
  EditorContextAnalysis,
  JoinConditionSuggestion,
  FunctionMeta,
} from "./core";
