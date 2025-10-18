import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import type { SqlDialect } from "@/components/CodeEditor/types";

/**
 * Represents a syntax error with context information
 */
export interface SyntaxError {
  from: number;
  to: number;
  message: string;
  snippet: string;
}

/**
 * Suppression pattern for dialect-specific syntax
 */
export interface SuppressionPattern {
  pattern: RegExp;
  reason: string;
  // Optional validator function for more complex checks
  validate?: (text: string, context: string) => boolean;
}

/**
 * Base interface for dialect-specific validators
 * Each database dialect (PostgreSQL, MySQL, SQLite, MSSQL, Oracle) should implement this
 */
export interface BaseDialectValidator {
  readonly dialect: SqlDialect;

  /**
   * Get suppression patterns for this dialect
   * These patterns identify valid dialect-specific syntax that may be flagged as errors by the parser
   */
  getSuppressionPatterns(): SuppressionPattern[];

  /**
   * Check if a syntax error should be suppressed for this dialect
   * @param error - The syntax error from the parser
   * @param context - The surrounding text context (±50 chars from error)
   * @returns true if the error should be suppressed (not shown to user)
   */
  shouldSuppressError(error: SyntaxError, context: string): boolean;

  /**
   * Perform dialect-specific syntax validation
   * @param state - The editor state
   * @returns Array of diagnostics for dialect-specific issues
   */
  validateDialectSyntax(state: EditorState): Diagnostic[];

  /**
   * Check for common mistakes and best practices (optional)
   * @param state - The editor state
   * @returns Array of diagnostics for best practice violations
   */
  validateBestPractices?(state: EditorState): Diagnostic[];
}

/**
 * Abstract base class providing common functionality for dialect validators
 */
export abstract class AbstractDialectValidator implements BaseDialectValidator {
  abstract readonly dialect: SqlDialect;

  abstract getSuppressionPatterns(): SuppressionPattern[];

  shouldSuppressError(error: SyntaxError, context: string): boolean {
    const patterns = this.getSuppressionPatterns();

    for (const { pattern, validate } of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      if (pattern.test(context)) {
        // If there's a custom validator, use it for additional checks
        if (validate) {
          return validate(error.snippet, context);
        }
        return true;
      }
    }

    return false;
  }

  validateDialectSyntax(_state: EditorState): Diagnostic[] {
    // Default implementation - subclasses can override
    return [];
  }

  validateBestPractices?(_state: EditorState): Diagnostic[] {
    // Optional - subclasses can implement
    return [];
  }

  /**
   * Helper to extract text context around an error position
   */
  protected getContext(
    state: EditorState,
    from: number,
    to: number,
    contextSize = 50,
  ): string {
    const doc = state.doc;
    const contextFrom = Math.max(0, from - contextSize);
    const contextTo = Math.min(doc.length, to + contextSize);
    return doc.sliceString(contextFrom, contextTo);
  }

  /**
   * Helper to check if a position is inside a string literal
   */
  protected isInStringLiteral(state: EditorState, pos: number): boolean {
    const line = state.doc.lineAt(pos);
    const beforePos = line.text.slice(0, pos - line.from);

    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < beforePos.length; i++) {
      const char = beforePos[i];
      const prevChar = i > 0 ? beforePos[i - 1] : "";

      if (char === "'" && prevChar !== "\\") {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && prevChar !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    return inSingleQuote || inDoubleQuote;
  }
}
