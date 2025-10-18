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
    const doc = state.doc.toString();

    // Check for unmatched backticks
    const backtickCount = (doc.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      // Find the last backtick
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

    // Check for deprecated syntax
    const typePattern = /\bTINYINT\(1\)/gi;
    let match;

    while ((match = typePattern.exec(doc)) !== null) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "warning",
        message:
          "TINYINT(1) is commonly used for booleans but consider using the BOOLEAN type for clarity",
      });
    }

    return diagnostics;
  }

  validateBestPractices(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = state.doc.toString();

    // Check for SELECT * usage
    const selectStarPattern = /\bSELECT\s+\*\s+FROM\b/gi;
    let match;

    while ((match = selectStarPattern.exec(doc)) !== null) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "info",
        message:
          "Consider specifying column names instead of SELECT * for better performance and maintainability",
      });
    }

    return diagnostics;
  }
}
