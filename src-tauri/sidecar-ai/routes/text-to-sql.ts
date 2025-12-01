import { generateObject, generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import { TAURI_API_URL } from "../config/constants";

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

// Response schema
const responseSchema = z.object({
  whereClause: z.string().describe("SQL WHERE clause without the WHERE keyword"),
  explanation: z.string().optional().describe("Brief explanation of the filter"),
  usedSubquery: z.boolean().optional().describe("Whether a subquery was used for cross-table filtering"),
});

// Constants
const TIMEOUT_MS = 60_000;
const MAX_COLUMNS = 100;
const MAX_TOOL_ROUNDS = 5;

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
    if (!col.name.toLowerCase().endsWith("_id") &&
        !col.name.toLowerCase().endsWith("_by") &&
        !col.name.toLowerCase().includes("_ref")) continue;

    // Skip if it's the primary key
    if (col.isPrimaryKey) continue;

    for (const { pattern, tableHints } of FK_PATTERNS) {
      const match = col.name.match(pattern);
      if (match) {
        const tables = tableHints.map(hint => {
          if (hint === "self") return currentTable;
          if (hint.includes("$1") && match[1]) {
            return hint.replace("$1", match[1].toLowerCase());
          }
          return hint;
        });

        // Higher confidence for specific patterns
        const isSpecific = FK_PATTERNS.slice(0, -1).some(p => p.pattern.test(col.name));

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

// Helper to call Tauri backend via HTTP proxy (with bound context)
async function callTauri(command: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  console.log(`🔧 [Tool] Calling Tauri command: ${command}`, JSON.stringify(args));

  try {
    const response = await fetch(`${TAURI_API_URL}/__tauri__/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: command, args }),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [Tool] ${command} failed (${response.status}) after ${elapsed}ms:`, errorText);
      throw new Error(`Command failed: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ [Tool] ${command} succeeded in ${elapsed}ms`);
    return result;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`❌ [Tool] ${command} - HTTP server not reachable at ${TAURI_API_URL}`);
      throw new Error(`Cannot reach Tauri HTTP server. Is the app running?`);
    }
    throw error;
  }
}

// Factory function to create cross-table tools with bound context
// This ensures connectionId and schema are automatically included in all tool calls
function createCrossTableTools(connectionId: string, schema: string) {
  return {
    list_tables: tool({
      description: "Get all tables in the current schema. Returns table names, row counts, and sizes.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const result = await callTauri("get_tables", { conn_id: connectionId, schema });
          console.log(`📋 [list_tables] Raw result from callTauri:`, JSON.stringify(result).slice(0, 300));
          const response = {
            success: true,
            tables: result.map((t: { name: string; schema?: string; row_count?: number; size?: string }) => ({
              name: t.name,
              schema: t.schema || schema,
              rowCount: t.row_count,
              size: t.size,
            })),
          };
          console.log(`📋 [list_tables] Returning:`, JSON.stringify(response).slice(0, 300));
          return response;
        } catch (error) {
          console.error(`📋 [list_tables] Error:`, error);
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
        }
      },
    }),

    get_table_structure: tool({
      description: "Get columns, data types, and constraints for a specific table.",
      inputSchema: z.object({
        table: z.string().describe("The table name to inspect"),
      }),
      execute: async ({ table }) => {
        try {
          const [columns, constraints] = await Promise.all([
            callTauri("get_columns", { conn_id: connectionId, schema, table }),
            callTauri("get_constraints", { conn_id: connectionId, table }),
          ]);
          return {
            success: true,
            table,
            columns: columns.map((c: { name: string; db_type: string; nullable: boolean; primary_key?: boolean; default_value?: string }) => ({
              name: c.name,
              dataType: c.db_type,
              nullable: c.nullable,
              primaryKey: c.primary_key,
              defaultValue: c.default_value,
            })),
            constraints: constraints.map((c: { name: string; constraint_type: string; definition?: string }) => ({
              name: c.name,
              type: c.constraint_type,
              definition: c.definition,
            })),
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
        }
      },
    }),

    get_foreign_keys: tool({
      description: "Get foreign key relationships for a table.",
      inputSchema: z.object({
        table: z.string().describe("The table name to get FKs for"),
      }),
      execute: async ({ table }) => {
        try {
          const constraints = await callTauri("get_constraints", { conn_id: connectionId, table });
          const foreignKeys = constraints.filter(
            (c: { constraint_type: string }) =>
              c.constraint_type === "ForeignKey" || c.constraint_type === "FOREIGN KEY"
          );
          return {
            success: true,
            foreignKeys: foreignKeys.map((fk: { name: string; definition?: string; foreign_table?: string }) => ({
              name: fk.name,
              definition: fk.definition,
              foreignTable: fk.foreign_table,
            })),
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
        }
      },
    }),

    execute_readonly_query: tool({
      description: "Execute a read-only SELECT query to find data. Use this to search for IDs in related tables.",
      inputSchema: z.object({
        sql: z.string().describe("The SELECT query to execute (must start with SELECT or WITH)"),
      }),
      execute: async ({ sql }) => {
        // Validate SELECT only
        const trimmed = sql.trim().toLowerCase();
        if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
          return { success: false, error: "Only SELECT queries are allowed" };
        }

        // Block dangerous keywords
        const dangerous = ["insert", "update", "delete", "drop", "create", "alter", "truncate"];
        const found = dangerous.find((kw) => trimmed.includes(kw));
        if (found) {
          return { success: false, error: `Query contains forbidden keyword: ${found.toUpperCase()}` };
        }

        try {
          // Add LIMIT if not present
          const finalSql = trimmed.includes("limit") ? sql : `${sql} LIMIT 100`;
          const rows = await callTauri("execute_query", { conn_id: connectionId, sql: finalSql });
          return {
            success: true,
            rows,
            rowCount: rows.length,
            query: finalSql,
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
        }
      },
    }),
  };
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
  const inferredRelText = inferredRels.length > 0
    ? `\n## Inferred Relationships\n${inferredRels.map(r => `- ${r.column} → ${r.possibleTables.join(" | ")}`).join("\n")}`
    : "";

  // Get dialect-specific syntax hints
  const dialectHint = dialect === "postgresql"
    ? "Use ILIKE for case-insensitive, NOW() - INTERVAL '7 days' for dates, column = true for booleans"
    : dialect === "mysql"
    ? "Use LOWER(col) LIKE for case-insensitive, DATE_SUB(NOW(), INTERVAL 7 DAY) for dates, column = 1 for booleans"
    : dialect === "sqlite"
    ? "Use LOWER(col) LIKE for case-insensitive, datetime('now', '-7 days') for dates, column = 1 for booleans"
    : "Use standard SQL syntax";

  const crossTableInstructions = enableCrossTable
    ? `
## Cross-Table Filtering

When the user references entities from other tables (e.g., "orders by John", "items in category X"):

### Workflow
1. Check if column has explicit FK (marked with [FK → table.column])
2. If not, use inferred relationships or call list_tables to find related table
3. Call get_table_structure to find searchable columns (name, email, title, etc.)
4. Call execute_readonly_query: \`SELECT id FROM table WHERE name ILIKE '%search%'\`
5. Generate WHERE clause with IN subquery

### Output Format
Use simple IN subqueries only:
- \`user_id IN (SELECT id FROM users WHERE name ILIKE '%John%')\`
- \`category_id IN (SELECT id FROM categories WHERE name ILIKE '%Electronics%')\`

Do NOT use JOINs, CTEs, or complex nested queries.`
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
- "active users" → \`status = 'active'\`
- "orders over 100" → \`amount > 100\`
- "name contains john" → \`${dialect === "postgresql" ? "name ILIKE '%john%'" : "LOWER(name) LIKE '%john%'"}\`
- "created this week" → \`${dialect === "postgresql" ? "created_at >= NOW() - INTERVAL '7 days'" : dialect === "mysql" ? "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)" : "created_at >= datetime('now', '-7 days')"}\``;
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

// Advanced mode - with tools for cross-table exploration
async function generateCrossTableWhereClause(
  aiModel: ReturnType<ReturnType<typeof ProviderService.getProvider>>,
  systemPrompt: string,
  prompt: string,
  connectionId: string,
  tableName: string,
  schema: string,
  signal: AbortSignal
) {
  console.log(`🔍 [Cross-Table] Starting exploration for: "${prompt}"`);
  console.log(`   Connection: ${connectionId}, Schema: ${schema}, Table: ${tableName}`);

  // Create tools with bound context - AI doesn't need to pass connectionId/schema
  const tools = createCrossTableTools(connectionId, schema);

  const result = await generateText({
    model: aiModel,
    system: systemPrompt,
    prompt: `Generate the WHERE clause for: ${prompt}

Current table: ${tableName} (in schema: ${schema})

WORKFLOW for cross-table filtering (e.g., "todos by User John"):
1. Use list_tables to see available tables
2. Use get_table_structure on related tables to find searchable columns (name, email, title, etc.)
3. Use execute_readonly_query to search: SELECT id FROM related_table WHERE name ILIKE '%search_term%'
4. Generate final WHERE: fk_column IN (SELECT id FROM related_table WHERE condition)

CONSTRAINTS:
- Use simple IN subqueries, NOT JOINs
- Keep subqueries simple - single table, single condition

After exploring, output ONLY the final WHERE clause in this exact format:
WHERE_CLAUSE: <your where clause here>
EXPLANATION: <brief explanation>`,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    abortSignal: signal,
    onStepFinish: (step) => {
      // v5: stepType was removed, use finishReason and toolResults to determine step type
      const hasToolResults = step.toolResults && step.toolResults.length > 0;
      console.log(`📍 [Cross-Table] Step finished. finishReason: ${step.finishReason}, hasToolResults: ${hasToolResults}`);
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          // v5: args renamed to input
          console.log(`🔧 [Cross-Table] Tool call: ${tc.toolName}`, JSON.stringify(tc.input || {}));
        }
      }
      if (step.toolResults && step.toolResults.length > 0) {
        for (const tr of step.toolResults) {
          // v5: result renamed to output
          const resultStr = tr.output != null ? JSON.stringify(tr.output) : "undefined";
          const preview = resultStr.slice(0, 300);
          console.log(`📦 [Cross-Table] Tool result (${tr.toolName}): ${preview}${resultStr.length > 300 ? '...' : ''}`);
        }
      }
      if (step.text) {
        console.log(`📝 [Cross-Table] Step text: ${step.text.slice(0, 200)}${step.text.length > 200 ? '...' : ''}`);
      }
    },
  });

  // Parse the response to extract WHERE clause
  const text = result.text;
  console.log(`📝 [Cross-Table] AI response text:\n${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);

  // Log full result structure for debugging
  console.log(`📊 [Cross-Table] Result keys:`, Object.keys(result));
  console.log(`📊 [Cross-Table] Steps count:`, result.steps?.length ?? 0);
  console.log(`📊 [Cross-Table] Finish reason:`, result.finishReason);
  if (result.steps) {
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      // v5: stepType removed, determine type from toolResults presence
      const stepType = step.toolResults?.length ? "tool-result" : (step.toolCalls?.length ? "tool-call" : "text");
      console.log(`📊 [Cross-Table] Step ${i + 1}: type=${stepType}, finish=${step.finishReason}, toolCalls=${step.toolCalls?.length ?? 0}`);
    }
  }

  // Log tool usage stats
  const toolCalls = result.steps?.flatMap(s => s.toolCalls || []) || [];
  console.log(`📊 [Cross-Table] Total tool calls: ${toolCalls.length}`);

  const whereMatch = text.match(/WHERE_CLAUSE:\s*(.+?)(?:\n|EXPLANATION:|$)/s);
  const explainMatch = text.match(/EXPLANATION:\s*(.+?)$/s);

  if (whereMatch) {
    const clause = whereMatch[1].trim();
    const explanation = explainMatch?.[1]?.trim();
    const usedSubquery = clause.toLowerCase().includes("select") && clause.toLowerCase().includes(" in ");
    console.log(`✅ [Cross-Table] Parsed WHERE clause: ${clause}`);
    console.log(`   Explanation: ${explanation || 'none'}`);
    console.log(`   Used subquery: ${usedSubquery}`);
    return {
      object: {
        whereClause: clause,
        explanation,
        usedSubquery,
      },
    };
  }

  // Fallback: try to extract any SQL-like content
  const sqlMatch = text.match(/`([^`]+)`/) || text.match(/```sql?\n?([^`]+)```/);
  if (sqlMatch) {
    const clause = sqlMatch[1].trim().replace(/^WHERE\s+/i, "");
    console.log(`⚠️ [Cross-Table] Used fallback parsing, clause: ${clause}`);
    return {
      object: {
        whereClause: clause,
        explanation: "Generated with cross-table exploration",
        usedSubquery: clause.toLowerCase().includes("select"),
      },
    };
  }

  console.error(`❌ [Cross-Table] Could not parse response:\n${text}`);
  throw new Error("Could not parse WHERE clause from AI response. The AI may not have found a valid filter.");
}

// Main handler
export async function handleTextToSQL(request: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(request);
  const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

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

    console.log(`🔤 Text-to-SQL: "${prompt}" for ${tableName} (${dialect}) [${provider}/${model}]${enableCrossTable ? " [cross-table]" : ""}`);

    // Validation
    if (!prompt?.trim()) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (!columns?.length) {
      return new Response(JSON.stringify({ error: "Column metadata is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
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
        result = await generateSimpleWhereClause(
          aiModel,
          systemPrompt,
          prompt,
          controller.signal
        );
      }

      console.log(`✅ Generated WHERE: ${result.object.whereClause}`);

      return new Response(
        JSON.stringify({
          whereClause: result.object.whereClause,
          explanation: result.object.explanation,
          usedSubquery: result.object.usedSubquery,
        }),
        { status: 200, headers: jsonHeaders }
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return new Response(JSON.stringify({ error: "Request timeout (60s)" }), {
          status: 408,
          headers: jsonHeaders,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("❌ Text-to-SQL error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to generate SQL",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }
}
