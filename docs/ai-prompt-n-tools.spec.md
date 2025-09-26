# AI Prompts & Tools Specification for DevDB-OpenCode Integration

## Executive Summary

This document outlines the comprehensive integration plan for enhancing DevDB Studio with OpenCode AI capabilities, including custom system prompts, specialized database tools, and intelligent agents for database operations.

## 1. OpenCode Architecture Overview

### 1.1 Core Capabilities

- **Client/Server Architecture**: HTTP API-based communication enabling remote control
- **Multi-Provider Support**: Anthropic, OpenAI, Google Gemini, AWS Bedrock, Groq, Azure
- **Session Management**: SQLite-based persistent conversation storage
- **Tool Integration**: Execute commands, search files, modify code
- **LSP Integration**: Language Server Protocol for code intelligence

### 1.2 Extension Points

1. **AGENTS.md Files**: Custom instructions injected into LLM context
2. **Custom Commands**: Markdown-based command templates with variables
3. **Agent Configuration**: Specialized assistants with custom prompts and tools
4. **Tool Registration**: Custom tools via API integration
5. **HTTP API**: Remote control and integration capabilities

## 2. DevDB Custom Instructions (AGENTS.md)

### 2.1 Global Database Rules

Location: `~/.config/opencode/AGENTS.md`

```markdown
# DevDB Studio AI Assistant Rules

## Core Principles

- Always prioritize data safety and integrity
- Generate efficient, optimized SQL queries
- Follow database-specific SQL dialect conventions
- Provide explanations for complex queries
- Suggest indexes for performance improvements

## Database Context Awareness

- Understand current database type (PostgreSQL, MySQL, SQL Server, SQLite)
- Respect database-specific limitations and features
- Use appropriate data types for each database system
- Follow naming conventions specific to the project

## Safety Guidelines

- ALWAYS use transactions for data modifications
- Request confirmation for destructive operations (DROP, TRUNCATE, DELETE without WHERE)
- Generate backup commands before schema changes
- Validate foreign key constraints before modifications
- Check for dependent objects before dropping

## Query Optimization Rules

- Prefer indexed columns in WHERE clauses
- Avoid SELECT \* in production queries
- Use appropriate JOIN types based on data relationships
- Implement pagination for large result sets
- Generate EXPLAIN PLAN analysis for complex queries

## Schema Design Principles

- Follow normalization best practices (up to 3NF by default)
- Suggest appropriate indexes based on query patterns
- Recommend partitioning strategies for large tables
- Implement proper constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK)
- Design with scalability in mind

## Code Generation Standards

- Use parameterized queries to prevent SQL injection
- Wrap any generated code (SQL or JS/TS) in <devdb_executable>...</devdb_executable> as a single executable block with no extra text inside
- Generate database migration scripts with rollback procedures
- Include proper error handling in generated code
- Follow repository's SQL formatting conventions
- Add meaningful comments for complex logic
```

### 2.2 Project-Specific Rules

Location: Project root `AGENTS.md`

```markdown
# DevDB Project-Specific AI Rules

## Current Database Context

- Active Connection: [Injected by DevDB]
- Database Type: [Injected by DevDB]
- Schema Version: [Injected by DevDB]
- Available Tables: [Injected by DevDB]
- Recent Queries: [Injected by DevDB]

## Project Conventions

- Table naming: snake_case
- Column naming: snake_case
- Primary keys: id or table_name_id
- Timestamps: created_at, updated_at
- Soft deletes: deleted_at

## Performance Targets

- Query execution time: < 100ms for OLTP
- Batch operations: Use bulk inserts/updates
- Index coverage: Aim for 100% on frequent queries
- Connection pooling: Maintain pool size limits

## Monitoring and Debugging

- Generate query execution plans
- Include timing information
- Log slow queries (> 1000ms)
- Track index usage statistics
```

## 3. Custom Commands Library

### 3.1 Query Generation Commands

Location: `~/.config/opencode/commands/`

#### `/generate-query.md`

```markdown
Generate an optimized SQL query for: $DESCRIPTION

Consider:

- Current database type and dialect
- Available indexes
- Table relationships
- Performance implications
- Result set size

Requirements:

- Use proper JOIN syntax
- Include WHERE clause optimizations
- Add appropriate ORDER BY
- Implement pagination if needed
```

