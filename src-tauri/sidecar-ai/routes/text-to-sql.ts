import { generateObject } from "ai";
import { z } from "zod";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";

interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  enumValues?: string[];
}

interface TextToSQLRequest {
  prompt: string;
  columns: ColumnMeta[];
  tableName: string;
  dialect: "postgresql" | "mysql" | "sqlite" | "mssql";
  provider: string;
  model: string;
}

const responseSchema = z.object({
  whereClause: z
    .string()
    .describe("SQL WHERE clause without the WHERE keyword"),
  explanation: z
    .string()
    .optional()
    .describe("Brief explanation of the filter"),
});

function buildSystemPrompt(
  columns: ColumnMeta[],
  tableName: string,
  dialect: string
): string {
  const columnList = columns
    .map((c) => {
      let desc = `- ${c.name} (${c.dataType}${c.nullable ? ", nullable" : ""})`;
      if (c.enumValues && c.enumValues.length > 0) {
        desc += ` - values: ${c.enumValues.map(v => `'${v}'`).join(", ")}`;
      }
      return desc;
    })
    .join("\n");

  const dialectSpecific = getDialectSpecificRules(dialect);

  return `You are a SQL expert. Generate a WHERE clause to filter table data.

Table: ${tableName}
Database: ${dialect}

Available columns:
${columnList}

CRITICAL RULES:
- Return ONLY the WHERE clause expression WITHOUT the "WHERE" keyword
- ONLY use columns from the list above - never invent or guess column names
- If asked about dates/times, look for date/timestamp columns in the available columns list
- Keep expressions simple and readable
- Use appropriate operators for data types
${dialectSpecific}

Examples:
- "active users" → status = 'active'
- "orders over 100" → amount > 100
- "name contains john" → ${dialect === "postgresql" ? "name ILIKE '%john%'" : "LOWER(name) LIKE '%john%'"}
- "not null email" → email IS NOT NULL
- "between 10 and 20" → amount BETWEEN 10 AND 20
- "last 10 days" → ${dialect === "postgresql" ? "created_at >= NOW() - INTERVAL '10 days'" : dialect === "mysql" ? "created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY)" : dialect === "sqlite" ? "created_at >= datetime('now', '-10 days')" : "created_at >= DATEADD(day, -10, GETDATE())"}
- "this week" → ${dialect === "postgresql" ? "created_at >= date_trunc('week', NOW())" : "created_at >= DATE(NOW()) - WEEKDAY(NOW())"}

IMPORTANT: Match the column names EXACTLY as shown above. If asked about time periods, use the appropriate date/timestamp column from the available columns.`;
}

function getDialectSpecificRules(dialect: string): string {
  switch (dialect) {
    case "postgresql":
      return `PostgreSQL syntax rules (MUST follow exactly):
- Case-insensitive: column ILIKE '%value%'
- Current time: NOW() or CURRENT_TIMESTAMP
- Date arithmetic: column >= NOW() - INTERVAL '7 days'
- Type cast: column::date or CAST(column AS date)
- Boolean: column = true (not 1)
- String concat: column || 'text'
- Null check: column IS NULL / IS NOT NULL`;

    case "mysql":
      return `MySQL syntax rules (MUST follow exactly):
- Case-insensitive: LOWER(column) LIKE '%value%'
- Current time: NOW() or CURDATE()
- Date arithmetic: column >= DATE_SUB(NOW(), INTERVAL 7 DAY)
- Type cast: CAST(column AS DATE)
- Boolean: column = 1 or column = TRUE
- String concat: CONCAT(column, 'text')
- Null check: column IS NULL / IS NOT NULL`;

    case "sqlite":
      return `SQLite syntax rules (MUST follow exactly):
- Case-insensitive: LOWER(column) LIKE '%value%'
- Current time: datetime('now') or date('now')
- Date arithmetic: column >= datetime('now', '-7 days')
- No CAST needed (dynamic typing)
- Boolean: column = 1 or column = 0
- String concat: column || 'text'
- Null check: column IS NULL / IS NOT NULL`;

    case "mssql":
      return `SQL Server syntax rules (MUST follow exactly):
- Case-insensitive: column LIKE '%value%' (case-insensitive by default)
- Current time: GETDATE() or SYSDATETIME()
- Date arithmetic: column >= DATEADD(day, -7, GETDATE())
- Type cast: CAST(column AS DATE) or CONVERT(DATE, column)
- Boolean: column = 1 or column = 0
- String concat: column + 'text' or CONCAT(column, 'text')
- Null check: column IS NULL / IS NOT NULL`;

    default:
      return `Standard SQL syntax:
- Use LIKE for text matching
- Use standard SQL date functions`;
  }
}

