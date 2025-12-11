import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import { createTextToSqlTools, type ToolContext } from "../services/tool-factory.service";
import { metrics, ToolMetrics } from "../utils/metrics";
import { rateLimiter, addRateLimitHeaders } from "../utils/rate-limiter";
import {
  createError,
  toActionableError,
  errorResponse,
  ErrorCode,
} from "../utils/errors";

// Types
interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  enumValues?: string[];
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignTable?: string;
  foreignColumn?: string;
}

interface TextToSQLRequest {
  prompt: string;
  columns: ColumnMeta[];
  tableName: string;
  schema: string;
  dialect: "postgresql" | "mysql" | "sqlite" | "mssql";
  provider: string;
  model: string;
  connectionId: string;
  enableCrossTable?: boolean;
}

// Response schema for simple mode
const responseSchema = z.object({
  whereClause: z.string().describe("SQL WHERE clause without the WHERE keyword"),
  explanation: z.string().optional().describe("Brief explanation of the filter"),
  usedSubquery: z.boolean().optional().describe("Whether a subquery was used for cross-table filtering"),
});

// Constants
const TIMEOUT_MS = 60_000;
const MAX_COLUMNS = 100;
const MAX_TOOL_ROUNDS = 8; // Increased for more complex cross-table scenarios

// Common FK naming patterns → likely referenced table (singular/plural)
const FK_PATTERNS: Array<{ pattern: RegExp; tableHints: string[] }> = [
  { pattern: /^user_id$/i, tableHints: ["users", "user", "accounts", "account"] },
  { pattern: /^created_by$/i, tableHints: ["users", "user", "accounts"] },
  { pattern: /^updated_by$/i, tableHints: ["users", "user", "accounts"] },
  { pattern: /^author_id$/i, tableHints: ["users", "user", "authors"] },
  { pattern: /^owner_id$/i, tableHints: ["users", "user", "owners"] },
  { pattern: /^org_id$/i, tableHints: ["organizations", "orgs", "org", "organization"] },
  { pattern: /^organization_id$/i, tableHints: ["organizations", "orgs", "organization"] },
  { pattern: /^company_id$/i, tableHints: ["companies", "company"] },
  { pattern: /^team_id$/i, tableHints: ["teams", "team"] },
  { pattern: /^project_id$/i, tableHints: ["projects", "project"] },
  { pattern: /^category_id$/i, tableHints: ["categories", "category"] },
  { pattern: /^parent_id$/i, tableHints: ["self"] }, // Self-referential
  { pattern: /^(.+)_id$/i, tableHints: ["$1s", "$1"] }, // Generic: foo_id → foos, foo
];

// Infer potential FK relationships from column names
interface InferredRelationship {
  column: string;
  possibleTables: string[];
  confidence: "high" | "medium" | "low";
}

function inferRelationships(columns: ColumnMeta[], currentTable: string): InferredRelationship[] {
  const inferred: InferredRelationship[] = [];

  for (const col of columns) {
    // Skip if already has explicit FK
    if (col.isForeignKey && col.foreignTable) continue;

    // Skip non-ID-like columns
    if (
      !col.name.toLowerCase().endsWith("_id") &&
      !col.name.toLowerCase().endsWith("_by") &&
      !col.name.toLowerCase().includes("_ref")
    )
      continue;

    // Skip if it's the primary key
    if (col.isPrimaryKey) continue;

    for (const { pattern, tableHints } of FK_PATTERNS) {
      const match = col.name.match(pattern);
      if (match) {
        const tables = tableHints.map((hint) => {
          if (hint === "self") return currentTable;
          if (hint.includes("$1") && match[1]) {
            return hint.replace("$1", match[1].toLowerCase());
          }
          return hint;
        });

        // Higher confidence for specific patterns
        const isSpecific = FK_PATTERNS.slice(0, -1).some((p) => p.pattern.test(col.name));

        inferred.push({
          column: col.name,
          possibleTables: tables,
          confidence: isSpecific ? "high" : "medium",
        });
        break;
      }
    }
  }

  return inferred;
}

