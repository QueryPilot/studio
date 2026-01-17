# AI Architecture - Phase 3: Intelligence Implementation Plan

**Date:** 2026-01-17
**Phase:** 3 - Intelligence
**Status:** In Progress

## Overview

This phase enhances Query Pilot's AI intelligence with externalized prompts, context-aware suggestions, and expanded tool coverage for Document/Key-Value databases.

## Tasks

### Task 1: Prompt Engine Foundation (markdown templates)

**Goal:** Externalize prompts from TypeScript to markdown files with Handlebars templating.

**Steps:**
1. Create prompt directory structure in sidecar
   ```
   src-tauri/sidecar-ai/prompts/
   ├── chat/
   │   ├── system.md
   │   ├── with-connection.md
   │   └── no-connection.md
   ├── partials/
   │   ├── tools-list.md
   │   └── connection-context.md
   └── engine.ts
   ```

2. Install Handlebars: `cd src-tauri/sidecar-ai && bun add handlebars`

3. Create PromptEngine class in `prompts/engine.ts`:
   - Load all .md files at startup using Bun.Glob
   - Compile templates with Handlebars
   - Provide `render(templateName, data)` method
   - Support partials for reusable template fragments

4. Write initial system prompt in `prompts/chat/system.md`:
   - Tool capabilities list (from registry)
   - Connection context (if available)
   - Instructions for using tools effectively

5. Write connection context partials:
   - `with-connection.md`: Context when user has active connection
   - `no-connection.md`: Context when no connection active

6. Update chat route to use PromptEngine:
   - Initialize engine on startup
   - Render system prompt with current context
   - Replace hardcoded prompt strings

**Verification:**
- Prompt engine loads all templates without errors
- System prompt includes tool list from registry
- Template rendering works with connection context
- Test with and without active connection

---

### Task 2: Context-Aware Request Body

**Goal:** Pass workspace context (activeTable, recentTables, etc.) to AI in request body.

**Steps:**
1. Define WorkspaceContext interface in `src/types/ai.ts`:
   ```typescript
   interface WorkspaceContext {
     connectionId: string | null;
     database: string | null;
     schema: string | null;
     activeTable: string | null;
     activeCollection: string | null;
     activeKey: string | null;
     activeQuery: string | null;
     recentTables: string[];
     recentCollections: string[];
     recentKeys: string[];
     lastAction: "browse" | "query" | "filter" | null;
   }
   ```

2. Create workspace context hook in `src/hooks/useWorkspaceContext.ts`:
   - Read from workspaceScreenStore and tabStateStore
   - Track recent tables/collections/keys (last 5)
   - Detect last user action

3. Update useAIChat hook to accept and send context:
   - Add context to request body in sendMessage
   - Pass to /chat endpoint in body (not headers)

4. Update sidecar chat route to receive context:
   - Extract context from request body
   - Validate context.connectionId if present
   - Pass context to prompt rendering

5. Update system prompt templates to use context:
   - Show active table/collection/key in prompt
   - Mention recent items for relationship queries
   - Suggest context-appropriate actions

**Verification:**
- Context is captured from workspace state
- Request body includes full context object
- Sidecar receives and validates context
- System prompt reflects current workspace state

---

### Task 3: Smart Context-Aware Suggestions

**Goal:** Generate intelligent suggestions based on what user is viewing.

**Steps:**
1. Create suggestion generator in `src-tauri/sidecar-ai/services/suggestions.ts`:
   - `generateSuggestions(context: WorkspaceContext): string[]`
   - Different suggestion sets for SQL/Document/Key-Value
   - Consider active item and recent history

2. Implement suggestion logic:
   - **When activeTable set (SQL):**
     - "Explain the structure of {table}"
     - "What are the relationships for {table}?"
     - "Show me sample data from {table}"

   - **When activeCollection set (Document):**
     - "Show me sample documents from {collection}"
     - "What fields are common in {collection}?"
     - "Suggest an aggregation pipeline for {collection}"

   - **When activeKey set (Key-Value):**
     - "Explain the structure of {key}"
     - "Show TTL and type info for {key}"
     - "Find related keys to {key}"

   - **When multiple recent tables (SQL):**
     - "How are {table1} and {table2} related?"
     - "Show me a query joining {table1} and {table2}"

   - **Fallback (no context):**
     - "How do I connect to a database?"
     - "What databases are supported?"
     - "Explain SQL query basics"

3. Add `/suggestions` endpoint to sidecar:
   - Accept WorkspaceContext in request body
   - Return array of suggestion strings
   - Cache suggestions per context (5 min TTL)

4. Update frontend to fetch suggestions:
   - Call `/suggestions` when workspace context changes
   - Display in AIAssistantSidebar empty state
   - Replace hardcoded suggestions

**Verification:**
- Suggestions change based on active table/collection/key
- Different suggestions for SQL vs Document vs Key-Value
- Relationship suggestions when multiple recent items
- Fallback suggestions work when no context

---

### Task 4: System Prompt Enhancement

**Goal:** Improve AI's understanding of database paradigms and Query Pilot's capabilities.

