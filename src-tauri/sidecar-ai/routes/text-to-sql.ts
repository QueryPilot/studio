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

    const startTime = Date.now();
    console.log(`🔤 Text-to-SQL: "${prompt}" for ${tableName} (${dialect}) [${provider}/${model}]`);

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

    console.log(`⏳ Calling ${provider}/${model}...`);
    const llmStartTime = Date.now();

    // Add timeout for LLM call
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LLM request timeout (20s)")), 20000);
    });

    const result = await Promise.race([
      generateObject({
        model: aiModel,
        system: buildSystemPrompt(columns, tableName, dialect),
        prompt: `Generate the WHERE clause for: ${prompt}`,
        schema: responseSchema,
      }),
      timeoutPromise,
    ]);

    const llmTime = Date.now() - llmStartTime;
    console.log(`⏱️ LLM response in ${llmTime}ms`);

    const totalTime = Date.now() - startTime;
    console.log(`✅ Generated WHERE: ${result.object.whereClause} (total: ${totalTime}ms)`);

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

