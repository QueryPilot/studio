import { generateObject, generateText, stepCountIs } from "ai";
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
  dialect: string,
  enableCrossTable: boolean
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
      ? `\n## Inferred Relationships\n${inferredRels.map((r) => `- ${r.column} → ${r.possibleTables.join(" | ")}`).join("\n")}`
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

  const crossTableInstructions = enableCrossTable
    ? `
## Cross-Table Filtering

When the user references entities from other tables (e.g., "orders by John", "items in category X"):

### Available Tools
- **list_tables**: Get all tables in the schema
- **get_table_structure**: Get columns for a specific table (ALWAYS use this to verify column names!)
- **get_indexes**: Check which columns are indexed (for performance)
- **get_foreign_keys**: Get FK relationships for a table
- **search_tables**: Search for a value across multiple tables at once (efficient!)
- **execute_readonly_query**: Run a SELECT query to find specific IDs
- **submit_where_clause**: Submit your final answer (REQUIRED!)

### CRITICAL: Verify Column Names
**NEVER assume column names!** Different databases use different naming conventions:
- User name might be: \`name\`, \`username\`, \`full_name\`, \`display_name\`, \`email\`
- User ID reference might be: \`user_id\`, \`owner_id\`, \`created_by\`, \`assigned_to\`

**You MUST call get_table_structure on related tables to discover the actual column names.**

### Workflow (MUST follow in order)
1. If the filter references another entity (user, category, etc.):
   a. Call **get_table_structure** on the related table to see its actual columns
   b. Identify the correct column for the search (don't guess!)
2. Use the discovered column names in your subquery
3. Call **submit_where_clause** with your final answer

### Output Format
Use simple IN subqueries only:
- \`user_id IN (SELECT id FROM users WHERE username ILIKE '%John%')\`
- \`category_id IN (SELECT id FROM categories WHERE title ILIKE '%Electronics%')\`

Do NOT use JOINs, CTEs, or complex nested queries.

### IMPORTANT
- **ALWAYS explore schema first** - call get_table_structure before writing subqueries
- **ALWAYS call submit_where_clause** with your final WHERE clause
- Do not just output text - call the tools!`
    : "";

  return `# SQL WHERE Clause Generator

You generate WHERE clause expressions (without the WHERE keyword) for filtering table data.

## Target Table
- Table: \`${tableName}\`
- Dialect: ${dialect}

## Available Columns
${columnList}${inferredRelText}

## Syntax Rules
${dialectHint}
${crossTableInstructions}

## Examples

### Basic Filters
- "active users" → \`status = 'active'\`
- "orders over 100" → \`amount > 100\`
- "name contains john" → \`${dialect === "postgresql" ? "name ILIKE '%john%'" : dialect === "mssql" ? "name LIKE '%john%'" : "LOWER(name) LIKE '%john%'"}\`

### Date Filters
- "created this week" → \`${dialect === "postgresql" ? "created_at >= NOW() - INTERVAL '7 days'" : dialect === "mysql" ? "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)" : dialect === "mssql" ? "created_at >= DATEADD(day, -7, GETDATE())" : "created_at >= datetime('now', '-7 days')"}\`
- "created in January 2024" → \`${dialect === "postgresql" ? "created_at >= '2024-01-01' AND created_at < '2024-02-01'" : "created_at >= '2024-01-01' AND created_at < '2024-02-01'"}\`
- "updated between dates" → \`updated_at BETWEEN '2024-01-01' AND '2024-12-31'\`

### Range & List Filters
- "price between 50 and 100" → \`price BETWEEN 50 AND 100\`
- "status in pending or approved" → \`status IN ('pending', 'approved')\`
- "age 18 to 25" → \`age >= 18 AND age <= 25\`

### NULL Handling
- "missing email" → \`email IS NULL\`
- "has phone number" → \`phone IS NOT NULL\`
- "incomplete profiles" → \`(email IS NULL OR name IS NULL)\`

### Combined Filters
- "active premium users" → \`status = 'active' AND tier = 'premium'\`
- "orders over 100 or vip" → \`amount > 100 OR customer_type = 'vip'\``;
}

// Simple mode - no tools, direct generation
async function generateSimpleWhereClause(
  aiModel: ReturnType<ReturnType<typeof ProviderService.getProvider>>,
  systemPrompt: string,
  prompt: string,
  signal: AbortSignal
) {
  return generateObject({
    model: aiModel,
    system: systemPrompt,
    prompt: `Generate the WHERE clause for: ${prompt}`,
    schema: responseSchema,
    abortSignal: signal,
  });
}

// Result type from submit_where_clause tool
interface SubmitWhereClauseResult {
  success: true;
  whereClause: string;
  explanation?: string;
  usedSubquery?: boolean;
  confidence?: "high" | "medium" | "low";
}

