import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { AbstractDialectValidator, type SuppressionPattern } from "./base";

/**
 * PostgreSQL dialect validator
 * Handles PostgreSQL-specific syntax including:
 * - Dollar-quoted strings ($tag$ ... $tag$ or $$ ... $$)
 * - Type casts (::type)
 * - Array literals (ARRAY[...])
 * - PL/pgSQL blocks
 * - RETURNING clauses
 */
export class PostgreSQLValidator extends AbstractDialectValidator {
  readonly dialect = "postgresql" as const;

  getSuppressionPatterns(): SuppressionPattern[] {
    return [
      {
        pattern: /\$/,
        reason: "PostgreSQL dollar-quoted strings",
        validate: (_snippet: string, context: string) => {
          // Check if this $ is part of a dollar quote tag ($tag$ or $$)
          // Dollar quotes are used in functions, procedures, triggers, and DO blocks
          const hasDollarQuotePattern = /\$\w*\$/.test(context);

          if (!hasDollarQuotePattern) return false;

          // If we see a dollar quote pattern, check if it's in a valid context
          // This includes: AS $tag$, $tag$ LANGUAGE, CREATE FUNCTION, etc.
          const hasValidContext =
            /\bAS\s+\$/i.test(context) ||
            /\$[\s\n]+(?:BEGIN|DECLARE)/i.test(context) ||
            /(?:END|RETURN)\s*;?\s*\$/i.test(context) ||
            /\bLANGUAGE\s+(?:plpgsql|sql)/i.test(context) ||
            /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER)\b/i.test(
              context,
            ) ||
            /\bDO\s+\$\$/i.test(context);

          return hasValidContext;
        },
      },
      {
        pattern: /::[a-zA-Z_][\w[\]()]*/,
        reason: "PostgreSQL type cast operator",
      },
      {
        pattern: /\bARRAY\s*\[[\s\S]*?\]/i,
        reason: "PostgreSQL array literal syntax",
      },
      {
        pattern: /\bRETURNING\b/i,
        reason: "PostgreSQL RETURNING clause",
      },
      {
        pattern:
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER)\b/i,
        reason: "PostgreSQL function/procedure/trigger definition",
      },
      {
        pattern: /\bLANGUAGE\s+(?:plpgsql|sql|plpython3u|plperl)\b/i,
        reason: "PostgreSQL procedural language declaration",
      },
      {
        pattern: /\bDECLARE[\s\S]*?BEGIN[\s\S]*?END\s*;?\s*\$\w*\$/i,
        reason: "PostgreSQL PL/pgSQL block structure",
      },
      {
        pattern: /\bFOREACH\b/i,
        reason: "PostgreSQL FOREACH loop",
      },
      {
        pattern: /\bRAISE\s+(?:NOTICE|WARNING|EXCEPTION|INFO|LOG|DEBUG)\b/i,
        reason: "PostgreSQL RAISE statement",
      },
      {
        pattern: /\bPERFORM\b/i,
        reason: "PostgreSQL PERFORM statement (PL/pgSQL)",
      },
      {
        pattern: /\bGENERATED\s+(?:ALWAYS\s+)?AS\s+IDENTITY\b/i,
        reason: "PostgreSQL IDENTITY column",
      },
      {
        pattern: /\bON\s+CONFLICT\b/i,
        reason: "PostgreSQL ON CONFLICT clause (upsert)",
      },
      {
        pattern: /\b(?:json|jsonb)_\w+/i,
        reason: "PostgreSQL JSON functions",
      },
      {
        pattern: /->>|->|#>>|#>|@>|<@|\?\||\?&/,
        reason: "PostgreSQL JSON/JSONB operators",
      },
      {
        pattern: /\bEXCLUDE\s+USING/i,
        reason: "PostgreSQL exclusion constraint",
      },
      {
        pattern: /\|\|/,
        reason: "PostgreSQL string concatenation operator",
      },
    ];
  }

  // Cache for document content to avoid repeated toString() calls
  private cachedDoc: { content: string; version: number } | null = null;

  private getDocContent(state: EditorState): string {
    // Only rebuild if document changed
    const version = (state as any).doc?.length || 0;
    if (this.cachedDoc && this.cachedDoc.version === version) {
      return this.cachedDoc.content;
    }

    // For large documents, skip expensive validation
    if (state.doc.length > 100000) {
      this.cachedDoc = { content: "", version };
      return "";
    }

    const content = state.doc.toString();
    this.cachedDoc = { content, version };
    return content;
  }

  validateDialectSyntax(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);

    // Skip if document is too large
    if (!doc) return diagnostics;

    // Check for unmatched dollar quotes
    const dollarQuoteRegex = /\$(\w*)\$/g;
    const quotes: Array<{ tag: string; pos: number; length: number }> = [];
    let match;

    while ((match = dollarQuoteRegex.exec(doc)) !== null) {
      quotes.push({
        tag: match[1] || "",
        pos: match.index,
        length: match[0].length
      });
    }

    // Check for matching pairs using Map for O(1) lookup
    const tagCounts = new Map<string, number>();

    for (const quote of quotes) {
      tagCounts.set(quote.tag, (tagCounts.get(quote.tag) || 0) + 1);
    }

    // Find unmatched tags (odd count)
    const unmatchedTags = new Set<string>();
    for (const [tag, count] of tagCounts.entries()) {
      if (count % 2 !== 0) {
        unmatchedTags.add(tag);
      }
    }

    // Report unmatched quotes (only first occurrence)
    if (unmatchedTags.size > 0) {
      for (const quote of quotes) {
        if (unmatchedTags.has(quote.tag)) {
          const tagStr = quote.tag ? `$${quote.tag}$` : "$$";
          diagnostics.push({
            from: quote.pos,
            to: quote.pos + quote.length,
            severity: "error",
            message: `Unmatched dollar quote ${tagStr}`,
          });
          unmatchedTags.delete(quote.tag);
          if (unmatchedTags.size === 0) break;
        }
      }
    }

    return diagnostics;
  }

  validateBestPractices(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const doc = this.getDocContent(state);

    // Skip if document is too large or empty
    if (!doc || doc.length > 50000) return diagnostics;

    // Optimized pattern - limit scope and use non-greedy
    const concatenationPattern =
      /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)[^;]{0,200}?\|\|[^;]{0,200}?(?:SELECT|FROM|WHERE)/gi;
    let match;

    while ((match = concatenationPattern.exec(doc)) !== null) {
      const matchText = match[0];
      // Quick check before expensive regex
      if (matchText.includes("'") || matchText.includes('"')) {
        if (/['"].*?SELECT.*?['"]|\|\|.*?['"].*?FROM/i.test(matchText)) {
          diagnostics.push({
            from: match.index,
            to: match.index + matchText.length,
            severity: "warning",
            message:
              "Avoid string concatenation in SQL queries. Consider using parameterized queries to prevent SQL injection.",
          });
        }
      }
    }

    return diagnostics;
  }
}
