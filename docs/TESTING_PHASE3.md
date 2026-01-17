# Testing Phase 3: Intelligence Features

This guide walks through testing all Phase 3 features hands-on.

## Prerequisites

1. **Start the application:**
   ```bash
   cd /Users/hieuvu/Workspaces/QueryPilot/studio
   make dev
   ```

2. **Set up test databases:**
   ```bash
   # If not already running
   make setup
   ```

## Test 1: Prompt Engine (Markdown Templates)

### Goal
Verify that system prompts are loaded from Markdown files and render correctly.

### Steps

1. **Check prompt template files exist:**
   ```bash
   ls src-tauri/sidecar-ai/prompts/chat/
   ls src-tauri/sidecar-ai/prompts/partials/
   ```

   Expected: You should see `system.md` and multiple partial files.

2. **View the system prompt template:**
   ```bash
   cat src-tauri/sidecar-ai/prompts/chat/system.md
   ```

   Expected: Markdown with Handlebars syntax (`{{#if}}`, `{{> partial}}`, etc.)

3. **Test prompt rendering in AI chat:**
   - Open Query Pilot
   - Connect to any database (PostgreSQL, MongoDB, or Redis)
   - Open AI Assistant panel
   - Send a test message: "What can you help me with?"

   Expected: AI responds with context about your current connection type

4. **Edit a prompt and test:**
   ```bash
   # Edit the system prompt
   code src-tauri/sidecar-ai/prompts/chat/system.md

   # Add a test line at the top:
   # **TEST MODE ACTIVE**

   # Rebuild sidecar
   cd src-tauri/sidecar-ai
   bun build --target=bun index.ts

   # Restart the app
   # (or just restart via make dev)
   ```

   - Send a message to AI
   - The response should reflect your prompt changes

✅ **Pass Criteria:** Prompts load from Markdown files and changes reflect immediately after rebuild.

---

## Test 2: Context-Aware Request Body

### Goal
Verify that AI receives workspace context (activeTable, activeCollection, etc.)

### Steps

1. **Test with SQL Database (PostgreSQL):**
   - Connect to PostgreSQL database
   - Click on a table in the sidebar (e.g., "users")
   - Open AI Assistant
   - Check sidecar logs:
     ```bash
     # In a separate terminal
     tail -f /tmp/ai-sidecar.log
     # or check console output if running in dev mode
     ```

   - Send message: "Help me with this table"

   Expected: AI should mention the specific table name you selected

2. **Test with MongoDB:**
   - Connect to MongoDB
   - Click on a collection (e.g., "customers")
   - Open AI Assistant
   - Send message: "What can I do with this?"

   Expected: AI should reference the collection by name

3. **Test with Redis:**
   - Connect to Redis
   - Scan for keys
   - Select a key
   - Open AI Assistant
   - Send message: "Tell me about this key"

   Expected: AI should reference the specific key

4. **Verify context in network request:**
   - Open browser DevTools (if using web view)
   - Go to Network tab
   - Filter for "chat" requests
   - Send a message to AI
   - Inspect the request payload

   Expected JSON structure:
   ```json
   {
     "messages": [...],
     "provider": "openai",
     "model": "gpt-4",
     "context": {
       "connectionId": "...",
       "database": "mydb",
       "schema": "public",
       "activeTable": "users",
       "activeCollection": null,
       "activeKey": null,
       "recentTables": ["users", "orders"],
       "lastAction": "browse"
     }
   }
   ```

✅ **Pass Criteria:** AI receives and uses workspace context in responses.

---

## Test 3: Smart Context-Aware Suggestions

### Goal
Verify that suggestions adapt based on what user is viewing

### Steps

1. **Test SQL Table Context:**
   - Connect to PostgreSQL
   - Click on "users" table
   - Open AI Assistant sidebar
   - Look at the suggestion chips

   Expected suggestions:
   - "Explain the structure of users"
   - "Show me sample data from users"
   - "What are the relationships for users?"
   - "What indexes exist on users?"

2. **Test MongoDB Collection Context:**
   - Connect to MongoDB
   - Click on "customers" collection
   - Open AI Assistant
   - Look at suggestions

   Expected suggestions:
   - "Show me sample documents from customers"
   - "What fields are common in customers?"
   - "Suggest an aggregation pipeline for customers"
   - "What's the schema of customers?"

