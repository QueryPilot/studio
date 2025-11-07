import { type Text } from "@codemirror/state";
import { Parser as DBMLParser } from "@dbml/core";

export interface ValidationError {
  from: number;
  to: number;
  message: string;
  severity: "error" | "warning" | "info";
  code: string;
  data?: any;
}

export interface ParseResult {
  success: boolean;
  ast?: any;
  errors: ValidationError[];
}

export class DBMLValidator {
  private parser: DBMLParser;
  private parseCache = new WeakMap<Text, ParseResult>();

  constructor() {
    this.parser = new DBMLParser();
  }

  parse(doc: Text): ParseResult {
    // Check cache first
    const cached = this.parseCache.get(doc);
    if (cached) return cached;

    const docString = doc.toString();
    const errors: ValidationError[] = [];
    let ast: any = null;

    try {
      // Parse with @dbml/core
      ast = this.parser.parse(docString, "dbml");

      const result: ParseResult = {
        success: true,
        ast,
        errors: []
      };

      this.parseCache.set(doc, result);
      return result;

    } catch (error: any) {
      // Extract detailed error message
      let message = "DBML syntax error";
      let from = 0;
      let to = 0;

      // @dbml/core typically provides detailed error messages
      if (error.message) {
        message = error.message;

        // Try to extract line/column from error message
        // DBML parser often includes "Line X, Column Y" in messages
        const lineMatch = error.message.match(/[Ll]ine\s*(\d+)/);
        const colMatch = error.message.match(/[Cc]olumn\s*(\d+)/);

        if (lineMatch && colMatch) {
          const line = parseInt(lineMatch[1] as string, 10);
          const column = parseInt(colMatch[1] as string, 10);
          from = this.getOffsetFromLocation(doc, { line, column });
          to = from + 10; // Highlight next 10 characters
        }
      }

      // Try to extract location from error object
      if (error.location) {
        from = this.getOffsetFromLocation(doc, (error.location.start || error.location) as { line: number; column: number });
        to = error.location.end
          ? this.getOffsetFromLocation(doc, error.location.end as { line: number; column: number })
          : from + 10;
      } else if (error.line !== undefined && error.column !== undefined) {
        from = this.getOffsetFromLocation(doc, { line: error.line, column: error.column });
        to = from + 10;
      }

      // If we still don't have a position, try to find the error location in the text
      if (from === 0 && to === 0) {
        // Look for common error patterns in the document
        const docString = doc.toString();
        const errorPatterns = [
          /\bTable\s+(?![\w.]+\s*\{)/g,  // Table without opening brace
          /\}\s*\}/g,  // Double closing braces
          /\{\s*\{/g,  // Double opening braces
          /[^\\]'(?:[^']|$)/g,  // Unclosed string
        ];

        for (const pattern of errorPatterns) {
          const match = pattern.exec(docString);
          if (match) {
            from = match.index;
            to = from + match[0].length;
            break;
          }
        }
      }

      const parseError: ValidationError = {
        from,
        to: to || from + 1,
        message,
        severity: "error",
        code: "PARSE_ERROR"
      };

      errors.push(parseError);

      const result: ParseResult = {
        success: false,
        ast: null,
        errors
      };

      this.parseCache.set(doc, result);
      return result;
    }
  }

  private getOffsetFromLocation(doc: Text, location: { line: number; column: number }): number {
    try {
      const line = doc.line(Math.max(1, location.line));
      return line.from + Math.max(0, location.column - 1);
    } catch {
      return 0;
    }
  }

  invalidateCache(doc: Text) {
    this.parseCache.delete(doc);
  }
}

// Validation rule types
export enum ValidationCode {
  // Syntax errors
  PARSE_ERROR = "PARSE_ERROR",
  UNCLOSED_BLOCK = "UNCLOSED_BLOCK",
  INVALID_IDENTIFIER = "INVALID_IDENTIFIER",
  DUPLICATE_DEFINITION = "DUPLICATE_DEFINITION",

  // Semantic errors
  UNDEFINED_TABLE = "UNDEFINED_TABLE",
  UNDEFINED_COLUMN = "UNDEFINED_COLUMN",
  UNDEFINED_ENUM = "UNDEFINED_ENUM",
  TYPE_MISMATCH = "TYPE_MISMATCH",
  CIRCULAR_REFERENCE = "CIRCULAR_REFERENCE",
  DUPLICATE_PRIMARY_KEY = "DUPLICATE_PRIMARY_KEY",

  // Best practices
  MISSING_PRIMARY_KEY = "MISSING_PRIMARY_KEY",
  MISSING_INDEXES = "MISSING_INDEXES",
  MISSING_TABLE_NOTE = "MISSING_TABLE_NOTE",
  INCONSISTENT_NAMING = "INCONSISTENT_NAMING",
  RESERVED_KEYWORD = "RESERVED_KEYWORD",
  REDUNDANT_INDEX = "REDUNDANT_INDEX",
}

export const ERROR_MESSAGES: Record<ValidationCode, string> = {
  [ValidationCode.PARSE_ERROR]: "Syntax error in DBML",
  [ValidationCode.UNCLOSED_BLOCK]: "Unclosed block - missing '}'",
  [ValidationCode.INVALID_IDENTIFIER]: "Invalid identifier format",
  [ValidationCode.DUPLICATE_DEFINITION]: "Duplicate definition",
  [ValidationCode.UNDEFINED_TABLE]: "Reference to undefined table",
  [ValidationCode.UNDEFINED_COLUMN]: "Reference to undefined column",
  [ValidationCode.UNDEFINED_ENUM]: "Reference to undefined enum",
  [ValidationCode.TYPE_MISMATCH]: "Type mismatch in relationship",
  [ValidationCode.CIRCULAR_REFERENCE]: "Circular reference detected",
  [ValidationCode.DUPLICATE_PRIMARY_KEY]: "Multiple primary keys defined",
  [ValidationCode.MISSING_PRIMARY_KEY]: "Table missing primary key",
  [ValidationCode.MISSING_INDEXES]: "Foreign key without index",
  [ValidationCode.MISSING_TABLE_NOTE]: "Table missing documentation",
  [ValidationCode.INCONSISTENT_NAMING]: "Inconsistent naming convention",
  [ValidationCode.RESERVED_KEYWORD]: "Using reserved keyword as identifier",
  [ValidationCode.REDUNDANT_INDEX]: "Redundant index definition",
};