// Build system prompt
function buildSystemPrompt(
  columns: ColumnMeta[],
  tableName: string,
  dialect: string
): string {
  // Build column list with explicit FKs marked
  const columnList = columns
    .slice(0, MAX_COLUMNS)
    .map((c) => {
      let desc = `- ${c.name} (${c.dataType}${c.nullable ? ", nullable" : ""})`;
      if (c.enumValues?.length) {
        desc += ` [enum: ${c.enumValues.slice(0, 10).map((v) => `'${v}'`).join(", ")}]`;
      }
      if (c.isForeignKey && c.foreignTable) {
        desc += ` [FK → ${c.foreignTable}.${c.foreignColumn}]`;
      }
      return desc;
    })
    .join("\n");

  // Infer potential relationships from column naming
  const inferredRels = inferRelationships(columns, tableName);
  const inferredRelText =
    inferredRels.length > 0
      ? `\n## Potential Foreign Keys (Inferred)\n${inferredRels.map((r) => `- ${r.column} → ${r.possibleTables.join(" | ")} (VERIFY with get_table_structure!)`).join("\n")}`
      : "";

  // Get dialect-specific syntax hints
  const dialectHints: Record<string, string> = {
    postgresql: `
- Case-insensitive: ILIKE '%value%'
- Date math: NOW() - INTERVAL '7 days', created_at >= '2024-01-01'::date
- Booleans: column = true / column = false
- NULL: column IS NULL, column IS NOT NULL
- Range: column BETWEEN 10 AND 100
- List: column IN ('a', 'b', 'c')
- Pattern: name ~ '^prefix' (regex)`,
    mysql: `
- Case-insensitive: LOWER(col) LIKE '%value%'
- Date math: DATE_SUB(NOW(), INTERVAL 7 DAY), created_at >= '2024-01-01'
- Booleans: column = 1 / column = 0
- NULL: column IS NULL, column IS NOT NULL
- Range: column BETWEEN 10 AND 100
- List: column IN ('a', 'b', 'c')
- Pattern: name REGEXP '^prefix'`,
    sqlite: `
- Case-insensitive: LOWER(col) LIKE '%value%'
- Date math: datetime('now', '-7 days'), date(created_at) >= '2024-01-01'
- Booleans: column = 1 / column = 0
- NULL: column IS NULL, column IS NOT NULL
- Range: column BETWEEN 10 AND 100
- List: column IN ('a', 'b', 'c')`,
    mssql: `
- Case-insensitive: col LIKE '%value%' (default case-insensitive collation)
- Date math: DATEADD(day, -7, GETDATE()), created_at >= '2024-01-01'
- Booleans: column = 1 / column = 0
- NULL: column IS NULL, column IS NOT NULL
- Range: column BETWEEN 10 AND 100
- List: column IN ('a', 'b', 'c')
- Top N: Use TOP(N) or OFFSET-FETCH for limiting
- String concat: column + ' ' + other_column`,
  };

  const dialectHint = dialectHints[dialect] || "Use standard SQL syntax";

  return `You generate SQL WHERE clauses for table \`${tableName}\` (${dialect}).

## Columns
${columnList}${inferredRelText}

## Tools Available
- **get_column_values(table, column)**: Get actual values in a column. USE THIS FIRST for any status/state/type columns!
- **get_table_structure(table)**: Get columns of another table (for cross-table queries)
- **execute_readonly_query(sql)**: Run SELECT to find IDs
- **submit_where_clause(whereClause, explanation)**: Submit your final answer. REQUIRED!

## Rules
1. NEVER guess column values. Call get_column_values first to see what values exist.
2. For cross-table filters (e.g., "by user John"), use: \`column IN (SELECT id FROM table WHERE ...)\`
3. ${dialect === "postgresql" ? "Use ILIKE for case-insensitive text search" : "Use LOWER(col) LIKE for case-insensitive text search"}
4. You MUST call submit_where_clause with your answer.

## Syntax (${dialect})
${dialectHint}`;
}

// Result type from submit_where_clause tool
interface SubmitWhereClauseResult {
  success: true;
  whereClause: string;
  explanation?: string;
  usedSubquery?: boolean;
  confidence?: "high" | "medium" | "low";
}