3. **Test Redis Key Context:**
   - Connect to Redis
   - Scan for keys
   - Click on a specific key
   - Open AI Assistant
   - Look at suggestions

   Expected suggestions:
   - "Explain the structure of [key]"
   - "Show TTL and type info for [key]"
   - "Find related keys to [key]"
   - "What's the size of [key]?"

4. **Test Multiple Tables Context:**
   - Click on "users" table
   - Then click on "orders" table
   - Open AI Assistant

   Expected suggestions (using recent tables):
   - "How are users and orders related?"
   - "Show me a query joining users and orders"

5. **Test No Connection Context:**
   - Disconnect from all databases
   - Open AI Assistant

   Expected suggestions:
   - "How do I connect to a database?"
   - "What databases are supported?"
   - Generic getting-started suggestions

✅ **Pass Criteria:** Suggestions dynamically change based on active table/collection/key.

---

## Test 4: System Prompt Enhancement (Paradigm-Specific)

### Goal
Verify that AI receives different guidance based on database type

### Steps

1. **Test SQL Context:**
   - Connect to PostgreSQL
   - Open AI Assistant
   - Send: "How should I approach querying this database?"

   Expected: Response should mention:
   - Relational concepts (tables, foreign keys, joins)
   - SQL-specific tools (list_tables, get_table_structure)
   - ACID transactions
   - Recommended workflow (explore schema first)

2. **Test Document Context:**
   - Connect to MongoDB
   - Open AI Assistant
   - Send: "How should I work with this database?"

   Expected: Response should mention:
   - Document-oriented concepts
   - Flexible schemas
   - Aggregation pipelines
   - Embedded documents
   - No joins (denormalized data)

3. **Test Key-Value Context:**
   - Connect to Redis
   - Open AI Assistant
   - Send: "What's different about this database?"

   Expected: Response should mention:
   - Key-value concepts
   - Data types (string, hash, list, set, zset)
   - TTL (time-to-live)
   - In-memory storage
   - No schema

4. **Verify System Prompt (Direct):**
   ```bash
   # Create a test script to inspect system prompt
   cd src-tauri/sidecar-ai

   cat > test-prompt.ts << 'EOF'
   import { PromptEngine } from "./prompts/engine";

   const engine = new PromptEngine();
   await engine.load();

   // Test SQL context
   const sqlPrompt = engine.render("system", {
     connection: {
       connectionId: "test",
       database: "testdb",
       schema: "public",
       paradigm: "sql",
       activeTable: "users",
     },
     tools: [],
   });

   console.log("=== SQL PROMPT ===");
   console.log(sqlPrompt);
   console.log("\n\n");

   // Test Document context
   const docPrompt = engine.render("system", {
     connection: {
       connectionId: "test",
       database: "testdb",
       paradigm: "document",
       activeCollection: "users",
     },
     tools: [],
   });

   console.log("=== DOCUMENT PROMPT ===");
   console.log(docPrompt);
   EOF

   bun run test-prompt.ts
   ```

   Expected: Two different prompts showing SQL-specific vs Document-specific guidance

✅ **Pass Criteria:** AI responses reflect paradigm-specific knowledge.

---

## Test 5: Non-SQL Tool Coverage

### Goal
Verify that Document and Key-Value tools are available and working

### Steps

1. **List Available Tools:**
   ```bash
   curl http://localhost:47856/tools | jq
   ```

   Expected JSON:
   ```json
   {
     "tools": [
       {
         "name": "list_tables",
         "friendlyName": "List Tables",
         "category": "discovery",
         "capabilities": ["sql"]
       },
       {
         "name": "count_documents",
         "friendlyName": "Count Documents",
         "category": "data",
         "capabilities": ["document"]
       },
       {
         "name": "sample_documents",
         "friendlyName": "Sample Documents",
         "category": "data",
         "capabilities": ["document"]
       },
       {
         "name": "scan_keys",
         "friendlyName": "Scan Keys",
         "category": "discovery",
         "capabilities": ["keyvalue"]
       },
       {
         "name": "key_info",
         "friendlyName": "Get Key Info",
         "category": "introspection",
         "capabilities": ["keyvalue"]
       }
     ],
     "stats": {
       "total": 5,
       "byCategory": {...},
       "byCapability": {
         "sql": 1,
         "document": 2,
         "keyvalue": 2
       }
     }
   }
   ```