#### `/explain-table.md`

```markdown
Provide comprehensive analysis of table: $TABLE_NAME

Include:

1. Table structure and columns
2. Data types and constraints
3. Indexes and their usage
4. Foreign key relationships
5. Sample queries for common operations
6. Performance optimization suggestions
7. Data quality insights
```

#### `/optimize-query.md`

```markdown
Optimize the following SQL query: $QUERY

Analysis should include:

1. Current execution plan
2. Performance bottlenecks
3. Missing indexes
4. Query rewrite suggestions
5. Alternative approaches
6. Estimated performance improvement
```

#### `/analyze-schema.md`

```markdown
Analyze database schema for: $DATABASE_NAME

Provide:

1. Entity-Relationship overview
2. Normalization assessment
3. Index coverage analysis
4. Constraint validation
5. Performance recommendations
6. Security considerations
7. Scalability assessment
```

#### `/generate-migration.md`

```markdown
Generate migration script from version $FROM_VERSION to $TO_VERSION

Include:

1. Schema changes (DDL)
2. Data transformations (DML)
3. Rollback procedures
4. Validation checks
5. Performance impact assessment
6. Downtime requirements
```

### 3.2 Performance Commands

#### `/analyze-slow-queries.md`

```markdown
Analyze slow queries in the current session

Identify:

1. Queries exceeding threshold (> $THRESHOLD_MS ms)
2. Missing indexes
3. Full table scans
4. Cartesian products
5. Optimization opportunities
```

#### `/suggest-indexes.md`

```markdown
Suggest indexes for table: $TABLE_NAME

Based on:

1. Query patterns in history
2. WHERE clause columns
3. JOIN conditions
4. ORDER BY columns
5. Covering index opportunities
```

### 3.3 Data Safety Commands

#### `/validate-query.md`

```markdown
Validate query for safety: $QUERY

Check for:

1. Destructive operations without WHERE
2. Missing transaction boundaries
3. Lock escalation risks
4. Data integrity violations
5. Performance impact on production
```

#### `/generate-backup.md`

```markdown
Generate backup strategy for: $OPERATION

Include:

1. Pre-operation backup commands
2. Validation scripts
3. Rollback procedures
4. Recovery time estimates
5. Space requirements
```

## 4. Specialized Database Agents

### 4.1 SQL Expert Agent

**Purpose**: Query generation and optimization specialist

```json
{
  "name": "sql-expert",
  "model": "claude-3.7-sonnet",
  "maxTokens": 8000,
  "prompt": "agents/sql-expert.md",
  "notes": "Tool integrations deferred",
  "context": {
    "includeSchema": true,
    "includeStatistics": true,
    "includeQueryHistory": true,
    "maxHistoryItems": 50
  }
}
```

**Prompt** (`agents/sql-expert.md`):

```markdown
You are a SQL Expert specializing in query optimization and generation.

Your expertise includes:

- Writing efficient, optimized SQL queries
- Understanding query execution plans
- Identifying performance bottlenecks
- Suggesting appropriate indexes
- Rewriting queries for better performance

Always:

- Consider the specific database dialect
- Use parameterized queries
- Optimize for the expected data volume
- Include performance metrics
- Explain complex logic
- When outputting code, return exactly one block wrapped in <devdb_executable>...</devdb_executable> with no commentary inside; place explanations outside the tags
```

### 4.2 Schema Architect Agent

**Purpose**: Database design and migration specialist

```json
{
  "name": "schema-architect",
  "model": "claude-3.7-sonnet",
  "maxTokens": 8000,
  "prompt": "agents/schema-architect.md",
  "notes": "Tool integrations deferred"
}
```

### 4.3 Performance Analyst Agent

**Purpose**: Query performance and indexing expert

```json
{
  "name": "performance-analyst",
  "model": "claude-3.7-sonnet",
  "maxTokens": 5000,
  "prompt": "agents/performance-analyst.md",
  "notes": "Tool integrations deferred"
}
```

### 4.4 Data Guardian Agent

**Purpose**: Data safety and integrity specialist

```json
{
  "name": "data-guardian",
  "model": "claude-3.7-sonnet",
  "maxTokens": 3000,
  "prompt": "agents/data-guardian.md",
  "notes": "Tool integrations deferred"
}
```

