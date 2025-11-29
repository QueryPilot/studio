import { generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { getCorsHeaders } from "../middleware/cors";
import { ProviderService } from "../services/provider.service";
import {
  get_foreign_keys,
  get_table_structure,
  execute_readonly_query,
  list_tables,
} from "../tools";

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

// Static dialect rules - precomputed for performance
const DIALECT_RULES: Record<string, string> = {
  postgresql: `PostgreSQL syntax:
- Case-insensitive: column ILIKE '%value%'
- Date arithmetic: column >= NOW() - INTERVAL '7 days'
- Boolean: column = true
- Subqueries: column IN (SELECT id FROM table WHERE condition)`,

  mysql: `MySQL syntax:
- Case-insensitive: LOWER(column) LIKE '%value%'
- Date arithmetic: column >= DATE_SUB(NOW(), INTERVAL 7 DAY)
- Boolean: column = 1
- Subqueries: column IN (SELECT id FROM table WHERE condition)`,

  sqlite: `SQLite syntax:
- Case-insensitive: LOWER(column) LIKE '%value%'
- Date arithmetic: column >= datetime('now', '-7 days')
- Boolean: column = 1
- Subqueries: column IN (SELECT id FROM table WHERE condition)`,

  mssql: `SQL Server syntax:
- Case-insensitive by default for LIKE
- Date arithmetic: column >= DATEADD(day, -7, GETDATE())
- Boolean: column = 1
- Subqueries: column IN (SELECT id FROM table WHERE condition)`,
};

// Cross-table exploration tools (reusing existing tools from tools/index.ts)
const crossTableTools = {
  list_tables,
  get_foreign_keys,
  get_table_structure,
  execute_readonly_query,
};

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
        desc += ` - values: ${c.enumValues.slice(0, 10).map((v) => `'${v}'`).join(", ")}`;
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
    ? `\nINFERRED RELATIONSHIPS (from column naming patterns):
${inferredRels.map(r => `- ${r.column} → likely references: ${r.possibleTables.join(" or ")} (${r.confidence} confidence)`).join("\n")}`
    : "";

  const crossTableInstructions = enableCrossTable
    ? `
CROSS-TABLE FILTERING (IMPORTANT):
When the user references entities from related tables (e.g., "todos by User X", "orders from Org A"):

STRATEGY:
1. First check explicit FKs marked with [FK → table.column]
2. If no explicit FK, use INFERRED RELATIONSHIPS above based on column naming patterns
3. Use tools to validate: get_foreign_keys to confirm, get_table_structure to find searchable columns
4. Use execute_readonly_query to find matching IDs (SELECT id FROM table WHERE name/email/title ILIKE '%search%')
5. Generate subquery: column IN (SELECT id FROM related_table WHERE condition)

COMMON PATTERNS:
- user_id, created_by, author_id → users table (search: name, email, username)
- org_id, organization_id → organizations table (search: name)
- project_id → projects table (search: name, title)
- category_id → categories table (search: name)
- team_id → teams table (search: name)

Example: "todos by John" on table with user_id column:
1. Infer user_id → users table
2. Query: SELECT id FROM users WHERE name ILIKE '%John%'
3. Result: user_id IN (SELECT id FROM users WHERE name ILIKE '%John%')

Example: "items in Electronics category" on table with category_id:
1. Infer category_id → categories table
2. Result: category_id IN (SELECT id FROM categories WHERE name ILIKE '%Electronics%')`
    : "";

  return `You are a SQL WHERE clause generator.

Table: ${tableName}
Database: ${dialect}

Available columns:
${columnList}${inferredRelText}

RULES:
- Return ONLY the WHERE clause expression WITHOUT the "WHERE" keyword
- ONLY use columns from the list above
- Keep expressions simple and readable
${DIALECT_RULES[dialect] || "Use standard SQL syntax"}
${crossTableInstructions}

Examples:
- "active users" → status = 'active'
- "orders over 100" → amount > 100
- "name contains john" → ${dialect === "postgresql" ? "name ILIKE '%john%'" : "LOWER(name) LIKE '%john%'"}`;
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
  const result = await generateText({
    model: aiModel,
    system: systemPrompt,
    prompt: `Generate the WHERE clause for: ${prompt}

CONTEXT FOR TOOL CALLS (use these values in tool parameters):
- connectionId: "${connectionId}"
- schema: "${schema}"
- table: "${tableName}"

WORKFLOW for cross-table filtering (e.g., "todos by User John", "orders from Org ABC"):
1. Use list_tables to discover available tables in the schema
2. Use get_foreign_keys to check explicit FK relationships from current table
3. If no explicit FK, infer from column naming (user_id → users, org_id → organizations, etc.)
4. Use get_table_structure on the related table to find searchable text columns (name, email, title, etc.)
5. Use execute_readonly_query to search: SELECT id FROM related_table WHERE searchable_column ILIKE '%search_term%' LIMIT 10
6. Generate final WHERE: fk_column IN (SELECT id FROM related_table WHERE condition)

After exploring, output ONLY the final WHERE clause in this exact format:
WHERE_CLAUSE: <your where clause here>
EXPLANATION: <brief explanation>`,
    tools: crossTableTools,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    abortSignal: signal,
  });

  // Parse the response to extract WHERE clause
  const text = result.text;
  const whereMatch = text.match(/WHERE_CLAUSE:\s*(.+?)(?:\n|EXPLANATION:|$)/s);
  const explainMatch = text.match(/EXPLANATION:\s*(.+?)$/s);

  if (whereMatch) {
    return {
      object: {
        whereClause: whereMatch[1].trim(),
        explanation: explainMatch?.[1]?.trim(),
        usedSubquery: text.toLowerCase().includes("select") && text.includes("IN"),
      },
    };
  }

  // Fallback: try to extract any SQL-like content
  const sqlMatch = text.match(/`([^`]+)`/) || text.match(/```sql?\n?([^`]+)```/);
  if (sqlMatch) {
    return {
      object: {
        whereClause: sqlMatch[1].trim().replace(/^WHERE\s+/i, ""),
        explanation: "Generated with cross-table exploration",
        usedSubquery: sqlMatch[1].toLowerCase().includes("select"),
      },
    };
  }

  throw new Error("Could not parse WHERE clause from AI response");
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
