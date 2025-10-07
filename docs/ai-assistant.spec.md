# AI Assistant Specification for DevDB Studio

## Executive Summary

Build an **AI sidebar assistant** deeply integrated into DevDB Studio, inspired by [OpenCode](https://github.com/sst/opencode)'s architecture (MCP protocol, tool system, streaming), but designed as a **GUI-first experience**. The assistant provides contextual help for database development workflows through natural language interaction.

**Core Requirements**:

- ✅ **AI Sidebar Panel** - Always accessible, context-aware assistant
- ✅ Configurable AI providers (OpenAI, Anthropic, Azure, local models)
- ✅ API Key and OAuth authentication (OAuth for Claude)
- ✅ Custom tools for database operations (schema, queries, data analysis)
- ✅ Session management with persistence
- ✅ Streaming support for real-time responses
- ✅ Deep integration with DevDB Studio UI and state

**Key Differentiators**:

- 🎯 Not a CLI - fully integrated into DevDB Studio UI
- 🎯 Context-aware - knows current connection, table, query
- 🎯 Database-focused tools - schema analysis, query help, data insights
- 🎯 Visual results - tables, charts, ERDs rendered inline

---

## 1. OpenCode Architecture Analysis

### 1.1 What We're Borrowing from OpenCode

OpenCode is a **terminal-based** AI assistant. We're **NOT building a CLI**, but we'll adopt these architectural patterns:

**Concepts to Adopt**:

```
✅ MCP Protocol         → For standardized tool communication
✅ Multi-Provider       → Support for OpenAI, Claude, Azure, etc.
✅ Tool System          → Extensible tool registry with JSON schemas
✅ Session Storage      → SQLite for conversation persistence
✅ Streaming            → Real-time response rendering
✅ OAuth Flow           → Secure Claude authentication
```

**What We're NOT Using**:

```
❌ CLI/Terminal UI      → We have a GUI sidebar
❌ stdio Transport      → We use Tauri IPC
❌ TUI Components       → We use React components
❌ Command-line args    → We use UI configuration
```

### 1.2 OpenCode Features to Adopt

**1. Model Context Protocol (MCP)**

- Standard protocol for tool communication
- stdio transport for process-based tools
- Structured tool input/output schemas

**2. Multi-Provider Support**

- Unified interface for different AI providers
- Provider-specific authentication handling
- Model selection per conversation

**3. Session Persistence**

- SQLite database for conversation history
- Session summarization for context management
- Resume conversations seamlessly

**4. Tool System**

- Structured tool definitions with JSON schemas
- Safe command execution with restrictions
- File operation guards (CWD-only access)

**5. Streaming Architecture**

- AsyncIterator for streaming responses
- Token-by-token rendering in React UI
- Graceful error handling with retry logic

### 1.3 OAuth Implementation (Claude)

From OpenCode source analysis:

```typescript
// OpenCode uses Anthropic OAuth flow
interface ClaudeOAuthConfig {
  clientId: string;
  redirectUri: string;
  scopes: ["api.claude"];
  authEndpoint: "https://auth.anthropic.com/oauth/authorize";
  tokenEndpoint: "https://auth.anthropic.com/oauth/token";
}

// OAuth flow:
// 1. Open browser with authorization URL
// 2. User logs in and grants permission
// 3. Redirect to local server with auth code
// 4. Exchange code for access token
// 5. Store token securely (OS keychain)
```

**Implementation Details**:

- Local HTTP server on random port for callback
- PKCE (Proof Key for Code Exchange) for security
- Token refresh handling
- Secure storage using OS credential manager

---

## 2. DevDB Studio AI Assistant Architecture

### 2.1 System Overview - AI Sidebar Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DevDB Studio Main Window                        │
│                                                                       │
│  ┌────────────────────────────┬─────────────────────────────────┐   │
│  │   Main Content Area        │   AI Assistant Sidebar          │   │
│  │                            │   ┌─────────────────────────┐   │   │
│  │  • Connection List         │   │  💬 Chat Interface      │   │   │
│  │  • Schema Browser          │   │  ─────────────────────  │   │   │
│  │  • Query Editor            │   │  > What tables exist?   │   │   │
│  │  • Data Grid               │   │  ─────────────────────  │   │   │
│  │  • ERD Viewer              │   │  📊 Results Inline      │   │   │
│  │                            │   │  🔧 Tool Executions     │   │   │
│  │  [Current Context]         │   │  💾 Sessions            │   │   │
│  │  • Connection: postgres    │   └─────────────────────────┘   │   │
│  │  • Table: users            │                                 │   │
│  │  • Query: SELECT * FROM... │   [Context Aware]               │   │
│  │                            │   Knows your current:           │   │
│  └────────────────────────────┘   • Connection                 │   │
│                                    • Table/View                 │   │
│                                    • Query Editor Content       │   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                │ Tauri IPC Commands + Events
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Tauri Backend (Rust)                           │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AI Agent Manager                          │    │
│  │  • Context extraction (current table, query, connection)     │    │
│  │  • Tool routing & execution                                  │    │
│  │  • Streaming response handler                                │    │
│  │  • Session persistence (SQLite)                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│  │ AI Providers │  │ Database Tools  │  │ DevDB Integration    │   │
│  │ • OpenAI     │  │ • Schema Query  │  │ • Read connections   │   │
│  │ • Claude     │  │ • Data Search   │  │ • Execute queries    │   │
│  │ • Azure      │  │ • Query Help    │  │ • Access schema data │   │
│  │ • Local      │  │ • ERD Generate  │  │ • Format SQL         │   │
│  └──────────────┘  └─────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Integration Points**:

- AI sidebar can **read current context** (active connection, selected table, query content)
- Tools can **invoke existing DevDB services** (schema service, query executor, ERD generator)
- Results are **rendered inline** with rich formatting (tables, syntax-highlighted SQL, charts)
- Always accessible via **toggle button** or **keyboard shortcut** (e.g., `Cmd+Shift+A`)

### 2.2 Context-Aware AI Assistance

The AI assistant has **full awareness** of your current workspace context:

**Automatic Context Injection**:

```typescript
interface SafeConnectionInfo {
  id: string;
  name: string;
  type: DatabaseType; // postgres, mysql, mongodb, etc.
  schema?: string;
}

interface SafeColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
}

interface SafeTableInfo {
  name: string;
  columns: SafeColumnInfo[];
  rowCount?: number;
}

interface AIContext {
  connection: SafeConnectionInfo;
  currentTable?: SafeTableInfo;
  queryEditor?: {
    content: string;
    selectedText?: string;
    cursorPosition?: number;
  };
  activePanel?: "query" | "data" | "erd" | "structure";
  warning?: string;
}
```

**Example Use Cases**:

1. **Schema Exploration**

   ```
   User: "What columns are in this table?"
   AI: [Reads currentTable context]
       "The 'users' table has 8 columns: id (uuid), email (varchar),
       created_at (timestamp), ... [shows structure]"
   ```

2. **Query Assistance**

   ```
   User: "Why is this query slow?"
   AI: [Reads queryEditor.content]
       [Executes EXPLAIN ANALYZE]
       "This query is doing a full table scan. Add an index on email:
       CREATE INDEX idx_users_email ON users(email);"
   ```

3. **Data Analysis**

   ```
   User: "Show me the distribution of user signup dates"
   AI: [Reads currentTable: 'users']
       [Executes aggregation query]
       [Renders chart inline]
   ```

4. **Migration Help**

   ```
   User: "Add a 'role' column with enum type"
   AI: [Reads connection.type: postgres]
       "Here's the migration for PostgreSQL:
       CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');
       ALTER TABLE users ADD COLUMN role user_role DEFAULT 'user';"
   ```

5. **Code Generation**
   ```
   User: "Generate TypeScript types for this table"
   AI: [Reads currentTable structure]
       [Generates code with proper types]
       "export interface User { id: string; email: string; ... }"
   ```

### 2.3 Technology Stack

**Frontend (TypeScript + React)**:

- React sidebar component for chat UI
- Monaco Editor for code blocks (reusing existing instance)
- Markdown rendering for responses
- Real-time streaming display with Zustand state
- Integration with existing DevDB stores (connections, schema, etc.)

**Backend (Rust)**:

- Tauri commands for AI operations
- Tokio for async streaming
- SQLite for session storage (via `rusqlite`)
- OAuth2 client library for Claude auth
- Access to existing database connection pool

**External Dependencies**:

- MCP protocol libraries (for tool standardization)
- AI provider SDKs (async-openai, anthropic-sdk-rs)
- OAuth2 crate for authentication

---

## 3. Core Features Specification

### 3.1 AI Provider Configuration

#### Supported Providers

```rust
// src-tauri/src/ai/providers.rs

pub enum AIProvider {
    OpenAI {
        base_url: String,           // Default: https://api.openai.com/v1
        model: String,               // Default: gpt-4o
        api_key: String,
    },
    Anthropic {
        base_url: String,           // Default: https://api.anthropic.com
        model: String,               // Default: claude-sonnet-4-20250514
        auth: AnthropicAuth,
    },
    Azure {
        endpoint: String,
        deployment_name: String,
        api_key: String,
        api_version: String,
    },
    LocalModel {
        base_url: String,           // Ollama/LM Studio endpoint
        model: String,
    },
    Custom {
        base_url: String,
        model: String,
        api_key: Option<String>,
        headers: HashMap<String, String>,
    },
}

pub enum AnthropicAuth {
    ApiKey(String),
    OAuth {
        access_token: String,
        refresh_token: String,
        expires_at: i64,
    },
}
```

#### Configuration Storage

```toml
# ~/.config/devdb-studio/ai-assistant.toml

[ai_provider]
default = "openai"

[ai_provider.openai]
base_url = "https://api.openai.com/v1"
model = "gpt-4o"
# API key stored in OS secure storage

[ai_provider.anthropic]
base_url = "https://api.anthropic.com"
model = "claude-sonnet-4-20250514"
auth_method = "oauth"  # or "api_key"

[ai_provider.local]
base_url = "http://localhost:11434"  # Ollama
model = "codellama:13b"

[assistant]
streaming = true
max_tokens = 4096
temperature = 0.7
context_window = 16000 # Default; model-specific overrides recommended

[session]
auto_save = true
max_history = 50
summarize_threshold = 30  # messages before auto-summarize
```

#### Tauri Commands

```rust
// src-tauri/src/commands/ai_config.rs

#[tauri::command]
pub async fn configure_ai_provider(
    provider_config: AIProviderConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Validate configuration
    // Test connection
    // Save to config file
    // Update runtime state
}

#[tauri::command]
pub async fn list_ai_providers(
    state: State<'_, AppState>,
) -> Result<Vec<AIProviderInfo>, String> {
    // Return all configured providers
}

#[tauri::command]
pub async fn test_ai_connection(
    provider: String,
    state: State<'_, AppState>,
) -> Result<ConnectionTestResult, String> {
    // Test provider availability
    // Verify authentication
    // Check model access
}
```

### 3.2 OAuth Implementation for Claude

#### OAuth Flow Components

```rust
// src-tauri/src/ai/oauth.rs

pub struct ClaudeOAuthManager {
    client_id: String,
    redirect_uri: String,
    auth_server: Option<OAuthCallbackServer>,
    secure_store: SecureStorage,
}

impl ClaudeOAuthManager {
    pub async fn start_oauth_flow(&mut self) -> Result<OAuthFlowHandle> {
        // 1. Start local HTTP server on random port
        let port = self.start_callback_server().await?;
        let redirect_uri = format!("http://localhost:{}/callback", port);

        // 2. Generate PKCE challenge
        let (code_verifier, code_challenge) = generate_pkce_pair();

        // 3. Build authorization URL
        let auth_url = format!(
            "https://auth.anthropic.com/oauth/authorize?\
             client_id={}&\
             redirect_uri={}&\
             response_type=code&\
             code_challenge={}&\
             code_challenge_method=S256&\
             scope=api.claude",
            self.client_id, redirect_uri, code_challenge
        );

        // 4. Open browser
        open::that(&auth_url)?;

        // 5. Wait for callback
        let auth_code = self.wait_for_callback().await?;

        // 6. Exchange code for token
        let tokens = self.exchange_code_for_token(auth_code, code_verifier).await?;

        // 7. Store tokens securely
        self.store_tokens(&tokens).await?;

        Ok(OAuthFlowHandle { tokens })
    }

    async fn exchange_code_for_token(
        &self,
        code: String,
        code_verifier: String,
    ) -> Result<OAuthTokens> {
        let client = reqwest::Client::new();
        let response = client
            .post("https://auth.anthropic.com/oauth/token")
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("client_id", &self.client_id),
                ("redirect_uri", &self.redirect_uri),
                ("code_verifier", &code_verifier),
            ])
            .send()
            .await?;

        response.json::<OAuthTokens>().await
    }

    pub async fn refresh_token(&self, refresh_token: String) -> Result<OAuthTokens> {
        // Token refresh implementation
    }
}
```

#### Tauri Commands for OAuth

```rust
#[tauri::command]
pub async fn start_claude_oauth(
    window: Window,
    state: State<'_, AppState>,
) -> Result<OAuthStatus, String> {
    let mut oauth_manager = state.claude_oauth.lock().await;

    match oauth_manager.start_oauth_flow().await {
        Ok(handle) => {
            // Emit event to frontend
            window.emit("oauth:success", &handle)?;
            Ok(OAuthStatus::Success)
        },
        Err(e) => {
            window.emit("oauth:error", e.to_string())?;
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn check_claude_auth_status(
    state: State<'_, AppState>,
) -> Result<AuthStatus, String> {
    // Check if tokens exist and are valid
}
```

### 3.3 Custom Tools for Database Operations

#### Tool Categories

**1. Schema Tools**

```rust
pub struct SchemaTools;

impl SchemaTools {
    // Get table structure
    pub async fn get_table_structure(
        &self,
        connection_id: String,
        table_name: String,
    ) -> Result<TableStructure>;

    // List all tables
    pub async fn list_tables(
        &self,
        connection_id: String,
        schema: Option<String>,
    ) -> Result<Vec<TableInfo>>;

    // Get foreign key relationships
    pub async fn get_relationships(
        &self,
        connection_id: String,
        table_name: String,
    ) -> Result<Vec<Relationship>>;

    // Generate ERD
    pub async fn generate_erd(
        &self,
        connection_id: String,
        tables: Vec<String>,
    ) -> Result<String>;  // Returns DBML
}
```

**2. Query Tools**

```rust
pub struct QueryTools;

impl QueryTools {
    // Execute read-only query
    pub async fn execute_query(
        &self,
        connection_id: String,
        sql: String,
        limit: Option<u32>,
    ) -> Result<QueryResult>;

    // Explain query plan
    pub async fn explain_query(
        &self,
        connection_id: String,
        sql: String,
    ) -> Result<QueryPlan>;

    // Validate SQL syntax
    pub async fn validate_sql(
        &self,
        sql: String,
        dialect: SqlDialect,
    ) -> Result<ValidationResult>;

    // Format SQL
    pub async fn format_sql(
        &self,
        sql: String,
        options: FormatOptions,
    ) -> Result<String>;
}
```

**3. Data Tools**

```rust
pub struct DataTools;

impl DataTools {
    // Search table data
    pub async fn search_data(
        &self,
        connection_id: String,
        table_name: String,
        search_term: String,
        columns: Option<Vec<String>>,
    ) -> Result<Vec<Row>>;

    // Get sample data
    pub async fn get_sample_data(
        &self,
        connection_id: String,
        table_name: String,
        limit: u32,
    ) -> Result<Vec<Row>>;

    // Analyze column statistics
    pub async fn analyze_column(
        &self,
        connection_id: String,
        table_name: String,
        column_name: String,
    ) -> Result<ColumnStats>;
}
```

**4. Migration Tools**

```rust
pub struct MigrationTools;

impl MigrationTools {
    // Generate migration from schema diff
    pub async fn generate_migration(
        &self,
        from_schema: SchemaDefinition,
        to_schema: SchemaDefinition,
    ) -> Result<String>;  // SQL migration

    // Apply migration
    pub async fn apply_migration(
        &self,
        connection_id: String,
        migration_sql: String,
        dry_run: bool,
    ) -> Result<MigrationResult>;

    // Rollback migration
    pub async fn rollback_migration(
        &self,
        connection_id: String,
        migration_id: String,
    ) -> Result<()>;
}
```

**5. Code Generation Tools**

```rust
pub struct CodeGenTools;

impl CodeGenTools {
    // Generate model code (TypeScript/Rust/Python)
    pub async fn generate_model(
        &self,
        table_structure: TableStructure,
        language: Language,
        options: CodeGenOptions,
    ) -> Result<String>;

    // Generate CRUD API
    pub async fn generate_crud_api(
        &self,
        table_name: String,
        framework: Framework,  // Express, Actix, FastAPI
    ) -> Result<Vec<GeneratedFile>>;

    // Generate GraphQL schema
    pub async fn generate_graphql_schema(
        &self,
        tables: Vec<TableStructure>,
    ) -> Result<String>;
}
```

**6. File System Tools** (OpenCode compatible)

```rust
pub struct FileTools;

impl FileTools {
    // Read file (restricted to workspace)
    pub async fn read_file(&self, path: String) -> Result<String>;

    // Write file (restricted to workspace)
    pub async fn write_file(&self, path: String, content: String) -> Result<()>;

    // Search in files
    pub async fn search_files(
        &self,
        pattern: String,
        file_types: Option<Vec<String>>,
    ) -> Result<Vec<SearchResult>>;

    // List directory
    pub async fn list_directory(&self, path: String) -> Result<Vec<FileEntry>>;
}
```

#### Tool Registration with MCP

```rust
// src-tauri/src/ai/tools/registry.rs

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(&self, params: serde_json::Value) -> Result<ToolResult>;
}

impl ToolRegistry {
    pub fn register_database_tools(&mut self) {
        // Schema tools
        self.register(Box::new(GetTableStructureTool));
        self.register(Box::new(ListTablesTool));
        self.register(Box::new(GetRelationshipsTool));

        // Query tools
        self.register(Box::new(ExecuteQueryTool));
        self.register(Box::new(ExplainQueryTool));
        self.register(Box::new(FormatSqlTool));

        // Data tools
        self.register(Box::new(SearchDataTool));
        self.register(Box::new(GetSampleDataTool));

        // Code generation
        self.register(Box::new(GenerateModelTool));
        self.register(Box::new(GenerateCrudApiTool));
    }

    pub fn to_mcp_tools(&self) -> Vec<MCPTool> {
        self.tools.values().map(|tool| MCPTool {
            name: tool.name().to_string(),
            description: tool.description().to_string(),
            input_schema: tool.parameters_schema(),
        }).collect()
    }
}
```

### 3.4 Session Management

#### Session Storage Schema

```sql
-- src-tauri/migrations/ai_assistant.sql

CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    is_archived BOOLEAN DEFAULT 0,
    metadata TEXT  -- JSON: connection context, etc.
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,  -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    tokens_used INTEGER,
    tool_calls TEXT,  -- JSON array of tool executions
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tool_executions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,  -- JSON
    output TEXT,          -- JSON
    status TEXT NOT NULL, -- 'pending', 'success', 'error'
    duration_ms INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_updated ON ai_sessions(updated_at DESC);
CREATE INDEX idx_messages_session ON ai_messages(session_id, created_at);
CREATE INDEX idx_tool_executions_message ON ai_tool_executions(message_id);
```

#### Session Manager

```rust
// src-tauri/src/ai/session.rs

pub struct SessionManager {
    db: Arc<Mutex<Connection>>,
}

impl SessionManager {
    pub async fn create_session(&self, provider: AIProvider, model: String) -> Result<Session> {
        let session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            title: "New Chat".to_string(),
            provider: provider.name(),
            model,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            message_count: 0,
            is_archived: false,
            metadata: None,
        };

        // Insert into database
        self.save_session(&session).await?;

        Ok(session)
    }

    pub async fn add_message(
        &self,
        session_id: String,
        role: MessageRole,
        content: String,
        tool_calls: Option<Vec<ToolCall>>,
    ) -> Result<Message> {
        let message = Message {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.clone(),
            role,
            content,
            tokens_used: None,
            tool_calls,
            created_at: chrono::Utc::now().timestamp(),
        };

        // Save message
        self.save_message(&message).await?;

        // Update session
        self.update_session_timestamp(&session_id).await?;

        Ok(message)
    }

    pub async fn get_session_history(
        &self,
        session_id: String,
        limit: Option<usize>,
    ) -> Result<Vec<Message>> {
        // Retrieve messages with optional limit
    }

    pub async fn summarize_session(&self, session_id: String) -> Result<String> {
        // Get all messages
        let messages = self.get_session_history(session_id.clone(), None).await?;

        // Create summary prompt
        let summary_prompt = format!(
            "Summarize this conversation in 2-3 sentences:\n\n{}",
            messages.iter()
                .map(|m| format!("{}: {}", m.role, m.content))
                .collect::<Vec<_>>()
                .join("\n")
        );

        // Call AI to generate summary
        // Store summary in session metadata

        Ok(summary)
    }

    pub async fn archive_old_messages(
        &self,
        session_id: String,
        keep_last_n: usize,
    ) -> Result<()> {
        // Keep recent messages, archive older ones
        // Useful for managing context window
    }
}
```

#### Tauri Commands

```rust
#[tauri::command]
pub async fn create_ai_session(
    provider: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<Session, String> {
    state.session_manager.create_session(provider, model).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_ai_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionSummary>, String> {
    state.session_manager.list_sessions().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_session_history(
    session_id: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<Message>, String> {
    state.session_manager.get_session_history(session_id, limit).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.session_manager.delete_session(session_id).await
        .map_err(|e| e.to_string())
}
```

### 3.5 Streaming Support

#### Streaming Architecture

```rust
// src-tauri/src/ai/streaming.rs

pub struct StreamingChatHandler {
    provider: Arc<dyn AIProvider>,
    window: Window,
    session_id: String,
}

impl StreamingChatHandler {
    pub async fn send_message_streaming(
        &self,
        message: String,
        context: Vec<Message>,
    ) -> Result<String> {
        // Prepare messages with context
        let mut messages = context.clone();
        messages.push(Message::user(message));

        // Start streaming
        let mut stream = self.provider.chat_streaming(messages).await?;

        let mut full_response = String::new();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(delta) => {
                    buffer.push_str(&delta.content);
                    full_response.push_str(&delta.content);

                    // Emit to frontend every few tokens
                    if buffer.len() > 10 {
                        self.emit_chunk(&buffer)?;
                        buffer.clear();
                    }

                    // Handle tool calls
                    if let Some(tool_call) = delta.tool_call {
                        self.handle_tool_call(tool_call).await?;
                    }
                },
                Err(e) => {
                    self.emit_error(&e)?;
                    return Err(e);
                }
            }
        }

        // Emit final chunk
        if !buffer.is_empty() {
            self.emit_chunk(&buffer)?;
        }

        // Mark complete
        self.emit_complete()?;

        Ok(full_response)
    }

    fn emit_chunk(&self, content: &str) -> Result<()> {
        self.window.emit("ai:chunk", ChunkEvent {
            session_id: self.session_id.clone(),
            content: content.to_string(),
        })?;
        Ok(())
    }

    fn emit_complete(&self) -> Result<()> {
        self.window.emit("ai:complete", CompleteEvent {
            session_id: self.session_id.clone(),
        })?;
        Ok(())
    }

    async fn handle_tool_call(&self, tool_call: ToolCall) -> Result<ToolResult> {
        // Emit tool execution started
        self.window.emit("ai:tool-start", ToolStartEvent {
            session_id: self.session_id.clone(),
            tool_name: tool_call.name.clone(),
            input: tool_call.input.clone(),
        })?;

        // Execute tool
        let result = self.execute_tool(&tool_call).await;

        // Emit tool execution completed
        self.window.emit("ai:tool-complete", ToolCompleteEvent {
            session_id: self.session_id.clone(),
            tool_name: tool_call.name,
            result: result.clone(),
        })?;

        result
    }
}
```

#### Tauri Streaming Command

```rust
#[tauri::command]
pub async fn send_ai_message_streaming(
    session_id: String,
    message: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<MessageMetadata, String> {
    // Get session context
    let context = state.session_manager
        .get_session_history(session_id.clone(), Some(20))
        .await
        .map_err(|e| e.to_string())?;

    // Clone shared state for async task
    let provider = state.get_active_provider();
    let session_manager = state.session_manager.clone();
    let window_handle = window.clone();

    // Start streaming (runs in background)
    tauri::async_runtime::spawn(async move {
        let handler = StreamingChatHandler {
            provider,
            window: window_handle,
            session_id: session_id.clone(),
        };

        match handler.send_message_streaming(message.clone(), context).await {
            Ok(response) => {
                // Save to database
                let _ = session_manager.add_message(
                    session_id,
                    MessageRole::Assistant,
                    response,
                    None,
                ).await;
            },
            Err(e) => {
                eprintln!("Streaming error: {}", e);
            }
        }
    });

    Ok(MessageMetadata {
        status: "streaming".to_string(),
    })
}
```

#### Frontend Integration

```typescript
// src/services/ai/aiService.ts

export class AIService {
  private eventListeners: Map<string, Set<Function>> = new Map();

  async sendMessage(sessionId: string, message: string): Promise<void> {
    // Start streaming
    await invoke("send_ai_message_streaming", { sessionId, message });

    // Listen for chunks
    const unlisten = await listen<ChunkEvent>("ai:chunk", (event) => {
      if (event.payload.sessionId === sessionId) {
        this.emit("chunk", event.payload.content);
      }
    });

    // Listen for completion
    await listen<CompleteEvent>("ai:complete", (event) => {
      if (event.payload.sessionId === sessionId) {
        this.emit("complete");
        unlisten();
      }
    });

    // Listen for tool executions
    await listen<ToolStartEvent>("ai:tool-start", (event) => {
      if (event.payload.sessionId === sessionId) {
        this.emit("tool-start", event.payload);
      }
    });
  }

  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(data));
    }
  }
}
```

---

## 4. Security Considerations

> **Critical**: AI chat sessions can contain sensitive database info (table names, queries, data samples, credentials). We apply the **same vault + Keychain security** used for database connections.

### 4.0 Security Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Session Security Layers                    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1: Encrypted Storage                                      │
│  • Chat history encrypted with ChaCha20-Poly1305                │
│  • Same encryption approach as DB connections (vault.bin)       │
│  • Auto-unlocked via OS Keychain master password               │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Credential Protection                                  │
│  • AI provider API keys → OS Keychain                           │
│  • OAuth tokens → OS Keychain                                   │
│  • Never stored in plaintext, memory-only after load            │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Data Redaction                                         │
│  • Auto-redact sensitive patterns in context                    │
│  • User-configurable exclude patterns                           │
│  • Strip PII before sending to AI                               │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4: Transport Security                                     │
│  • TLS 1.3 for AI provider communication                        │
│  • Certificate pinning (optional)                               │
│  • No telemetry, no analytics                                   │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5: Context Isolation                                      │
│  • Each session sandboxed                                       │
│  • No cross-session data leakage                                │
│  • Tool execution in restricted context                         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 Encrypted Chat Storage

**Current Connection Storage** (Reference: `src-tauri/src/vault.rs`):

```rust
// How you currently encrypt connections:
// 1. Get master password from OS Keychain
// 2. Encrypt entire JSON with ChaCha20-Poly1305
// 3. Store as single binary file (vault.bin)

fn key_from_keychain() -> Result<[u8; 32], String> {
    let pwd = crate::keychain::get_vault_password()?;
    let bytes = base64::decode(pwd)?;
    // ... derive 32-byte key
}

pub fn vault_write(app: AppHandle, plaintext_json: String) -> Result<(), String> {
    let key = key_from_keychain()?;
    let cipher = ChaCha20Poly1305::new(&key.into());
    let nonce = generate_random_nonce();
    let ciphertext = cipher.encrypt(&nonce, plaintext_json.as_bytes())?;

    // Format: [12-byte nonce][ciphertext]
    let mut out = Vec::new();
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    // Atomic write (tmp + rename)
    fs::write_tmp_then_rename("vault.bin", &out)?;
}
```

**AI Chat Storage** (Hybrid Approach - SQLite + Per-Message Encryption):

```rust
// src-tauri/src/ai/secure_storage.rs

use crate::keychain::get_vault_password;
use rusqlite::{Connection, params};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use base64::Engine as _;

pub struct SecureAIStorage {
    db: Connection,
    cipher: ChaCha20Poly1305,
}

impl SecureAIStorage {
    pub fn new() -> Result<Self, String> {
        // Use SAME master password as connections
        let master_pwd = get_vault_password()?;
        let key_bytes = base64::engine::general_purpose::STANDARD
            .decode(master_pwd)
            .map_err(|e| format!("Failed to decode key: {}", e))?;

        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes[..32]);
        let cipher = ChaCha20Poly1305::new(&key.into());

        // SQLite for metadata + encrypted message blobs
        let db_path = Self::get_db_path()?;
        let db = Connection::open(db_path)
            .map_err(|e| format!("Failed to open AI storage: {}", e))?;

        Self::create_tables(&db)?;

        Ok(Self { db, cipher })
    }

    /// Encrypt and store chat message (same ChaCha20-Poly1305 as connections)
    pub fn store_message(
        &self,
        session_id: &str,
        message: &AIMessage,
    ) -> Result<(), String> {
        // Serialize to JSON
        let plaintext = serde_json::to_string(message)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        // Encrypt (same algorithm as vault.bin)
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self.cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Store encrypted BLOB in SQLite
        self.db.execute(
            "INSERT INTO ai_messages (id, session_id, encrypted_content, nonce, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                message.id,
                session_id,
                ciphertext,
                &nonce_bytes[..],
                chrono::Utc::now().timestamp(),
            ],
        ).map_err(|e| format!("Failed to store: {}", e))?;

        Ok(())
    }

    /// Decrypt and retrieve message
    pub fn get_message(&self, message_id: &str) -> Result<AIMessage, String> {
        let mut stmt = self.db.prepare(
            "SELECT encrypted_content, nonce FROM ai_messages WHERE id = ?1"
        )?;

        let (ciphertext, nonce_bytes): (Vec<u8>, Vec<u8>) = stmt
            .query_row(params![message_id], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;

        // Decrypt (same as vault_read)
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = self.cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| format!("Decryption failed: {}", e))?;

        // Deserialize
        let message: AIMessage = serde_json::from_slice(&plaintext)?;
        Ok(message)
    }

    /// List sessions (metadata only, no decryption needed)
    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let mut stmt = self.db.prepare(
            "SELECT id, title, provider, created_at, message_count
             FROM ai_sessions ORDER BY updated_at DESC"
        )?;

        let sessions = stmt
            .query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    provider: row.get(2)?,
                    created_at: row.get(3)?,
                    message_count: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    /// Secure deletion (overwrite then delete)
    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        // Overwrite encrypted blobs with random data
        let message_ids: Vec<String> = self.db
            .prepare("SELECT id FROM ai_messages WHERE session_id = ?1")?
            .query_map(params![session_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        for msg_id in &message_ids {
            let mut random_data = vec![0u8; 1024];
            rand::thread_rng().fill_bytes(&mut random_data);

            self.db.execute(
                "UPDATE ai_messages SET encrypted_content = ?1 WHERE id = ?2",
                params![random_data, msg_id],
            )?;
        }

        // Now safe to delete
        self.db.execute(
            "DELETE FROM ai_messages WHERE session_id = ?1",
            params![session_id],
        )?;

        self.db.execute(
            "DELETE FROM ai_sessions WHERE id = ?1",
            params![session_id],
        )?;

        Ok(())
    }

    fn create_tables(db: &Connection) -> Result<(), String> {
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                provider TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                message_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS ai_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                encrypted_content BLOB NOT NULL,
                nonce BLOB NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session
            ON ai_messages(session_id, created_at);"
        )?;

        Ok(())
    }
}
```

**Why SQLite + Per-Message Encryption (not single file like connections)?**

1. **Connections**: Small dataset (10-100 items) → Single encrypted file works great
2. **AI Chats**: Large dataset (1000s of messages) → Need pagination, search, filtering

**Key Similarities**:

- ✅ Same ChaCha20-Poly1305 encryption
- ✅ Same master password from OS Keychain
- ✅ Same 32-byte key derivation
- ✅ Same 12-byte nonce format
- ✅ Same security guarantees

**Database Schema**:

```sql
-- Encrypted chat storage (SQLite)
-- Location: ~/Library/Application Support/com.hieuvd.devdb-studio/ai_storage.db

CREATE TABLE ai_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,                  -- Not encrypted (for list view)
    provider TEXT NOT NULL,                -- Not encrypted
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0
);

CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    encrypted_content BLOB NOT NULL,       -- ChaCha20-Poly1305 encrypted JSON
    nonce BLOB NOT NULL,                   -- 12-byte nonce
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

-- Metadata only, actual message content encrypted
```

### 4.2 AI Provider Credentials Security

**Storage**: OS Keychain (same as database passwords)

```rust
// src-tauri/src/ai/credentials.rs

use keyring::Entry;

const AI_KEYCHAIN_SERVICE: &str = "com.hieuvd.devdb-studio.ai";

pub struct AICredentialManager;

impl AICredentialManager {
    /// Store AI provider API key in OS Keychain
    pub fn store_api_key(provider: &str, api_key: &str) -> Result<(), String> {
        let account = format!("{}_api_key", provider);
        let entry = Entry::new(AI_KEYCHAIN_SERVICE, &account)
            .map_err(|e| format!("Keychain access failed: {}", e))?;

        entry.set_password(api_key)
            .map_err(|e| format!("Failed to store API key: {}", e))?;

        Ok(())
    }

    /// Retrieve API key from OS Keychain
    pub fn get_api_key(provider: &str) -> Result<String, String> {
        let account = format!("{}_api_key", provider);
        let entry = Entry::new(AI_KEYCHAIN_SERVICE, &account)
            .map_err(|e| format!("Keychain access failed: {}", e))?;

        entry.get_password()
            .map_err(|e| format!("API key not found: {}", e))
    }

    /// Store OAuth tokens in OS Keychain
    pub fn store_oauth_tokens(
        provider: &str,
        access_token: &str,
        refresh_token: &str,
        expires_at: i64,
    ) -> Result<(), String> {
        let tokens = serde_json::json!({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
        });

        let account = format!("{}_oauth", provider);
        let entry = Entry::new(AI_KEYCHAIN_SERVICE, &account)
            .map_err(|e| format!("Keychain access failed: {}", e))?;

        entry.set_password(&tokens.to_string())
            .map_err(|e| format!("Failed to store OAuth tokens: {}", e))?;

        Ok(())
    }

    /// Delete all credentials for a provider
    pub fn delete_credentials(provider: &str) -> Result<(), String> {
        // Delete API key
        let api_account = format!("{}_api_key", provider);
        if let Ok(entry) = Entry::new(AI_KEYCHAIN_SERVICE, &api_account) {
            let _ = entry.delete_credential();
        }

        // Delete OAuth tokens
        let oauth_account = format!("{}_oauth", provider);
        if let Ok(entry) = Entry::new(AI_KEYCHAIN_SERVICE, &oauth_account) {
            let _ = entry.delete_credential();
        }

        Ok(())
    }
}

#[tauri::command]
pub fn store_ai_api_key(provider: String, api_key: String) -> Result<(), String> {
    AICredentialManager::store_api_key(&provider, &api_key)
}

#[tauri::command]
pub fn get_ai_api_key(provider: String) -> Result<String, String> {
    AICredentialManager::get_api_key(&provider)
}
```

**Key Points**:

- ✅ API keys never stored in config files
- ✅ OAuth tokens stored in OS Keychain
- ✅ Auto-retrieved on app launch (same as DB passwords)
- ✅ No user prompts needed
- ✅ Platform-specific secure storage (macOS Keychain, Windows Credential Manager, Linux Secret Service)

### 4.3 Sensitive Data Redaction

**Auto-redact patterns before sending to AI**:

```rust
// src-tauri/src/ai/redactor.rs

use regex::Regex;
use once_cell::sync::Lazy;

static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b").unwrap()
);

static IP_PATTERN: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap()
);

static PASSWORD_PATTERN: Lazy<Regex> = Lazy::new(||
    Regex::new(r"(?i)(password|passwd|pwd|secret|token|key)\s*[:=]\s*['\"]?([^'\";\s]+)").unwrap()
);

static CREDIT_CARD_PATTERN: Lazy<Regex> = Lazy::new(||
    Regex::new(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b").unwrap()
);

pub struct SensitiveDataRedactor {
    custom_patterns: Vec<Regex>,
    redaction_enabled: bool,
}

impl SensitiveDataRedactor {
    pub fn new() -> Self {
        Self {
            custom_patterns: Vec::new(),
            redaction_enabled: true,
        }
    }

    /// Redact sensitive data from text before sending to AI
    pub fn redact(&self, text: &str) -> String {
        if !self.redaction_enabled {
            return text.to_string();
        }

        let mut redacted = text.to_string();

        // Email addresses
        redacted = EMAIL_PATTERN.replace_all(&redacted, "[EMAIL]").to_string();

        // IP addresses
        redacted = IP_PATTERN.replace_all(&redacted, "[IP_ADDRESS]").to_string();

        // Password-like patterns
        redacted = PASSWORD_PATTERN.replace_all(&redacted, "$1=[REDACTED]").to_string();

        // Credit cards
        redacted = CREDIT_CARD_PATTERN.replace_all(&redacted, "[CARD_NUMBER]").to_string();

        // Custom patterns
        for pattern in &self.custom_patterns {
            redacted = pattern.replace_all(&redacted, "[REDACTED]").to_string();
        }

        redacted
    }

    /// Redact table data before sending to AI
    pub fn redact_table_data(&self, rows: &[Row]) -> Vec<Row> {
        if !self.redaction_enabled {
            return rows.to_vec();
        }

        // Sample only first 10 rows
        let sample_size = std::cmp::min(10, rows.len());

        rows.iter()
            .take(sample_size)
            .map(|row| {
                // Redact each cell
                Row {
                    cells: row.cells.iter()
                        .map(|cell| self.redact(&cell.to_string()))
                        .collect()
                }
            })
            .collect()
    }

    /// Add custom redaction pattern
    pub fn add_pattern(&mut self, pattern: &str) -> Result<(), String> {
        let regex = Regex::new(pattern)
            .map_err(|e| format!("Invalid regex pattern: {}", e))?;
        self.custom_patterns.push(regex);
        Ok(())
    }
}
```

**Configuration UI**:

```typescript
// User preferences for data privacy
interface AIPrivacySettings {
  autoRedactEmails: boolean; // Default: true
  autoRedactIPs: boolean; // Default: true
  autoRedactPasswords: boolean; // Default: true
  autoRedactCreditCards: boolean; // Default: true
  customRedactionPatterns: string[]; // User-defined regex
  maxRowsSample: number; // Default: 10
  excludeTablesFromContext: string[]; // Tables to never send
  excludeColumnsPattern: string[]; // e.g., ["*password*", "*ssn*"]
}
```

### 4.4 Context Isolation & Data Minimization

**Principles**:

1. **Only send what's needed**: Don't dump entire table structures
2. **User confirmation**: Ask before sending large data samples
3. **Exclude sensitive tables**: User-configurable blocklist
4. **Column-level filtering**: Auto-exclude columns matching sensitive patterns

```rust
// src-tauri/src/ai/context.rs

pub struct ContextBuilder {
    redactor: SensitiveDataRedactor,
    privacy_settings: AIPrivacySettings,
}

impl ContextBuilder {
    /// Build safe context from current workspace state
    pub async fn build_context(
        &self,
        connection: &ConnectionInfo,
        current_table: Option<&TableInfo>,
        query_editor: Option<&str>,
    ) -> Result<AIContext, String> {
        // Check if table is excluded
        if let Some(table) = current_table {
            if self.is_table_excluded(&table.name) {
                return Ok(AIContext {
                    connection: self.safe_connection_info(connection),
                    current_table: None,  // Excluded
                    query_editor: query_editor.map(|q| self.redactor.redact(q)),
                    warning: Some("Current table excluded from AI context".to_string()),
                });
            }
        }

        Ok(AIContext {
            connection: self.safe_connection_info(connection),
            current_table: current_table.map(|t| self.safe_table_info(t)),
            query_editor: query_editor.map(|q| self.redactor.redact(q)),
            warning: None,
        })
    }

    fn safe_connection_info(&self, conn: &ConnectionInfo) -> SafeConnectionInfo {
        SafeConnectionInfo {
            id: conn.id.clone(),
            name: conn.name.clone(),
            db_type: conn.db_type.clone(),
            schema: conn.schema.clone(),
            // DO NOT include: host, port, username, password
        }
    }

    fn safe_table_info(&self, table: &TableInfo) -> SafeTableInfo {
        // Filter out sensitive columns
        let safe_columns = table.columns.iter()
            .filter(|col| !self.is_column_sensitive(&col.name))
            .map(|col| SafeColumnInfo {
                name: col.name.clone(),
                data_type: col.data_type.clone(),
                nullable: col.nullable,
                // DO NOT include: default values, constraints with sensitive data
            })
            .collect();

        SafeTableInfo {
            name: table.name.clone(),
            columns: safe_columns,
            row_count: Some(table.row_count),
            // DO NOT include: actual data samples
        }
    }

    fn is_table_excluded(&self, table_name: &str) -> bool {
        self.privacy_settings.exclude_tables_from_context
            .iter()
            .any(|pattern| self.matches_pattern(table_name, pattern))
    }

    fn is_column_sensitive(&self, column_name: &str) -> bool {
        let sensitive_patterns = [
            "password", "passwd", "pwd", "secret", "token",
            "ssn", "social_security", "credit_card", "cvv",
            "api_key", "private_key", "salt", "hash"
        ];

        let lower = column_name.to_lowercase();
        sensitive_patterns.iter().any(|p| lower.contains(p))
    }
}
```

### 4.5 Tool Execution Security

**Prevent dangerous operations**:

```rust
// src-tauri/src/ai/tools/safety.rs

pub struct ToolSafetyChecker;

impl ToolSafetyChecker {
    /// Verify tool execution is safe
    pub fn check_tool_call(&self, tool: &ToolCall) -> Result<(), String> {
        match tool.name.as_str() {
            "execute_query" => self.check_query_safety(&tool.input)?,
            "write_file" => self.check_file_write_safety(&tool.input)?,
            "execute_command" => return Err("Command execution not allowed".to_string()),
            _ => {}
        }
        Ok(())
    }

    fn check_query_safety(&self, input: &serde_json::Value) -> Result<(), String> {
        let sql = input.get("sql")
            .and_then(|v| v.as_str())
            .ok_or("Missing SQL")?;

        // Parse SQL
        let parsed = sqlparser::parse(sql)
            .map_err(|e| format!("Invalid SQL: {}", e))?;

        // Block mutations
        for stmt in &parsed {
            match stmt {
                Statement::Insert(_)
                | Statement::Update(_)
                | Statement::Delete(_)
                | Statement::Drop(_)
                | Statement::CreateTable(_)
                | Statement::AlterTable(_) => {
                    return Err(format!(
                        "Mutation queries not allowed in AI context: {:?}",
                        stmt
                    ));
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn check_file_write_safety(&self, input: &serde_json::Value) -> Result<(), String> {
        let path = input.get("path")
            .and_then(|v| v.as_str())
            .ok_or("Missing file path")?;

        // Must be within workspace
        let workspace = std::env::current_dir()
            .map_err(|e| format!("Failed to get workspace: {}", e))?;

        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("Invalid path: {}", e))?;

        if !canonical.starts_with(&workspace) {
            return Err("File write outside workspace not allowed".to_string());
        }

        // Block sensitive files
        let sensitive_patterns = vec![".env", "passwords", "secrets"];
        let path_str = canonical.to_string_lossy().to_lowercase();

        if sensitive_patterns.iter().any(|p| path_str.contains(p)) {
            return Err("Cannot write to sensitive files".to_string());
        }

        Ok(())
    }
}
```

### 4.6 File Operation Restrictions

```rust
pub struct SecureFileOps {
    workspace_root: PathBuf,
}

impl SecureFileOps {
    pub fn validate_path(&self, path: &str) -> Result<PathBuf> {
        let canonical = std::fs::canonicalize(path)?;

        // Ensure path is within workspace
        if !canonical.starts_with(&self.workspace_root) {
            return Err(SecurityError::PathEscapeAttempt);
        }

        // Block sensitive files
        let blocked = vec![".env", ".git", "node_modules"];
        if blocked.iter().any(|b| canonical.to_str().unwrap().contains(b)) {
            return Err(SecurityError::SensitiveFile);
        }

        Ok(canonical)
    }
}
```

### 4.2 Command Execution Safety

```rust
pub struct SafeCommandExecutor {
    allowed_commands: HashSet<String>,
}

impl SafeCommandExecutor {
    pub fn new() -> Self {
        let mut allowed = HashSet::new();
        allowed.insert("git".to_string());
        allowed.insert("pnpm".to_string());
        allowed.insert("cargo".to_string());

        Self { allowed_commands: allowed }
    }

    pub async fn execute(&self, command: &str, args: Vec<String>) -> Result<Output> {
        // Validate command is allowed
        if !self.allowed_commands.contains(command) {
            return Err(SecurityError::CommandNotAllowed);
        }

        // Execute with timeout
        tokio::time::timeout(
            Duration::from_secs(30),
            Command::new(command).args(args).output()
        ).await?
    }
}
```

### 4.3 Database Query Safety

```rust
pub async fn execute_query_safe(
    connection_id: String,
    sql: String,
) -> Result<QueryResult> {
    // Parse SQL
    let parsed = sqlparser::parse(&sql)?;

    // Block mutations in AI context
    for statement in &parsed {
        match statement {
            Statement::Insert(_) | Statement::Update(_) | Statement::Delete(_) => {
                return Err(SecurityError::MutationNotAllowed);
            },
            _ => {}
        }
    }

    // Execute read-only query
    execute_readonly_query(connection_id, sql).await
}
```

### 4.4 Token Storage Security

```rust
// Use OS secure storage (keyring-rs)
use keyring::Entry;

pub struct SecureTokenStorage;

impl SecureTokenStorage {
    pub fn store_token(&self, provider: &str, token: &str) -> Result<()> {
        let entry = Entry::new("devdb-studio-ai", provider)?;
        entry.set_password(token)?;
        Ok(())
    }

    pub fn get_token(&self, provider: &str) -> Result<String> {
        let entry = Entry::new("devdb-studio-ai", provider)?;
        Ok(entry.get_password()?)
    }

    pub fn delete_token(&self, provider: &str) -> Result<()> {
        let entry = Entry::new("devdb-studio-ai", provider)?;
        entry.delete_password()?;
        Ok(())
    }
}
```

### 4.7 Storage Architecture Summary

**Hybrid Approach**: Different storage strategies for different data types

```
┌─────────────────────────────────────────────────────────────┐
│              DevDB Studio Secure Storage                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📦 Connection Storage (vault.bin)                          │
│  ├── Format: Single encrypted binary file                   │
│  ├── Encryption: ChaCha20-Poly1305                          │
│  ├── Location: ~/Library/Application Support/.../vault.bin │
│  ├── Data: All connections as encrypted JSON blob           │
│  └── Why: Small dataset (10-100), load-all-at-once         │
│                                                              │
│  ✅ Keep this as-is - working perfectly                     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  💬 AI Chat Storage (ai_storage.db)                         │
│  ├── Format: SQLite with encrypted BLOBs per message        │
│  ├── Encryption: ChaCha20-Poly1305 (same algorithm)         │
│  ├── Location: ~/Library/Application Support/.../ai_*.db   │
│  ├── Data: Per-message encrypted blobs in SQLite            │
│  └── Why: Large dataset (1000s), need pagination/search    │
│                                                              │
│  🆕 New implementation for AI assistant                     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  🔑 Shared Security                                         │
│  ├── Master Password: Auto-generated, stored in OS Keychain │
│  ├── Service: com.hieuvd.devdb-studio.vault                │
│  ├── Key: 32-byte key from base64-encoded password          │
│  ├── Algorithm: ChaCha20-Poly1305                           │
│  └── Nonce: 12 random bytes per encryption                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implementation Files**:

```
src-tauri/src/
├── keychain.rs            # OS Keychain (keyring crate) - SHARED
├── vault.rs               # Connection encryption (vault.bin)
└── ai/
    ├── secure_storage.rs  # AI chat encryption (SQLite + ChaCha20)
    └── credentials.rs     # AI provider keys (OS Keychain)
```

**Why NOT migrate connections to SQLite?**

- ✅ Current approach works perfectly
- ✅ Single file encryption is simpler for small datasets
- ✅ Atomic writes with temp file
- ✅ No migration risk
- ✅ Fast enough for 100 connections

**Why SQLite for AI chats?**

- ✅ Need to paginate 1000s of messages
- ✅ Full-text search across sessions
- ✅ Complex queries (filter by date, provider, etc.)
- ✅ Incremental writes per message
- ✅ Relational data (sessions → messages → tools)

---

## 5. UI Components

### 5.1 AI Assistant Sidebar

**Visual Design**:

```
┌─────────────────────────────────┐
│  🤖 AI Assistant        [×] [⚙] │  ← Header with close/settings
├─────────────────────────────────┤
│  📂 Session: "Query Help"   [⋮] │  ← Session selector & menu
├─────────────────────────────────┤
│                                 │
│  💬 User Message                │  ← Chat messages
│  ───────────────────────────    │
│  🤖 AI Response with            │
│     [SQL Code Block]            │  ← Syntax highlighted
│     📊 [Query Results Table]    │  ← Rich inline results
│     🔧 Tool: analyze_query ✓    │  ← Tool execution badges
│                                 │
│  ⚡ Streaming response...       │  ← Live streaming indicator
│                                 │
│  ↓  Scroll for more             │
│                                 │
├─────────────────────────────────┤
│  💡 Context: users table        │  ← Current context chip
├─────────────────────────────────┤
│  [Type your message...]    [↵]  │  ← Input with send button
│  [@mention table]  [/command]   │  ← Autocomplete hints
└─────────────────────────────────┘
```

**Implementation**:

```typescript
// src/components/AIAssistant/AIAssistantSidebar.tsx

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
};