### 4.5 DevDB Agent

**Purpose**: Read-only database reasoning with native DevDB context injection

```json
{
  "name": "devdb-agent",
  "model": "claude-3.7-sonnet",
  "maxTokens": 8000,
  "prompt": "agents/devdb-agent.md",
  "notes": "Tool integrations deferred; relies on UI-provided context",
  "context": {
    "includeSchema": true,
    "includeQueryHistory": true,
    "maxHistoryItems": 25
  }
}
```

**Prompt** (`agents/devdb-agent.md`):

```markdown
You are the DevDB Agent. Your job is to answer database questions accurately.

Rules:

- Operate in read-only mode. Never generate or execute DDL/DML.
- On `@tableName` mentions, fetch columns and indexes for that table.
- Prefer precise, executable outputs over verbose prose.
- When outputting code (SQL/JS/TS), return exactly one block wrapped in <devdb_executable>...</devdb_executable> with no commentary inside. Place explanations outside the tags.

Behavior:

- Validate SELECT-only before proposing execution; suggest safer alternatives if needed.
- Use pagination/limits and explain any truncation.
- Provide short reasoning and explicit assumptions.
```

## 5. Tool Integration Architecture (Deferred)

> Tooling support has been removed in the current iteration. The subsections below remain as design references only and are not wired into the product.

### 5.1 Database Query Execution Tool

```typescript
interface QueryExecutionTool {
  name: "execute-query";
  description: "Execute SQL query against current database";
  parameters: {
    query: string;
    database?: string;
    timeout?: number;
    dryRun?: boolean;
  };
  returns: {
    rows: any[];
    rowCount: number;
    executionTime: number;
    executionPlan?: string;
  };
}
```

### 5.2 Schema Introspection Tool

```typescript
interface SchemaIntrospectionTool {
  name: "introspect-schema";
  description: "Get current database schema information";
  parameters: {
    database?: string;
    table?: string;
    includeIndexes?: boolean;
    includeConstraints?: boolean;
  };
  returns: {
    tables: TableDefinition[];
    relationships: ForeignKey[];
    indexes: Index[];
    constraints: Constraint[];
  };
}
```

### 5.3 Query Plan Analysis Tool

```typescript
interface QueryPlanTool {
  name: "analyze-query-plan";
  description: "Analyze query execution plan";
  parameters: {
    query: string;
    format?: "text" | "json" | "visual";
  };
  returns: {
    plan: ExecutionPlan;
    cost: number;
    recommendations: string[];
    warnings: string[];
  };
}
```

### 5.4 Index Recommendation Tool

```typescript
interface IndexRecommendationTool {
  name: "recommend-indexes";
  description: "Recommend indexes based on query patterns";
  parameters: {
    table: string;
    queryPatterns?: string[];
    workloadType?: "oltp" | "olap" | "mixed";
  };
  returns: {
    recommendations: IndexRecommendation[];
    estimatedImprovement: number;
    createStatements: string[];
  };
}
```

### 5.5 DevDB MCP Tools

```typescript
// All tools are read-only. Transport: MCP (stdio). Server: devdb-mcp

interface DevdbGetSchemasTool {
  name: "devdb.get-schemas";
  parameters: { connectionUri?: string; database?: string };
  returns: { schemas: { name: string; owner?: string }[] };
}

interface DevdbGetTablesTool {
  name: "devdb.get-tables";
  parameters: { connectionUri?: string; schema: string };
  returns: { tables: { schema: string; name: string; kind: string }[] };
}

interface DevdbGetColumnsTool {
  name: "devdb.get-columns";
  parameters: { connectionUri?: string; schema: string; table: string };
  returns: { columns: ColumnMeta[] };
}

interface DevdbGetIndexesTool {
  name: "devdb.get-indexes";
  parameters: { connectionUri?: string; table: string };
  returns: { indexes: Index[] };
}

interface DevdbGetViewsTool {
  name: "devdb.get-views";
  parameters: { connectionUri?: string; schema: string };
  returns: { views: View[] };
}

interface DevdbGetFunctionsTool {
  name: "devdb.get-functions";
  parameters: { connectionUri?: string; schema: string };
  returns: { functions: Function[] };
}

interface DevdbGetObjectDefinitionTool {
  name: "devdb.get-object-definition";
  parameters: {
    connectionUri?: string;
    database: string;
    schema: string;
    objectName: string;
    objectType: "table" | "view" | "function" | "index";
  };
  returns: { ddl: string };
}

interface DevdbExecuteSelectTool {
  name: "devdb.execute-select";
  description: "Execute a single-statement read-only SELECT with row cap";
  parameters: { connectionUri?: string; sql: string; limit?: number };
  returns: { columns: string[]; rows: unknown[][]; rowCount: number };
}
```