2. **Test Document Tool (MongoDB):**
   - Connect to MongoDB
   - Open AI Assistant
   - Send: "Count documents in the customers collection"

   Expected: AI should use `count_documents` tool and return count

3. **Test Document Tool - Sample:**
   - Send: "Show me 3 sample documents from customers"

   Expected: AI should use `sample_documents` tool and display sample docs

4. **Test Key-Value Tool (Redis):**
   - Connect to Redis
   - Open AI Assistant
   - Send: "Scan for keys matching 'user:*'"

   Expected: AI should use `scan_keys` tool and return matching keys

5. **Test Key-Value Tool - Info:**
   - Send: "Get info about key 'session:abc123'"

   Expected: AI should use `key_info` tool and return type, TTL, exists status

6. **Verify Tool Backend Support:**
   ```bash
   # Check that ai_document_execute command exists
   grep -n "ai_document_execute" src-tauri/src/commands/ai.rs

   # Check that ai_keyvalue_execute command exists
   grep -n "ai_keyvalue_execute" src-tauri/src/commands/ai.rs
   ```

   Expected: Both commands should be found in ai.rs

✅ **Pass Criteria:** All 5 tools are available and execute successfully.

---

## Test 6: OAuth Provider Integration

### Goal
Verify OAuth framework is in place but disabled by default

### Steps

1. **Check OAuth Configuration:**
   ```bash
   cat src-tauri/sidecar-ai/config/oauth-providers.ts
   ```

   Expected: OAuth providers defined with `enabled: false`

2. **Verify OAuth Providers Not in List:**
   ```bash
   curl http://localhost:47856/providers | jq '.[] | select(.authType == "oauth")'
   ```

   Expected: Empty result (no OAuth providers returned)

3. **Check API Key Providers:**
   ```bash
   curl http://localhost:47856/providers | jq '.[] | .name'
   ```

   Expected:
   ```json
   "openai"
   "anthropic"
   "google"
   "xai"
   "gateway"
   "openrouter"
   "ollama"
   ```

4. **Verify Provider Tier Structure:**
   ```bash
   cat src-tauri/sidecar-ai/config/providers.ts | grep -A 5 "SUPPORTED_PROVIDERS"
   ```

   Expected: Shows tiered structure with OAuth providers conditionally included

5. **Read OAuth Documentation:**
   ```bash
   cat src-tauri/sidecar-ai/docs/OAUTH_INTEGRATION.md
   ```

   Expected: Comprehensive guide with implementation steps

✅ **Pass Criteria:** OAuth framework exists but is disabled by default.

---

## Integration Test: End-to-End Workflow

### Complete User Journey

1. **Setup:**
   - Start app: `make dev`
   - Connect to PostgreSQL database

2. **SQL Workflow:**
   - Click on "users" table
   - Open AI Assistant
   - Verify suggestions show "Explain structure of users"
   - Click suggestion
   - Verify AI uses `list_tables` tool (when expanded to full SQL toolset)
   - AI should provide table structure

3. **Switch to MongoDB:**
   - Connect to MongoDB
   - Click on "customers" collection
   - Open AI Assistant
   - Verify suggestions change to document-specific
   - Ask: "Show me 5 sample documents"
   - Verify AI uses `sample_documents` tool
   - Verify documents are displayed

4. **Switch to Redis:**
   - Connect to Redis
   - Scan for keys
   - Select a key
   - Open AI Assistant
   - Verify suggestions change to key-value specific
   - Ask: "What type is this key?"
   - Verify AI uses `key_info` tool
   - Verify type and TTL shown

5. **Verify Context Persistence:**
   - Go back to PostgreSQL
   - Click on "orders" table
   - AI should remember you were looking at "users" before
   - Suggestions should show "How are users and orders related?"

✅ **Pass Criteria:** Complete workflow works seamlessly across all paradigms.

---

## Automated Tests

### Unit Tests for Prompt Engine