// Agentic mode - always uses tools for schema verification
async function generateWhereClauseWithTools(
  aiModel: ReturnType<ReturnType<typeof ProviderService.getProvider>>,
  systemPrompt: string,
  prompt: string,
  connectionId: string,
  tableName: string,
  schema: string,
  signal: AbortSignal,
  columns: ColumnMeta[]
): Promise<{ object: z.infer<typeof responseSchema> }> {
  console.log(`🔍 [Text-to-SQL] Starting agentic exploration for: "${prompt}"`);
  console.log(`   Connection: ${connectionId}, Schema: ${schema}, Table: ${tableName}`);

  // Create tools with bound context using the tool factory
  const toolContext: ToolContext = { connectionId, schema };
  const tools = createTextToSqlTools(toolContext);

  // Track if submit_where_clause was called
  let submittedResult: SubmitWhereClauseResult | null = null;

  // Identify likely status/state columns that need verification
  const statusLikeColumns = columns
    .filter((c) => {
      const name = c.name.toLowerCase();
      return (
        name.includes("status") ||
        name.includes("state") ||
        name.includes("done") ||
        name.includes("complete") ||
        name.includes("active") ||
        name.includes("type") ||
        name.includes("priority") ||
        name.includes("flag") ||
        c.dataType.toLowerCase().includes("bool") ||
        c.dataType.toLowerCase().includes("enum")
      );
    })
    .map((c) => c.name);

  // Build a concise hint about which columns likely need value verification
  const statusColumnsHint =
    statusLikeColumns.length > 0
      ? `\nStatus-like columns detected: ${statusLikeColumns.join(", ")} - call get_column_values on these first!`
      : "";

  const result = await generateText({
    model: aiModel,
    system: systemPrompt,
    prompt: `Filter: "${prompt}"
Table: ${tableName} (schema: ${schema})
${statusColumnsHint}

Steps:
1. Call get_column_values on any status/state columns to see actual values
2. Build the WHERE clause using verified column names and values
3. Call submit_where_clause with your answer`,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    abortSignal: signal,
    onStepFinish: (step) => {
      const hasToolResults = step.toolResults && step.toolResults.length > 0;
      console.log(
        `📍 [Text-to-SQL] Step finished. finishReason: ${step.finishReason}, hasToolResults: ${hasToolResults}`
      );

      // Log tool calls
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          console.log(`🔧 [Text-to-SQL] Tool call: ${tc.toolName}`, JSON.stringify(tc.input || {}));
        }
      }

      // Check for submit_where_clause result
      if (step.toolResults && step.toolResults.length > 0) {
        for (const tr of step.toolResults) {
          const resultStr = tr.output != null ? JSON.stringify(tr.output) : "undefined";
          const preview = resultStr.slice(0, 300);
          console.log(
            `📦 [Text-to-SQL] Tool result (${tr.toolName}): ${preview}${resultStr.length > 300 ? "..." : ""}`
          );

          // Capture submit_where_clause result
          if (tr.toolName === "submit_where_clause" && tr.output) {
            const output = tr.output as SubmitWhereClauseResult;
            if (output.success && output.whereClause) {
              submittedResult = output;
              console.log(`✅ [Text-to-SQL] Captured submit_where_clause: ${output.whereClause}`);
            }
          }
        }
      }

      if (step.text) {
        console.log(
          `📝 [Text-to-SQL] Step text: ${step.text.slice(0, 200)}${step.text.length > 200 ? "..." : ""}`
        );
      }
    },
  });

  // Log stats
  console.log(`📊 [Text-to-SQL] Steps count: ${result.steps?.length ?? 0}`);
  console.log(`📊 [Text-to-SQL] Finish reason: ${result.finishReason}`);

  const toolCalls = result.steps?.flatMap((s) => s.toolCalls || []) || [];
  console.log(`📊 [Text-to-SQL] Total tool calls: ${toolCalls.length}`);

  // Check if submit_where_clause was called
  if (submittedResult) {
    console.log(`✅ [Text-to-SQL] Using submitted WHERE clause: ${submittedResult.whereClause}`);
    return {
      object: {
        whereClause: submittedResult.whereClause,
        explanation: submittedResult.explanation,
        usedSubquery: submittedResult.usedSubquery,
      },
    };
  }

  // Fallback: Check all tool results for submit_where_clause
  for (const step of result.steps || []) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName === "submit_where_clause" && tr.output) {
        const output = tr.output as SubmitWhereClauseResult;
        if (output.success && output.whereClause) {
          console.log(`✅ [Text-to-SQL] Found in steps: ${output.whereClause}`);
          return {
            object: {
              whereClause: output.whereClause,
              explanation: output.explanation,
              usedSubquery: output.usedSubquery,
            },
          };
        }
      }
    }
  }

  // No fallback parsing - if the model didn't call submit_where_clause, it failed
  const text = result.text;
  console.error(`❌ [Text-to-SQL] submit_where_clause was NOT called. Response:\n${text.slice(0, 1000)}`);
  console.error(`❌ [Text-to-SQL] Tool calls made: ${toolCalls.map((tc) => tc.toolName).join(", ") || "NONE"}`);

  throw new Error(
    "AI did not call submit_where_clause. Please try rephrasing your filter request."
  );
}