### 5.6 Tool-Calling Protocol (Chat)

> Reference design only; the runtime currently ignores tool-call payloads.

- Assistant requests a tool by emitting a fenced JSON object (no prose inside):

```json
{
  "tool": "devdb.get-columns",
  "args": { "schema": "public", "table": "users" },
  "call_id": "abc123"
}
```

- Client pauses streaming, executes the tool, then replies with a fenced JSON result:

```json
{
  "tool_result": "devdb.get-columns",
  "call_id": "abc123",
  "ok": true,
  "data": {
    /* typed payload */
  }
}
```

- On each user message, the client appends a `<metadata>` block that contains connection details and a JSON array of table schemas (columns, enum values, primary/foreign keys, indexes, triggers). The block is added to the prompt payload only; it is not rendered in the chat transcript.

### 5.7 Configuration Seeding & Versioning

- The Tauri command `ai_init_opencode_configs` pre-populates `AGENTS.md` and command templates inside `<devdb_home>/.config/opencode` before the OpenCode sidecar launches.
- `config.json` now registers every DevDB command template under the `command` map so the sidecar exposes them through `/command`.
- A manifest `devdb-opencode-config.json` captures the current config version so rewrites happen only when files are missing or the requested version changes.
- When configs refresh, the React side clears cached OpenCode client/server handles to guarantee new chat sessions use the latest prompts, commands, and agents.

### 5.8 Command Launcher UX

- The Chat Assistant surfaces the custom command catalog inline: typing `/` opens a filtered suggestion list, aligning the UX with `@` table mentions.
- Selecting a command inserts the `/command` token into the composer and, when required, opens an inline form to collect template variables before dispatching `session.command` with JSON arguments.
- After execution, the assistant stream is reloaded from history; any tool-call JSON is ignored while tooling remains disabled.

### 5.9 Specialized Agents

- Config seeding now writes dedicated prompts under `agents/` for `sql-expert`, `schema-architect`, `performance-analyst`, `data-guardian`, and the default `devdb-agent`.
- `config.json` registers each agent prompt and description (tool whitelists were removed when tooling was de-scoped).
- The desktop Chat header exposes an agent selector (desktop only) that persists via the AI store; message dispatch includes the chosen agent ID so downstream tool calls inherit the same persona.

### 5.10 Tool Catalog (Removed)

- Tool manifest generation (`tools/devdb-tools.json`) has been removed; no tool definitions are written or mirrored into OpenCode config homes.
- The chat assistant ignores tool-call payloads until a future phase reintroduces execution support.

### 5.11 UI Enhancements

- The chat header shows a subtle spinner while prompts or command runs are in-flight, giving immediate status feedback.
- The global command palette exposes AI-centric commands (open assistant panel, focus composer, launch command runner) that fire custom events consumed by the chat input.
- Chat input listens for `devdb-ai-focus` and `devdb-ai-open-commands` events so other surfaces (e.g., palette, shortcuts) can steer AI workflows.
- Outbound prompts are logged (with metadata included) to aid debugging, while the UI continues to display only the user's original message.

## 6. Implementation Plan

### 6.1 Phase 1: Core Integration (Week 1-2)

- [x] Set up OpenCode server communication
- [x] Implement basic AGENTS.md injection
- [x] Create initial custom commands
- [x] Test API connectivity

### 6.2 Phase 2: Custom Commands (Week 3-4)

- [x] Develop query generation commands
- [x] Implement schema analysis commands
- [x] Create performance optimization commands
- [x] Add data safety commands

### 6.3 Phase 3: Specialized Agents (Week 5-6)

- [x] Configure SQL Expert agent
- [x] Set up Schema Architect agent
- [x] Implement Performance Analyst agent
- [x] Deploy Data Guardian agent