```bash
cd src-tauri/sidecar-ai

# Create test file
cat > prompts/engine.test.ts << 'EOF'
import { describe, expect, test } from "bun:test";
import { PromptEngine } from "./engine";

describe("PromptEngine", () => {
  test("loads templates successfully", async () => {
    const engine = new PromptEngine();
    await engine.load();

    const result = engine.render("system", {});
    expect(result).toContain("Query Pilot");
    expect(result).toContain("AI Database Assistant");
  });

  test("renders SQL context", async () => {
    const engine = new PromptEngine();
    await engine.load();

    const result = engine.render("system", {
      connection: {
        connectionId: "test",
        paradigm: "sql",
        database: "testdb",
      },
      tools: [],
    });

    expect(result).toContain("SQL Database Paradigm");
    expect(result).toContain("relational");
  });

  test("renders Document context", async () => {
    const engine = new PromptEngine();
    await engine.load();

    const result = engine.render("system", {
      connection: {
        connectionId: "test",
        paradigm: "document",
        database: "testdb",
      },
      tools: [],
    });

    expect(result).toContain("Document Database Paradigm");
    expect(result).toContain("MongoDB");
  });
});
EOF

bun test prompts/engine.test.ts
```

### Unit Tests for Suggestions

```bash
cat > services/suggestions.test.ts << 'EOF'
import { describe, expect, test } from "bun:test";
import { generateSuggestions } from "./suggestions";

describe("generateSuggestions", () => {
  test("returns table-specific suggestions", () => {
    const context = {
      connectionId: "test",
      database: "testdb",
      schema: "public",
      activeTable: "users",
      activeCollection: null,
      activeKey: null,
      activeQuery: null,
      recentTables: [],
      recentCollections: [],
      recentKeys: [],
      lastAction: null,
    };

    const suggestions = generateSuggestions(context);

    expect(suggestions).toContain("Explain the structure of users");
    expect(suggestions).toContain("Show me sample data from users");
  });

  test("returns collection-specific suggestions", () => {
    const context = {
      connectionId: "test",
      database: "testdb",
      schema: null,
      activeTable: null,
      activeCollection: "customers",
      activeKey: null,
      activeQuery: null,
      recentTables: [],
      recentCollections: [],
      recentKeys: [],
      lastAction: null,
    };

    const suggestions = generateSuggestions(context);

    expect(suggestions).toContain("Show me sample documents from customers");
    expect(suggestions).toContain("What fields are common in customers?");
  });
});
EOF

bun test services/suggestions.test.ts
```

---

## Troubleshooting

### Issue: AI doesn't receive context

**Check:**
1. Verify `useWorkspaceContext()` is called in `useAIChat()`
2. Check browser console for errors
3. Inspect network request payload
4. Verify sidecar receives context in logs

**Fix:**
```bash
# Enable debug logging in sidecar
cd src-tauri/sidecar-ai
# Add console.log in routes/chat.ts to see incoming context
```

### Issue: Tools not showing up

**Check:**
```bash
curl http://localhost:47856/tools | jq '.tools | length'
```

**Expected:** 5

**If not 5:**
1. Check tool registration in `index.ts`
2. Verify imports in `tools/document/index.ts` and `tools/keyvalue/index.ts`
3. Rebuild sidecar

### Issue: Suggestions don't change

**Check:**
1. Verify `/suggestions` endpoint works:
   ```bash
   curl -X POST http://localhost:47856/suggestions \
     -H "Content-Type: application/json" \
     -d '{"context": {"activeTable": "users"}}'
   ```

2. Check `AIAssistantSidebar` is calling `/suggestions`
3. Verify `useWorkspaceContext()` returns correct values

---

## Success Criteria Summary

- ✅ Prompts load from Markdown files
- ✅ AI receives workspace context (activeTable, activeCollection, activeKey)
- ✅ Suggestions adapt based on context
- ✅ System prompts include paradigm-specific guidance
- ✅ 5 tools available (1 SQL + 2 Document + 2 Key-Value)
- ✅ OAuth framework exists but disabled
- ✅ End-to-end workflow works across SQL, Document, and Key-Value databases

---

## Next Steps After Testing

1. **Expand SQL Tools:** Add remaining SQL tools (get_table_structure, get_indexes, etc.)
2. **Add More Document Tools:** Aggregation, schema inference, index management
3. **Add More Key-Value Tools:** Hash operations, list operations, pub/sub
4. **Enable OAuth (Optional):** Follow OAUTH_INTEGRATION.md guide
5. **Add Integration Tests:** Automated E2E tests for all workflows
