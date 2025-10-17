/**
 * SQL Snippet Types
 */

export interface SqlSnippet {
  id: string;
  label: string;
  category: SnippetCategory;
  description: string;
  template: string;
  /** Cursor position after insertion (${0} or ${1}) */
  cursorPosition?: number;
  /** Dialects that support this snippet */
  dialects?: string[];
}

export type SnippetCategory =
  | "query"
  | "insert"
  | "update"
  | "delete"
  | "ddl"
  | "join"
  | "window"
  | "cte"
  | "transaction"
  | "index"
  | "performance";