// Main handler
export async function handleTextToSQL(request: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(request);

  // Rate limiting check
  const rateLimitKey = request.headers.get("X-Connection-Id") || "anonymous";
  const rateLimitResult = rateLimiter.checkWithGlobal("text-to-sql", rateLimitKey);

  if (!rateLimitResult.allowed) {
    const error = createError(ErrorCode.RATE_LIMITED, {
      retryAfterMs: rateLimitResult.retryAfterMs,
      resetAt: new Date(rateLimitResult.resetAt).toISOString(),
    });
    return errorResponse(error, corsHeaders);
  }

  // Start metrics tracking
  const metric = ToolMetrics.textToSql("request");

  try {
    const body: TextToSQLRequest = await request.json();
    const {
      prompt,
      columns,
      tableName,
      schema = "public",
      dialect,
      provider,
      model,
      connectionId,
      // enableCrossTable is now ignored - always use agentic mode
    } = body;

    console.log(
      `🔤 Text-to-SQL: "${prompt}" for ${tableName} (${dialect}) [${provider}/${model}] [agentic]`
    );

    // Validation with actionable errors
    if (!prompt?.trim()) {
      const error = createError(ErrorCode.INVALID_PROMPT);
      metrics.endOperation(metric, false, error.message);
      return errorResponse(error, corsHeaders);
    }

    if (!columns?.length) {
      const error = createError(ErrorCode.INVALID_COLUMNS);
      metrics.endOperation(metric, false, error.message);
      return errorResponse(error, corsHeaders);
    }

    // connectionId is now required for agentic mode
    if (!connectionId) {
      const error = createError(ErrorCode.INVALID_CONNECTION, {
        reason: "connectionId is required for text-to-SQL (agentic mode requires schema access)",
      });
      metrics.endOperation(metric, false, error.message);
      return errorResponse(error, corsHeaders);
    }

    // Get cached provider
    const aiProvider = ProviderService.getProvider(provider);
    const aiModel = aiProvider(model);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(columns, tableName, dialect);

    // Setup timeout with cleanup
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Track AI generation with metrics
      const aiMetric = ToolMetrics.textToSql(dialect);

      // Always use agentic mode with tools for schema verification
      const result = await generateWhereClauseWithTools(
        aiModel,
        systemPrompt,
        prompt,
        connectionId,
        tableName,
        schema,
        controller.signal,
        columns
      );

      metrics.endOperation(aiMetric, true);
      console.log(`✅ Generated WHERE: ${result.object.whereClause}`);

      // Success - end metrics
      metrics.endOperation(metric, true);

      const response = new Response(
        JSON.stringify({
          whereClause: result.object.whereClause,
          explanation: result.object.explanation,
          usedSubquery: result.object.usedSubquery,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );

      return addRateLimitHeaders(response, "text-to-sql", rateLimitKey);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = createError(ErrorCode.AI_TIMEOUT, {
          timeoutMs: TIMEOUT_MS,
          prompt: prompt.slice(0, 100),
        });
        metrics.endOperation(metric, false, timeoutError.message);
        return errorResponse(timeoutError, corsHeaders);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("❌ Text-to-SQL error:", error);

    // Convert to actionable error
    const actionableError = toActionableError(error);
    metrics.endOperation(metric, false, actionableError.message);
    return errorResponse(actionableError, corsHeaders);
  }
}