**Steps:**
1. Enhance `prompts/chat/system.md`:
   - Add section on database paradigms (SQL/Document/Key-Value)
   - Explain Query Pilot's multi-paradigm support
   - Provide examples of good vs bad tool usage
   - Add guidelines for handling different DB types

2. Create paradigm-specific prompt partials:
   - `partials/sql-context.md`: SQL-specific guidance
   - `partials/document-context.md`: MongoDB/Document guidance
   - `partials/keyvalue-context.md`: Redis/Key-Value guidance

3. Update `with-connection.md` to include paradigm context:
   - Detect connection paradigm from capabilities
   - Include appropriate paradigm-specific partial
   - Show relevant tools for that paradigm

4. Add tool usage examples to prompts:
   - When to use list_tables vs get_table_structure
   - How to chain tools effectively
   - When to use find_documents vs aggregate
   - Best practices for scan_keys with patterns

**Verification:**
- System prompt adapts to connection paradigm
- AI provides paradigm-appropriate suggestions
- Tool selection improves for Document/Key-Value
- AI explains paradigm differences when asked

---

### Task 5: Non-SQL Tool Coverage (Document/Key-Value)

**Goal:** Add more Document and Key-Value tools beyond basic introspection.

**Steps:**
1. Create additional Document tools in `tools/document/`:
   - `count-documents.ts`: Count documents matching filter
   - `aggregate-pipeline.ts`: Execute aggregation pipeline
   - `distinct-values.ts`: Get distinct values for a field
   - `sample-documents.ts`: Get random sample of documents
   - `explain-query.ts`: Explain query performance (if supported)

2. Create additional Key-Value tools in `tools/keyvalue/`:
   - `scan-pattern.ts`: Scan keys matching pattern
   - `get-hash-fields.ts`: Get all fields from hash
   - `get-list-range.ts`: Get range from list
   - `get-set-members.ts`: Get all set members
   - `get-zset-range.ts`: Get sorted set range
   - `key-info.ts`: Get key type, TTL, and size

3. Update tool registry to include new tools:
   - Register all new tools with capabilities
   - Ensure proper capability filtering

4. Add backend support for new operations:
   - Verify existing commands support these operations
   - Add any missing DocumentOperation/KeyValueOperation variants
   - Ensure all operations are in AI allowlist

5. Update system prompts to mention new tools:
   - Add new tools to capabilities list
   - Provide usage examples in prompts

**Verification:**
- New Document tools work with MongoDB connections
- New Key-Value tools work with Redis connections
- Tools filtered correctly by capabilities
- AI successfully uses new tools for complex queries

---

### Task 6: OAuth Provider Integration (Optional/Experimental)

**Goal:** Add experimental OAuth provider support (Claude Code, OpenCode, ChatGPT OAuth).

**Steps:**
1. Install OAuth provider packages:
   ```bash
   cd src-tauri/sidecar-ai
   bun add ai-sdk-provider-claude-code
   bun add ai-sdk-provider-opencode-sdk
   bun add ai-sdk-provider-chatgpt-oauth
   ```

2. Add OAuth providers to config in `config/providers.ts`:
   - Claude Code provider config
   - OpenCode provider config
   - ChatGPT OAuth provider config
   - Mark all as `experimental: true`, `tier: 2`

3. Implement OAuth token management:
   - Add token storage to Tauri vault (encrypted)
   - Create token refresh mechanism
   - Add token expiry checking

4. Add OAuth configuration UI in Preferences:
   - Show OAuth providers with "Experimental" badge
   - OAuth authorization flow (redirect to provider)
   - Token status display (valid/expired/not configured)

5. Update provider registry to handle OAuth:
   - Check for OAuth tokens before initializing provider
   - Fall back to API key provider if OAuth unavailable
   - Handle token refresh errors gracefully

6. Add OAuth provider tests:
   - Mock OAuth token flow
   - Test token refresh
   - Test fallback to API key providers

**Verification:**
- OAuth providers appear in provider list with "Experimental" badge
- OAuth authorization flow works (manual testing)
- Token refresh works automatically
- Fallback to API key providers when OAuth fails
- OAuth state persists across app restarts

---

## Dependencies

- Handlebars (for template engine)
- OAuth provider packages (for Task 6)
- No new Rust dependencies

## Testing Strategy

1. **Unit Tests:**
   - Prompt engine template loading and rendering
   - Suggestion generator for different contexts
   - OAuth token management

2. **Integration Tests:**
   - Context passed correctly from frontend to sidecar
   - New Document/Key-Value tools work end-to-end
   - OAuth provider selection and usage

3. **Manual Testing:**
   - Suggestions update when switching between tables/collections
   - System prompt reflects current workspace
   - New tools accessible and functional
   - OAuth flow (if implemented)

## Success Criteria

- [ ] Prompts externalized to markdown files (editable without rebuild)
- [ ] System prompt adapts to workspace context (activeTable, etc.)
- [ ] Suggestions are context-aware and paradigm-specific
- [ ] Document/Key-Value tools expanded (10+ tools per paradigm)
- [ ] OAuth providers work (experimental, opt-in)
- [ ] All Phase 3 tests passing

## Notes

- OAuth integration (Task 6) is optional and marked experimental
- Focus on Tasks 1-5 for core intelligence improvements
- Task 6 can be deferred if OAuth packages are unstable
