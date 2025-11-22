import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { AbstractDialectValidator, type SuppressionPattern } from "./base";

/**
 * MySQL dialect validator
 * Handles MySQL-specific syntax including:
 * - Backtick identifiers (`table`.`column`)
 * - DELIMITER statements
 * - AUTO_INCREMENT
 * - MySQL-specific functions and operators
 */
export class MySQLValidator extends AbstractDialectValidator {
  readonly dialect = "mysql" as const;

  // Cache for document content to avoid repeated toString()
  private cachedDoc: { content: string; version: number } | null = null;

  /**
   * Get cached document content
   */
  private getDocContent(state: EditorState): string {
    const version = state.doc.length;
    if (this.cachedDoc && this.cachedDoc.version === version) {
      return this.cachedDoc.content;
    }

    // Skip very large documents
    if (state.doc.length > 100000) {
      this.cachedDoc = { content: "", version };
      return "";
    }

    const content = state.doc.toString();
    this.cachedDoc = { content, version };
    return content;
  }

  getSuppressionPatterns(): SuppressionPattern[] {
    return [
      {
        pattern: /`[^`]+`/,
        reason: "MySQL backtick identifiers",
      },
      {
        pattern: /\bDELIMITER\s+.+/i,
        reason: "MySQL DELIMITER statement",
      },
      {
        pattern: /\bAUTO_INCREMENT\b/i,
        reason: "MySQL AUTO_INCREMENT attribute",
      },
      {
        pattern: /\bENGINE\s*=\s*\w+/i,
        reason: "MySQL storage engine specification",
      },
      {
        pattern: /\bCHARSET\s*=\s*\w+/i,
        reason: "MySQL character set specification",
      },
      {
        pattern: /\bCOLLATE\s*=?\s*\w+/i,
        reason: "MySQL collation specification",
      },
      {
        pattern: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i,
        reason: "MySQL ON UPDATE clause",
      },
      {
        pattern: /\bUNSIGNED\b/i,
        reason: "MySQL UNSIGNED attribute",
      },
      {
        pattern: /\bZEROFILL\b/i,
        reason: "MySQL ZEROFILL attribute",
      },
      {
        pattern: /\bSTRAIGHT_JOIN\b/i,
        reason: "MySQL STRAIGHT_JOIN hint",
      },
      {
        pattern: /\bFORCE\s+INDEX\b/i,
        reason: "MySQL FORCE INDEX hint",
      },
      {
        pattern: /\bUSE\s+INDEX\b/i,
        reason: "MySQL USE INDEX hint",
      },
      {
        pattern: /\bIGNORE\s+INDEX\b/i,
        reason: "MySQL IGNORE INDEX hint",
      },
      {
        pattern: /\bSQL_CALC_FOUND_ROWS\b/i,
        reason: "MySQL SQL_CALC_FOUND_ROWS modifier",
      },
      {
        pattern: /\bLIMIT\s+\d+\s*,\s*\d+/i,
        reason: "MySQL comma-style LIMIT syntax",
      },
      {
        pattern: /\bREGEXP\b/i,
        reason: "MySQL REGEXP operator",
      },
      {
        pattern: /\bRLIKE\b/i,
        reason: "MySQL RLIKE operator",
      },
      {
        pattern: /<=>|<<|>>/,
        reason: "MySQL special operators (<=>, <<, >>)",
      },
      {
        pattern: /\bDIV\b/i,
        reason: "MySQL DIV integer division operator",
      },
      {
        pattern: /\bMOD\b/i,
        reason: "MySQL MOD modulo operator",
      },
    ];
  }

  validateDialectSyntax(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);
    if (!doc) return diagnostics;

    // Check for unmatched backticks - optimized counting
    let backtickCount = 0;
    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '`') backtickCount++;
    }

    if (backtickCount % 2 !== 0) {
      const lastBacktick = doc.lastIndexOf("`");
      if (lastBacktick !== -1) {
        diagnostics.push({
          from: lastBacktick,
          to: lastBacktick + 1,
          severity: "error",
          message: "Unmatched backtick identifier",
        });
      }
    }

    // Check for deprecated syntax (limit to 5 matches)
    const typePattern = /\bTINYINT\(1\)/gi;
    let match;
    let count = 0;

    while ((match = typePattern.exec(doc)) !== null && count < 5) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "warning",
        message:
          "TINYINT(1) is commonly used for booleans but consider using the BOOLEAN type for clarity",
      });
      count++;
    }

    return diagnostics;
  }

  validateBestPractices(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);
    if (!doc) return diagnostics;

    // Check for SELECT * usage (limit to 3 matches)
    const selectStarPattern = /\bSELECT\s+\*\s+FROM\b/gi;
    let match;
    let count = 0;

    while ((match = selectStarPattern.exec(doc)) !== null && count < 3) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "info",
        message:
          "Consider specifying column names instead of SELECT * for better performance and maintainability",
      });
      count++;
    }

    return diagnostics;
  }
}