export function AIAssistantSidebar() {
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const aiService = useAIService();

  useEffect(() => {
    // Load or create session once the component mounts
    void loadSession();

    // Subscribe to streaming events and collect disposers
    const offChunk = aiService.on("chunk", handleChunk);
    const offComplete = aiService.on("complete", handleComplete);
    const offToolStart = aiService.on("tool-start", handleToolStart);
    const offToolComplete = aiService.on("tool-complete", handleToolComplete);

    return () => {
      offChunk();
      offComplete();
      offToolStart();
      offToolComplete();
    };
  }, [aiService, handleChunk, handleComplete, handleToolStart, handleToolComplete]);

  const handleSend = async () => {
    if (!session || !input.trim()) return;

    // Add user message
    const userMsg: Message = {
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Start streaming response
    setIsStreaming(true);
    await aiService.sendMessage(session.id, input);
  };

  const handleChunk = useCallback((chunk: string) => {
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
        // Append to last message
        return [
          ...prev.slice(0, -1),
          { ...lastMsg, content: lastMsg.content + chunk },
        ];
      } else {
        // Create new message
        return [
          ...prev,
          {
            role: "assistant",
            content: chunk,
            isStreaming: true,
            timestamp: Date.now(),
          },
        ];
      }
    });
  }, []);

  const handleComplete = useCallback(() => {
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === prev.length - 1 && msg.role === "assistant"
          ? { ...msg, isStreaming: false }
          : msg
      )
    );
  }, []);

  const handleToolStart = useCallback((payload: ToolExecutionEvent) => {
    // Optional: surface tool execution status in UI
  }, []);

  const handleToolComplete = useCallback((payload: ToolExecutionResultEvent) => {
    // Optional: render tool results once available
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4">
        <SessionSelector
          currentSession={session}
          onSessionChange={setSession}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
          placeholder="Ask about your database, schemas, queries..."
        />
      </div>
    </div>
  );
}
```

### 5.2 Tool Execution Visualization

```typescript
// src/components/AIAssistant/ToolExecutionCard.tsx