export async function handleTextToSQL(request: Request): Promise<Response> {
  try {
    const body: TextToSQLRequest = await request.json();
    const { prompt, columns, tableName, dialect, provider, model } = body;

    console.log(`🔤 Text-to-SQL: "${prompt}" for ${tableName} (${dialect})`);

    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      });
    }

    if (!columns?.length) {
      return new Response(
        JSON.stringify({ error: "Column metadata is required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(request),
          },
        }
      );
    }

    const aiProvider = ProviderService.createProvider(provider);
    const aiModel = aiProvider(model);

    const result = await generateObject({
      model: aiModel,
      system: buildSystemPrompt(columns, tableName, dialect),
      prompt: `Generate the WHERE clause for: ${prompt}`,
      schema: responseSchema,
    });

    // Validate that referenced columns exist
    const validationError = validateGeneratedClause(
      result.object.whereClause,
      columns
    );
    if (validationError) {
      console.warn(`⚠️ Validation failed: ${validationError}`);
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      });
    }

    console.log(`✅ Generated WHERE: ${result.object.whereClause}`);

    return new Response(
      JSON.stringify({
        whereClause: result.object.whereClause,
        explanation: result.object.explanation,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      }
    );
  } catch (error) {
    console.error("❌ Text-to-SQL error:", error);

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to generate SQL",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(request),
        },
      }
    );
  }
}

function validateGeneratedClause(
  clause: string,
  columns: ColumnMeta[]
): string | null {
  const columnNames = new Set(columns.map((c) => c.name.toLowerCase()));

  // Extract potential column references (words that look like identifiers)
  // This is a simple heuristic - matches words before operators or in comparisons
  const potentialColumns = clause.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) || [];

  // SQL keywords and functions to ignore
  const sqlKeywords = new Set([
    "and",
    "or",
    "not",
    "in",
    "is",
    "null",
    "like",
    "ilike",
    "between",
    "true",
    "false",
    "now",
    "current_date",
    "current_timestamp",
    "interval",
    "day",
    "days",
    "week",
    "weeks",
    "month",
    "months",
    "year",
    "years",
    "hour",
    "hours",
    "minute",
    "minutes",
    "second",
    "seconds",
    "lower",
    "upper",
    "trim",
    "cast",
    "as",
    "date",
    "time",
    "timestamp",
    "datetime",
    "getdate",
    "dateadd",
    "datesub",
    "date_sub",
    "date_add",
    "date_trunc",
    "extract",
    "collate",
    "escape",
    "coalesce",
    "nullif",
    "case",
    "when",
    "then",
    "else",
    "end",
    "asc",
    "desc",
    "any",
    "all",
    "exists",
    "having",
    "group",
    "order",
    "by",
    "limit",
    "offset",
  ]);

  const unknownColumns: string[] = [];

  for (const word of potentialColumns) {
    const lowerWord = word.toLowerCase();
    if (!sqlKeywords.has(lowerWord) && !columnNames.has(lowerWord)) {
      // Check if it might be a string literal value (would be in quotes in actual SQL)
      // This is imperfect but catches obvious cases
      if (!/^\d+$/.test(word) && !unknownColumns.includes(word)) {
        unknownColumns.push(word);
      }
    }
  }

  // Only report if we're confident these are column references
  // Filter out common false positives
  const likelyColumnRefs = unknownColumns.filter((col) => {
    // Likely a column if it's used in a comparison context
    const patterns = [
      new RegExp(`\\b${col}\\s*[=<>!]`, "i"),
      new RegExp(`\\b${col}\\s+(?:is|like|ilike|in|between)\\b`, "i"),
      new RegExp(`(?:and|or|where)\\s+${col}\\b`, "i"),
    ];
    return patterns.some((p) => p.test(clause));
  });

  if (likelyColumnRefs.length > 0) {
    return `Unknown column(s): ${likelyColumnRefs.join(", ")}. Available: ${columns.map((c) => c.name).join(", ")}`;
  }

  return null;
}
