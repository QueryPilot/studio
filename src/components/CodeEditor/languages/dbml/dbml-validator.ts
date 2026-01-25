import { type Text } from "@codemirror/state";
import { Parser as DBMLParser, type CompilerDiagnostic } from "@dbml/core";

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
      // @dbml/core can throw errors with different structures
      // Try to extract all available error information

      // Check if error has a diags array (multiple errors)
      if (error.diags && Array.isArray(error.diags)) {
        for (const diag of error.diags) {
          errors.push(this.extractDiagnostic(doc, diag));
        }
      }
      // Check if error has errors array
      else if (error.errors && Array.isArray(error.errors)) {
        for (const err of error.errors) {
          errors.push(this.extractDiagnostic(doc, err));
        }
      }
      // Single error object
      else {
        errors.push(this.extractDiagnostic(doc, error));
      }

      // Try to find additional errors by parsing blocks independently
      // This provides better coverage when the parser stops at first error
      const additionalErrors = this.findAdditionalErrors(doc, errors);
      errors.push(...additionalErrors);

      const result: ParseResult = {
        success: false,
        ast: null,
        errors
      };

      this.parseCache.set(doc, result);
      return result;
    }
  }

  private extractDiagnostic(doc: Text, error: CompilerDiagnostic | any): ValidationError {
    let message = error.message || "DBML syntax error";
    let line = 0;
    let column = 0;
    let from = 0;
    let to = 0;
    let severity: "error" | "warning" | "info" = "error";

    // Handle CompilerDiagnostic structure from @dbml/core
    if (error.location?.start) {
      line = error.location.start.line || 0;
      column = error.location.start.column || 0;
      from = this.getOffsetFromLocation(doc, { line, column });

      if (error.location.end) {
        to = this.getOffsetFromLocation(doc, error.location.end);
      } else {
        to = this.findTokenEnd(doc, from);
      }

      // Use the severity type from the diagnostic
      if (error.type === "warning") {
        severity = "warning";
      } else if (error.type === "info") {
        severity = "info";
      }
    }
    // Fallback: try error.location without .start
    else if (error.location) {
      const loc = error.location;
      line = loc.line || 0;
      column = loc.column || 0;
      from = this.getOffsetFromLocation(doc, { line, column });
      to = this.findTokenEnd(doc, from);
    }
    // Fallback: try error.line/column directly
    else if (error.line !== undefined) {
      line = error.line;
      column = error.column || 0;
      from = this.getOffsetFromLocation(doc, { line, column });
      to = this.findTokenEnd(doc, from);
    }
    // Last resort: try to extract from message text
    else {
      const posMatch = message.match(/\((\d+):(\d+)\)/);
      const lineColMatch = message.match(/[Ll]ine\s*(\d+)(?:,?\s*[Cc]olumn\s*(\d+))?/);

      if (posMatch) {
        line = parseInt(posMatch[1] as string, 10);
        column = parseInt(posMatch[2] as string, 10);
      } else if (lineColMatch) {
        line = parseInt(lineColMatch[1] as string, 10);
        column = lineColMatch[2] ? parseInt(lineColMatch[2] as string, 10) : 0;
      }

      if (line > 0) {
        from = this.getOffsetFromLocation(doc, { line, column });
        to = this.findTokenEnd(doc, from);
      }
    }

    // If we still don't have a valid position, default to start of doc
    if (from === 0 && to === 0) {
      to = Math.min(doc.length, 20);
    }

    // Format message with line:column prefix for clearer error display
    // Avoid duplicating if the message already contains position info
    const hasPositionInMessage = /\(\d+:\d+\)/.test(message) || /[Ll]ine\s*\d+/.test(message);
    if (line > 0 && !hasPositionInMessage) {
      message = `(${line}:${column}) ${message}`;
    }

    return {
      from,
      to: to || from + 1,
      message,
      severity,
      code: error.code ? `DBML_${error.code}` : "PARSE_ERROR"
    };
  }

  private findTokenEnd(doc: Text, from: number): number {
    // Find the end of the current token/word
    const text = doc.toString();
    let end = from;

    // Skip to end of current word/token
    while (end < text.length && /\S/.test(text[end] || "")) {
      end++;
    }

    // Ensure we highlight at least something
    if (end === from) {
      end = Math.min(from + 10, doc.length);
    }

    return end;
  }

  private getOffsetFromLocation(doc: Text, location: { line: number; column: number }): number {
    try {
      const line = doc.line(Math.max(1, location.line));
      return line.from + Math.max(0, location.column - 1);
    } catch {
      return 0;
    }
  }

  /**
   * Try to find additional errors by parsing blocks independently.
   * This helps when the main parser stops at the first error.
   */
  private findAdditionalErrors(doc: Text, existingErrors: ValidationError[]): ValidationError[] {
    const additionalErrors: ValidationError[] = [];
    const docString = doc.toString();

    // Get line numbers already reported to avoid duplicates
    const reportedLines = new Set(
      existingErrors.map(e => {
        try {
          return doc.lineAt(e.from).number;
        } catch {
          return -1;
        }
      })
    );

    // Split document into blocks (Table, Ref, Enum, Project definitions)
    const blockRegex = /^(Table|Ref|Enum|Project|TableGroup)\s+/gim;
    const blocks: { start: number; end: number; content: string }[] = [];
    let match;
    const matches: { index: number }[] = [];

    while ((match = blockRegex.exec(docString)) !== null) {
      matches.push({ index: match.index });
    }

    // Create blocks from matches
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i]!.index;
      const end = i < matches.length - 1 ? matches[i + 1]!.index : docString.length;
      blocks.push({
        start,
        end,
        content: docString.slice(start, end)
      });
    }

    // Try to parse each block independently
    for (const block of blocks) {
      // Skip if this block's start line is already reported
      try {
        const blockLine = doc.lineAt(block.start).number;
        if (reportedLines.has(blockLine)) continue;
      } catch {
        continue;
      }

      try {
        // Wrap block in minimal valid DBML structure for parsing
        this.parser.parse(block.content, "dbml");
      } catch (blockError: any) {
        // Extract error from this block
        if (blockError.diags && Array.isArray(blockError.diags)) {
          for (const diag of blockError.diags) {
            const error = this.extractDiagnosticWithOffset(doc, diag, block.start);
            // Check if this line is already reported
            try {
              const errorLine = doc.lineAt(error.from).number;
              if (!reportedLines.has(errorLine)) {
                reportedLines.add(errorLine);
                additionalErrors.push(error);
              }
            } catch {
              additionalErrors.push(error);
            }
          }
        } else if (blockError.location || blockError.line !== undefined) {
          const error = this.extractDiagnosticWithOffset(doc, blockError, block.start);
          try {
            const errorLine = doc.lineAt(error.from).number;
            if (!reportedLines.has(errorLine)) {
              reportedLines.add(errorLine);
              additionalErrors.push(error);
            }
          } catch {
            additionalErrors.push(error);
          }
        }
      }
    }

    return additionalErrors;
  }

  private extractDiagnosticWithOffset(doc: Text, error: CompilerDiagnostic | any, blockOffset: number): ValidationError {
    const diagnostic = this.extractDiagnostic(doc, error);

    // If the error position is relative to the block, adjust it
    if (error.location?.start) {
      const line = error.location.start.line || 1;
      const column = error.location.start.column || 0;

      // Find the actual line in the document by counting from block start
      try {
        const blockStartLine = doc.lineAt(blockOffset).number;
        const actualLine = blockStartLine + line - 1;
        const lineInfo = doc.line(actualLine);
        diagnostic.from = lineInfo.from + Math.max(0, column - 1);
        diagnostic.to = this.findTokenEnd(doc, diagnostic.from);

        // Update message with correct line number
        const hasPositionInMessage = /\(\d+:\d+\)/.test(diagnostic.message);
        if (!hasPositionInMessage) {
          diagnostic.message = `(${actualLine}:${column}) ${diagnostic.message.replace(/^\(\d+:\d+\)\s*/, '')}`;
        } else {
          // Replace the line number in existing position
          diagnostic.message = diagnostic.message.replace(/\((\d+):(\d+)\)/, `(${actualLine}:${column})`);
        }
      } catch {
        // Fall back to original position calculation
      }
    }

    return diagnostic;
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