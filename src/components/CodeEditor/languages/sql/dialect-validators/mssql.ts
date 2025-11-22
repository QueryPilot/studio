import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { AbstractDialectValidator, type SuppressionPattern } from "./base";

/**
 * SQL Server (MSSQL) dialect validator
 * Handles T-SQL-specific syntax including:
 * - GO batch separator
 * - Bracketed identifiers ([table].[column])
 * - IDENTITY columns
 * - T-SQL specific statements
 */
export class MSSQLValidator extends AbstractDialectValidator {
  readonly dialect = "mssql" as const;

  // Cache for document content
  private cachedDoc: { content: string; version: number } | null = null;

  private getDocContent(state: EditorState): string {
    const version = state.doc.length;
    if (this.cachedDoc && this.cachedDoc.version === version) {
      return this.cachedDoc.content;
    }

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
        pattern: /^\s*GO\s*$/im,
        reason: "SQL Server GO batch separator",
      },
      {
        pattern: /\[[^\]]+\]/,
        reason: "SQL Server bracketed identifiers",
      },
      {
        pattern: /\bIDENTITY\s*(?:\(\s*\d+\s*,\s*\d+\s*\))?/i,
        reason: "SQL Server IDENTITY column",
      },
      {
        pattern: /\bROWVERSION\b/i,
        reason: "SQL Server ROWVERSION type",
      },
      {
        pattern: /\bUNIQUEIDENTIFIER\b/i,
        reason: "SQL Server UNIQUEIDENTIFIER type",
      },
      {
        pattern: /\bTOP\s+\d+/i,
        reason: "SQL Server TOP clause",
      },
      {
        pattern: /\bWITH\s*\([^)]*NOLOCK[^)]*\)/i,
        reason: "SQL Server table hint (NOLOCK)",
      },
      {
        pattern: /\bOUTPUT\s+(?:INSERTED|DELETED)\./i,
        reason: "SQL Server OUTPUT clause",
      },
      {
        pattern: /\bMERGE\s+INTO\b/i,
        reason: "SQL Server MERGE statement",
      },
      {
        pattern: /\bCROSS\s+APPLY\b/i,
        reason: "SQL Server CROSS APPLY",
      },
      {
        pattern: /\bOUTER\s+APPLY\b/i,
        reason: "SQL Server OUTER APPLY",
      },
      {
        pattern: /\bPIVOT\b/i,
        reason: "SQL Server PIVOT operator",
      },
      {
        pattern: /\bUNPIVOT\b/i,
        reason: "SQL Server UNPIVOT operator",
      },
      {
        pattern: /\bTRY_CAST\b/i,
        reason: "SQL Server TRY_CAST function",
      },
      {
        pattern: /\bTRY_CONVERT\b/i,
        reason: "SQL Server TRY_CONVERT function",
      },
      {
        pattern: /\bISNULL\s*\(/i,
        reason: "SQL Server ISNULL function",
      },
      {
        pattern: /\bNEWID\s*\(\)/i,
        reason: "SQL Server NEWID function",
      },
      {
        pattern: /\bGETDATE\s*\(\)/i,
        reason: "SQL Server GETDATE function",
      },
      {
        pattern: /\bDATEADD\s*\(/i,
        reason: "SQL Server DATEADD function",
      },
      {
        pattern: /\bDATEDIFF\s*\(/i,
        reason: "SQL Server DATEDIFF function",
      },
      {
        pattern: /\bOVER\s*\(/i,
        reason: "SQL Server OVER clause for window functions",
      },
      {
        pattern: /\bROW_NUMBER\s*\(\)/i,
        reason: "SQL Server ROW_NUMBER function",
      },
      {
        pattern: /\bRANK\s*\(\)/i,
        reason: "SQL Server RANK function",
      },
      {
        pattern: /\bDENSE_RANK\s*\(\)/i,
        reason: "SQL Server DENSE_RANK function",
      },
      {
        pattern: /\bEXEC(?:UTE)?\s+(?:sp_|xp_)/i,
        reason: "SQL Server stored procedure execution",
      },
      {
        pattern: /@\w+/,
        reason: "SQL Server variable or parameter",
      },
      {
        pattern: /\bDECLARE\s+@/i,
        reason: "SQL Server variable declaration",
      },
      {
        pattern: /\bSET\s+@/i,
        reason: "SQL Server variable assignment",
      },
      {
        pattern: /\bBEGIN\s+TRANSACTION\b/i,
        reason: "SQL Server transaction statement",
      },
      {
        pattern: /\bBEGIN\s+TRY\b/i,
        reason: "SQL Server TRY...CATCH block",
      },
      {
        pattern: /\bEND\s+TRY\b/i,
        reason: "SQL Server TRY...CATCH block",
      },
      {
        pattern: /\bBEGIN\s+CATCH\b/i,
        reason: "SQL Server TRY...CATCH block",
      },
      {
        pattern: /\bEND\s+CATCH\b/i,
        reason: "SQL Server TRY...CATCH block",
      },
      {
        pattern: /\bRAISERROR\b/i,
        reason: "SQL Server RAISERROR statement",
      },
      {
        pattern: /\bTHROW\b/i,
        reason: "SQL Server THROW statement",
      },
    ];
  }

  validateDialectSyntax(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);
    if (!doc) return diagnostics;

    // Check for unmatched brackets - optimized counting
    let openBrackets = 0;
    let closeBrackets = 0;
    let lastOpen = -1;
    let lastClose = -1;

    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '[') {
        openBrackets++;
        lastOpen = i;
      } else if (doc[i] === ']') {
        closeBrackets++;
        lastClose = i;
      }
    }

    if (openBrackets !== closeBrackets) {
      if (openBrackets > closeBrackets && lastOpen !== -1) {
        diagnostics.push({
          from: lastOpen,
          to: lastOpen + 1,
          severity: "error",
          message: "Unmatched opening bracket in identifier",
        });
      } else if (closeBrackets > openBrackets && lastClose !== -1) {
        diagnostics.push({
          from: lastClose,
          to: lastClose + 1,
          severity: "error",
          message: "Unmatched closing bracket in identifier",
        });
      }
    }

    return diagnostics;
  }

  validateBestPractices(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);
    if (!doc) return diagnostics;

    // Warn about NOLOCK hints - limit to 5
    const nolockPattern = /\bWITH\s*\([^)]*NOLOCK[^)]*\)/gi;
    let match;
    let count = 0;

    while ((match = nolockPattern.exec(doc)) !== null && count < 5) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "info",
        message:
          "NOLOCK can lead to dirty reads. Consider using appropriate isolation levels instead.",
      });
      count++;
    }

    return diagnostics;
  }
}