// Advanced mode - with tools for cross-table exploration
async function generateCrossTableWhereClause(
  aiModel: ReturnType<ReturnType<typeof ProviderService.getProvider>>,
  systemPrompt: string,
  prompt: string,
  connectionId: string,
  tableName: string,
  schema: string,
  signal: AbortSignal
): Promise<{ object: z.infer<typeof responseSchema> }> {
  console.log(`🔍 [Cross-Table] Starting exploration for: "${prompt}"`);
  console.log(`   Connection: ${connectionId}, Schema: ${schema}, Table: ${tableName}`);

  // Create tools with bound context using the tool factory
  const toolContext: ToolContext = { connectionId, schema };
  const tools = createTextToSqlTools(toolContext);

  // Track if submit_where_clause was called
  let submittedResult: SubmitWhereClauseResult | null = null;

  const result = await generateText({
    model: aiModel,
    system: systemPrompt,
    prompt: `Generate the WHERE clause for: ${prompt}

Current table: ${tableName} (in schema: ${schema})

MANDATORY WORKFLOW:
1. Analyze the filter request
2. If it references other entities (users, categories, etc.):
   - FIRST: Call **get_table_structure** on the related table to discover actual column names
   - NEVER guess column names like "name" or "username" - verify them!
   - THEN: Build your subquery using the discovered columns
3. Generate the WHERE clause with correct column names
4. **CALL submit_where_clause with your final answer**

CRITICAL: You MUST explore the schema before writing subqueries. Do not assume column names!`,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    abortSignal: signal,
    onStepFinish: (step) => {
      const hasToolResults = step.toolResults && step.toolResults.length > 0;
      console.log(
        `📍 [Cross-Table] Step finished. finishReason: ${step.finishReason}, hasToolResults: ${hasToolResults}`
      );

      // Log tool calls
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          console.log(`🔧 [Cross-Table] Tool call: ${tc.toolName}`, JSON.stringify(tc.input || {}));
        }
      }

      // Check for submit_where_clause result
      if (step.toolResults && step.toolResults.length > 0) {
        for (const tr of step.toolResults) {
          const resultStr = tr.output != null ? JSON.stringify(tr.output) : "undefined";
          const preview = resultStr.slice(0, 300);
          console.log(
            `📦 [Cross-Table] Tool result (${tr.toolName}): ${preview}${resultStr.length > 300 ? "..." : ""}`
          );

          // Capture submit_where_clause result
          if (tr.toolName === "submit_where_clause" && tr.output) {
            const output = tr.output as SubmitWhereClauseResult;
            if (output.success && output.whereClause) {
              submittedResult = output;
              console.log(`✅ [Cross-Table] Captured submit_where_clause: ${output.whereClause}`);
            }
          }
        }
      }

      if (step.text) {
        console.log(
          `📝 [Cross-Table] Step text: ${step.text.slice(0, 200)}${step.text.length > 200 ? "..." : ""}`
        );
      }
    },
  });

  // Log stats
  console.log(`📊 [Cross-Table] Steps count: ${result.steps?.length ?? 0}`);
  console.log(`📊 [Cross-Table] Finish reason: ${result.finishReason}`);

  const toolCalls = result.steps?.flatMap((s) => s.toolCalls || []) || [];
  console.log(`📊 [Cross-Table] Total tool calls: ${toolCalls.length}`);

  // Check if submit_where_clause was called
  if (submittedResult) {
    console.log(`✅ [Cross-Table] Using submitted WHERE clause: ${submittedResult.whereClause}`);
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
          console.log(`✅ [Cross-Table] Found in steps: ${output.whereClause}`);
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

  // Last resort: try to parse from text response
  const text = result.text;
  console.log(
    `⚠️ [Cross-Table] submit_where_clause not called, trying text parsing:\n${text.slice(0, 500)}`
  );

  // Try various text patterns
  const patterns = [
    /WHERE_CLAUSE:\s*(.+?)(?:\n|EXPLANATION:|$)/s,
    /whereClause['":\s]+([^'"}\n]+)/i,
    /`([^`]+)`/,
    /```sql?\n?([^`]+)```/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const clause = match[1].trim().replace(/^WHERE\s+/i, "");
      if (clause.length > 0 && clause.length < 1000) {
        console.log(`⚠️ [Cross-Table] Fallback parsed: ${clause}`);
        return {
          object: {
            whereClause: clause,
            explanation: "Generated with cross-table exploration (fallback parsing)",
            usedSubquery: clause.toLowerCase().includes("select"),
          },
        };
      }
    }
  }

  console.error(`❌ [Cross-Table] Could not extract WHERE clause from response:\n${text}`);
  throw new Error(
    "Could not parse WHERE clause from AI response. The AI may not have found a valid filter or did not call submit_where_clause."
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
      enableCrossTable = false,
    } = body;

    console.log(
      `🔤 Text-to-SQL: "${prompt}" for ${tableName} (${dialect}) [${provider}/${model}]${enableCrossTable ? " [cross-table]" : ""}`
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

    if (enableCrossTable && !connectionId) {
      const error = createError(ErrorCode.INVALID_CONNECTION, {
        reason: "connectionId is required for cross-table filtering",
      });
      metrics.endOperation(metric, false, error.message);
      return errorResponse(error, corsHeaders);
    }

    // Get cached provider
    const aiProvider = ProviderService.getProvider(provider);
    const aiModel = aiProvider(model);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(columns, tableName, dialect, enableCrossTable);

    // Setup timeout with cleanup
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      let result: { object: z.infer<typeof responseSchema> };

      // Track AI generation with metrics
      const aiMetric = ToolMetrics.textToSql(dialect);

      if (enableCrossTable && connectionId) {
        // Advanced mode with cross-table tools
        result = await generateCrossTableWhereClause(
          aiModel,
          systemPrompt,
          prompt,
          connectionId,
          tableName,
          schema,
          controller.signal
        );
      } else {
        // Simple mode - direct generation
        result = await generateSimpleWhereClause(aiModel, systemPrompt, prompt, controller.signal);
      }

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