### 6.4 Phase 4: Tool Development (Week 7-8)

- [ ] Build query execution tool _(deferred)_
- [ ] Create schema introspection tool _(deferred)_
- [ ] Implement query plan analyzer _(deferred)_
- [ ] Develop index recommendation tool _(deferred)_
- [ ] Ship Rust MCP server `devdb-mcp` exposing read-only DevDB tools
- [ ] Add chat-side tool-call bridge (detect JSON tool calls, execute, stream back) _(deferred)_

### 6.5 Phase 5: UI Integration (Week 9-10)

- [x] Integrate chat interface with OpenCode
- [x] Add context injection from current view
- [x] Implement command palette integration
- [x] Create visual feedback for AI operations

### 6.6 Phase 6: Testing & Optimization (Week 11-12)

- [ ] Performance testing
- [ ] Security validation
- [ ] User acceptance testing
- [ ] Documentation and training

## 7. Security Considerations

### 7.1 Data Protection

- Never expose sensitive data in prompts
- Implement query sanitization
- Use read-only connections for analysis
- Audit all AI-generated queries
- Enforce single-statement SELECT-only in tools; reject multi-statement and DDL/DML
- Redact credentials/secrets in all logs; avoid logging query parameters with PII

### 7.2 Access Control

- Respect database user permissions
- Implement operation approval workflow
- Log all AI interactions
- Rate limit API requests
- Rate-limit MCP tool calls (eg. max 3/sec burst, backoff on overload)
- Apply server-side timeouts and row limits (default 1000 rows) to tool executions

### 7.3 Compliance

- Ensure GDPR compliance for EU data
- Implement data retention policies
- Provide audit trails
- Support data anonymization

## 8. Performance Optimization

### 8.1 Context Management

- Limit schema context to relevant tables
- Cache frequently used information
- Implement smart context pruning
- Use incremental updates

### 8.2 Response Time

- Stream responses for long operations
- Implement progress indicators
- Cache common query patterns
- Use background processing for analysis
- Prefetch columns/indexes on `@table` mention to reduce round trips

### 8.3 Resource Usage

- Monitor token consumption
- Implement usage quotas
- Optimize prompt lengths
- Use appropriate models for tasks

## 9. User Experience Enhancements

### 9.1 Interactive Features

- Auto-complete for SQL keywords
- Inline documentation
- Visual query builder integration
- Real-time syntax validation
- Render <devdb_executable> blocks with editor preview and Copy/Run buttons
- When a <devdb_executable> block is detected, show an inline toolbar: Copy, Run (with connection selector), and Save as snippet

### 9.2 Learning & Adaptation

- Learn from user corrections
- Adapt to project conventions
- Improve based on feedback
- Maintain query history

### 9.3 Collaboration

- Share AI-generated queries
- Collaborative optimization sessions
- Team knowledge base
- Best practices library

## 10. Monitoring & Analytics

### 10.1 Usage Metrics

- Track command usage frequency
- Monitor response times
- Measure accuracy rates
- Analyze error patterns

### 10.2 Performance Metrics

- Query optimization success rate
- Index recommendation effectiveness
- Schema design improvement metrics
- User satisfaction scores

### 10.3 Cost Management

- Token usage tracking
- Cost per operation analysis
- Budget alerts and limits
- ROI measurement

## 11. Future Enhancements

### 11.1 Advanced Features

- Natural language to SQL with voice input
- Automatic query optimization in background
- Predictive index creation
- Anomaly detection in query patterns

### 11.2 Integration Extensions

- Version control integration for migrations
- CI/CD pipeline integration
- Monitoring tool integration
- Documentation generation

### 11.3 AI Model Evolution

- Fine-tuning on organization's data patterns
- Custom model training for specific domains
- Multi-model consensus for critical operations
- Continuous learning from production workloads

## Conclusion

This comprehensive integration plan leverages OpenCode's extensibility to create a powerful, database-focused AI assistant within DevDB Studio. By implementing custom instructions, specialized agents, and database-specific tools, we can significantly enhance developer productivity while maintaining data safety and performance.

The phased implementation approach ensures gradual rollout with continuous testing and optimization, while the security and performance considerations guarantee enterprise-readiness.