export function ToolExecutionCard({ execution }: { execution: ToolExecution }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-3 bg-muted/50">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {execution.status === "pending" && (
            <Loader2 className="animate-spin" />
          )}
          {execution.status === "success" && (
            <CheckCircle2 className="text-green-500" />
          )}
          {execution.status === "error" && <XCircle className="text-red-500" />}

          <span className="font-mono text-sm">{execution.toolName}</span>

          {execution.durationMs && (
            <span className="text-xs text-muted-foreground">
              {execution.durationMs}ms
            </span>
          )}
        </div>

        <ChevronDown
          className={cn("transition-transform", expanded && "rotate-180")}
        />
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div>
            <div className="text-xs font-semibold mb-1">Input:</div>
            <CodeBlock
              language="json"
              code={JSON.stringify(execution.input, null, 2)}
            />
          </div>

          {execution.output && (
            <div>
              <div className="text-xs font-semibold mb-1">Output:</div>
              <CodeBlock
                language="json"
                code={JSON.stringify(execution.output, null, 2)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### 5.3 Provider Configuration UI

```typescript
// src/components/AIAssistant/ProviderConfigDialog.tsx

export function ProviderConfigDialog() {
  const [provider, setProvider] = useState<AIProviderType>("openai");
  const [config, setConfig] = useState<ProviderConfig>({});

  const handleTest = async () => {
    try {
      const result = await invoke<ConnectionTestResult>("test_ai_connection", {
        provider,
        config,
      });

      if (result.success) {
        toast.success("Connection successful!");
      }
    } catch (error) {
      toast.error(`Connection failed: ${error}`);
    }
  };

  const handleOAuthLogin = async () => {
    try {
      await invoke("start_claude_oauth");
      // OAuth window will open, events will be emitted
    } catch (error) {
      toast.error(`OAuth failed: ${error}`);
    }
  };

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure AI Provider</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic Claude</SelectItem>
              <SelectItem value="azure">Azure OpenAI</SelectItem>
              <SelectItem value="local">Local Model</SelectItem>
            </SelectContent>
          </Select>

          {provider === "anthropic" && (
            <div className="space-y-2">
              <Label>Authentication Method</Label>
              <RadioGroup
                value={config.authMethod}
                onValueChange={(v) => setConfig({ ...config, authMethod: v })}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="api_key" id="api_key" />
                  <Label htmlFor="api_key">API Key</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="oauth" id="oauth" />
                  <Label htmlFor="oauth">OAuth (Recommended)</Label>
                </div>
              </RadioGroup>

              {config.authMethod === "oauth" && (
                <Button onClick={handleOAuthLogin} variant="outline">
                  <Lock className="mr-2 h-4 w-4" />
                  Login with Claude
                </Button>
              )}
            </div>
          )}

          <Input
            label="Base URL"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />

          <Input
            label="Default Model"
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            placeholder="gpt-4o"
          />

          <div className="flex gap-2">
            <Button onClick={handleTest} variant="outline">
              Test Connection
            </Button>
            <Button onClick={handleSave}>Save Configuration</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 6. Development Roadmap

### Phase 1: Foundation (Week 1-2)

**Goals**: Core infrastructure and basic chat

- [ ] **Day 1-2: Rust Backend Setup**

  - [ ] Create `ai` module in `src-tauri/src/`
  - [ ] Implement provider abstractions
  - [ ] Add OpenAI provider integration
  - [ ] Setup SQLite session storage

- [ ] **Day 3-4: Basic UI**

  - [ ] Create `AIAssistantPanel` component
  - [ ] Implement chat interface
  - [ ] Add message display with markdown
  - [ ] Create session list UI

- [ ] **Day 5-7: Tauri Integration**
  - [ ] Implement Tauri commands for chat
  - [ ] Setup event system for streaming
  - [ ] Add configuration management
  - [ ] Test end-to-end flow

**Deliverables**:

- ✅ Basic chat with OpenAI
- ✅ Session persistence
- ✅ Simple UI in DevDB Studio

### Phase 2: Multi-Provider & OAuth (Week 3)

**Goals**: Support multiple providers with secure auth

- [ ] **Day 1-2: Provider Expansion**

  - [ ] Add Anthropic Claude provider
  - [ ] Add Azure OpenAI provider
  - [ ] Add local model support (Ollama)
  - [ ] Implement provider switching UI

- [ ] **Day 3-5: OAuth Implementation**

  - [ ] Implement OAuth flow for Claude
  - [ ] Create callback server
  - [ ] Add secure token storage
  - [ ] Build OAuth UI components

- [ ] **Day 6-7: Testing**
  - [ ] Test all providers
  - [ ] Test OAuth flow end-to-end
  - [ ] Security audit

**Deliverables**:

- ✅ 4+ AI providers supported
- ✅ Claude OAuth working
- ✅ Secure credential storage

### Phase 3: Custom Database Tools (Week 4-5)

**Goals**: Deep database integration

- [ ] **Day 1-3: Schema Tools**

  - [ ] Implement table structure tool
  - [ ] Add relationship discovery tool
  - [ ] Create ERD generation tool
  - [ ] Build schema browsing tools

- [ ] **Day 4-6: Query Tools**

  - [ ] Implement safe query execution
  - [ ] Add query explain tool
  - [ ] Create SQL validation tool
  - [ ] Build SQL formatter tool

- [ ] **Day 7-10: Advanced Tools**
  - [ ] Add data search tools
  - [ ] Implement code generation tools
  - [ ] Create migration generation tools
  - [ ] Build CRUD API generator

**Deliverables**:

- ✅ 15+ custom database tools
- ✅ Safe query execution
- ✅ Code generation capabilities

### Phase 4: Streaming & Polish (Week 6)

**Goals**: Production-ready features

- [ ] **Day 1-2: Streaming Refinement**

  - [ ] Optimize streaming performance
  - [ ] Add retry logic
  - [ ] Implement graceful error handling
  - [ ] Add progress indicators

- [ ] **Day 3-4: UI Polish**

  - [ ] Add tool execution visualization
  - [ ] Improve message rendering
  - [ ] Add syntax highlighting
  - [ ] Create keyboard shortcuts

- [ ] **Day 5-7: Testing & Documentation**
  - [ ] Write comprehensive tests
  - [ ] Create user documentation
  - [ ] Build example prompts
  - [ ] Performance optimization

**Deliverables**:

- ✅ Smooth streaming experience
- ✅ Polished UI
- ✅ Complete documentation
- ✅ Production-ready

---

## 7. Testing Strategy

### 7.1 Unit Tests

```rust
// src-tauri/src/ai/tests/provider_tests.rs

#[tokio::test]
async fn test_openai_provider_uses_mock_transport() {
    let server = httpmock::MockServer::start_async().await;
    server.mock_async(|when, then| {
        when.path("/v1/chat/completions");
        then.status(200)
            .json_body(serde_json::json!({
                "id": "cmpl-test",
                "choices": [{
                    "message": { "role": "assistant", "content": "4" }
                }]
            }));
    }).await;

    let provider = OpenAIProvider::with_base_url(
        server.base_url(),
        "test-key".to_string(),
        "gpt-4o".to_string(),
    );

    let messages = vec![Message::user("What is 2+2?".to_string())];

    let response = provider.chat(messages).await.unwrap();
    assert_eq!(response.content.trim(), "4");
}

#[tokio::test]
async fn test_session_persistence() {
    let manager = SessionManager::new_in_memory();

    let session = manager.create_session(
        "openai".to_string(),
        "gpt-4o".to_string(),
    ).await.unwrap();

    manager.add_message(
        session.id.clone(),
        MessageRole::User,
        "Test message".to_string(),
        None,
    ).await.unwrap();

    let history = manager.get_session_history(session.id, None).await.unwrap();
    assert_eq!(history.len(), 1);
}
```

### 7.2 Integration Tests

```rust
// src-tauri/tests/ai_integration.rs

#[tokio::test]
async fn test_tool_execution_flow() {
    let app = setup_test_app().await;

    // Register tools
    app.register_database_tools();

    // Send message that requires tool use
    let response = app.send_message(
        "Show me the structure of the users table"
    ).await.unwrap();

    // Verify tool was called
    assert!(response.tool_calls.is_some());
    let tool_calls = response.tool_calls.unwrap();
    assert_eq!(tool_calls[0].name, "get_table_structure");
}
```

### 7.3 E2E Tests

```typescript
// e2e/ai-assistant.spec.ts

test("AI assistant chat flow", async ({ page }) => {
  await page.goto("/workspace/test-connection");

  // Open AI assistant
  await page.click('[data-testid="ai-assistant-toggle"]');

  // Type message
  await page.fill('[data-testid="ai-input"]', "List all tables");
  await page.press('[data-testid="ai-input"]', "Enter");

  // Wait for streaming response
  await page.waitForSelector('[data-testid="ai-message-assistant"]');

  // Verify response contains table list
  const response = await page.textContent(
    '[data-testid="ai-message-assistant"]',
  );
  expect(response).toContain("tables");
});
```

---

## 8. Performance Considerations

### 8.1 Context Window Management

```rust
pub struct ContextWindowManager {
    max_tokens: usize,
}

impl ContextWindowManager {
    pub fn optimize_context(
        &self,
        messages: Vec<Message>,
        max_tokens: usize,
    ) -> Vec<Message> {
        let mut total_tokens = 0;
        let mut optimized = Vec::new();
        let mut tail: Vec<Message> = Vec::new();

        // Always include system message
        if let Some(system_msg) = messages.first() {
            if system_msg.role == MessageRole::System {
                optimized.push(system_msg.clone());
                total_tokens += self.count_tokens(&system_msg.content);
            }
        }

        // Include recent messages until token limit
        for msg in messages.iter().rev() {
            let tokens = self.count_tokens(&msg.content);
            if total_tokens + tokens > max_tokens {
                break;
            }
            tail.push(msg.clone());
            total_tokens += tokens;
        }

        tail.reverse();
        optimized.extend(tail.into_iter());

        optimized
    }
}
```

### 8.2 Streaming Optimization

```rust
// Buffer chunks for efficient UI updates
pub struct ChunkBuffer {
    buffer: String,
    threshold: usize,
    last_emit: Instant,
}

impl ChunkBuffer {
    pub fn add(&mut self, chunk: &str) -> Option<String> {
        self.buffer.push_str(chunk);

        // Emit if buffer is full or timeout
        if self.buffer.len() >= self.threshold
            || self.last_emit.elapsed() > Duration::from_millis(50) {
            let result = self.buffer.clone();
            self.buffer.clear();
            self.last_emit = Instant::now();
            Some(result)
        } else {
            None
        }
    }
}
```

### 8.3 Database Query Optimization

```rust
// Use prepared statements and query caching
pub struct QueryCache {
    cache: Arc<Mutex<LruCache<String, QueryResult>>>,
}

impl QueryCache {
    pub async fn execute_cached(
        &self,
        connection_id: &str,
        sql: &str,
        ttl: Duration,
    ) -> Result<QueryResult> {
        let cache_key = format!(
            "{:x}",
            md5::compute(format!("{}::{}", connection_id, sql))
        );

        // Check cache scoped by connection + SQL
        if let Some(result) = self.cache.lock().await.get(&cache_key) {
            return Ok(result.clone());
        }

        // Execute read-only query through safety guard
        let result = execute_query_safe(connection_id.to_string(), sql.to_string()).await?;
        self.cache.lock().await.put(cache_key, result.clone());

        Ok(result)
    }
}
```

---

## 9. Deployment & Packaging

### 9.1 Rust Dependencies

```toml
# src-tauri/Cargo.toml

[dependencies]
# Existing dependencies
tauri = "2"
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.30", features = ["bundled"] }

# New AI dependencies
async-openai = "0.20"
anthropic-sdk-rs = "0.2"
reqwest = { version = "0.11", features = ["json", "stream"] }
oauth2 = "4.4"
keyring = "2.3"
uuid = { version = "1", features = ["v4"] }

# MCP protocol
serde_json = "1"
async-trait = "0.1"

# Utilities
chrono = "0.4"
lru = "0.12"
md5 = "0.7"

[dev-dependencies]
httpmock = "0.7"
```

### 9.2 Frontend Dependencies

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "react": "^18.3.1",
    "react-markdown": "^9.0.0",
    "react-syntax-highlighter": "^15.5.0",
    "zustand": "^4.5.0"
  }
}
```

### 9.3 Build Configuration

```json
// src-tauri/tauri.conf.json

{
  "bundle": {
    "identifier": "com.devdb.studio",
    "resources": ["resources/ai-prompts/**"]
  },
  "security": {
    "csp": "default-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.azure.com http://localhost:*"
  }
}
```

---

## 10. Future Enhancements

### 10.1 Advanced Features

- **Voice Input**: Speech-to-text for queries
- **Multi-Modal**: Image input for ERD analysis
- **Collaborative Sessions**: Share AI chats with team
- **Custom Prompts**: User-defined prompt templates
- **Workflow Automation**: AI-driven task chains

### 10.2 Enterprise Features

- **Team Sharing**: Shared AI configurations
- **Usage Analytics**: Track AI usage and costs
- **Compliance**: Audit logs for AI interactions
- **Fine-Tuning**: Custom model training on project data

### 10.3 Integration Points

- **Git Integration**: AI-powered commit messages
- **Documentation**: Auto-generate schema docs
- **Testing**: AI-generated test data
- **Performance**: AI-driven query optimization

---

## 11. Success Metrics

### Key Performance Indicators

- **Response Time**: < 2s for first token
- **Streaming Latency**: < 100ms per chunk
- **Tool Execution**: < 500ms average
- **Session Load**: < 200ms for history
- **UI Responsiveness**: 60 FPS during streaming

### Quality Metrics

- **Tool Success Rate**: > 95%
- **Query Safety**: 100% (no mutations)
- **OAuth Success Rate**: > 98%
- **User Satisfaction**: > 4.5/5

---

## 12. References & Resources

### OpenCode Architecture

- GitHub: https://github.com/sst/opencode
- Documentation: https://opencode.ai/docs

### AI Provider APIs

- OpenAI: https://platform.openai.com/docs
- Anthropic: https://docs.anthropic.com/
- Azure OpenAI: https://learn.microsoft.com/azure/ai-services/openai/

### MCP Protocol

- Specification: https://modelcontextprotocol.io/
- Rust Implementation: https://github.com/modelcontextprotocol/rust-sdk

### OAuth2

- RFC 6749: https://oauth.net/2/
- PKCE: https://oauth.net/2/pkce/
- oauth2-rs: https://docs.rs/oauth2/latest/oauth2/

### Tauri

- Tauri V2 Docs: https://v2.tauri.app/
- IPC Guide: https://v2.tauri.app/develop/inter-process-communication/
- Events: https://v2.tauri.app/develop/calling-frontend/#events

---

## 13. Implementation Checklist

### Prerequisites

- [ ] Review OpenCode source code
- [ ] Setup AI provider accounts
- [ ] Obtain API keys / OAuth credentials
- [ ] Plan database tool requirements

### Phase 1: Foundation

- [ ] Create Rust module structure
- [ ] Implement provider abstractions
- [ ] Setup SQLite session storage
- [ ] Build basic UI components
- [ ] Implement streaming architecture

### Phase 2: Providers

- [ ] OpenAI integration
- [ ] Anthropic integration
- [ ] Claude OAuth flow
- [ ] Azure OpenAI integration
- [ ] Local model support

### Phase 3: Tools

- [ ] Schema tools (5)
- [ ] Query tools (4)
- [ ] Data tools (3)
- [ ] Code generation tools (3)
- [ ] File system tools (4)

### Phase 4: Polish

- [ ] UI refinements
- [ ] Error handling
- [ ] Performance optimization
- [ ] Documentation
- [ ] Testing

### Phase 5: Deployment

- [ ] Security audit
- [ ] Performance benchmarks
- [ ] User testing
- [ ] Release preparation

---

## Conclusion

This specification provides a comprehensive roadmap for building a production-ready AI assistant for DevDB Studio, inspired by OpenCode but deeply integrated with our database development workflow. The assistant will support multiple AI providers, custom database tools, persistent sessions, and streaming responses, all while maintaining security and performance.

**Estimated Timeline**: 6 weeks
**Team Size**: 1-2 developers
**Priority**: High (Strategic feature for differentiation)

**Next Steps**:

1. Review and approve this specification
2. Setup development environment
3. Begin Phase 1 implementation
4. Weekly progress reviews
