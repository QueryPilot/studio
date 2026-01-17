# Component Guide: QuickFilter & AIAssistantSidebar

**Last Updated:** January 2026
**Phase 3 Integration:** ✅ Complete

This guide covers two powerful components that leverage Phase 3 AI architecture improvements:
- **QuickFilter** - Multi-mode intelligent filtering (Search, SQL, AI)
- **AIAssistantSidebar** - Context-aware AI chat assistant

---

## Table of Contents

1. [QuickFilter Component](#quickfilter-component)
2. [AIAssistantSidebar Component](#aiassistantsidebar-component)
3. [Phase 3 Integration](#phase-3-integration)
4. [Usage Patterns](#usage-patterns)
5. [Examples](#examples)

---

## QuickFilter Component

### Overview

`QuickFilter` is a sophisticated filter input component with three intelligent modes and real-time validation.

**Location:** `src/components/DataGrid/components/QuickFilter.tsx`

### Features

#### 1. **Search Mode** (!)

Pattern-based filtering with advanced operators:

| Pattern | Description | Example |
|---------|-------------|---------|
| `john \| jane` | OR search (matches either) | Finds "john" OR "jane" |
| `col:val1\|val2` | Column-specific OR | `status:active\|pending` |
| `^starts` | Starts with anchor | `^john` matches "john smith" |
| `ends$` | Ends with anchor | `smith$` matches "john smith" |
| `/regex/i` | Regex with flags | `/joh?n/i` case-insensitive |
| `term1, term2` | AND search | Both must match |

**Use cases:**
- Data grid quick filtering
- Client-side result filtering
- Pattern matching in large datasets

#### 2. **WHERE Mode** (?)

SQL WHERE clause with full IDE support:

- ✅ **SQL Syntax Highlighting** (CodeMirror + PostgreSQL dialect)
- ✅ **Real-time Validation** (pg-parser via Web Worker)
- ✅ **Column Autocomplete** (shows data type)
- ✅ **Enum Value Suggestions** (for columns with enums)
- ✅ **Context-aware Help** (Cmd+. shows all columns)

**Example:**
```sql
age > 25 AND status = 'active'
name LIKE 'John%' OR email ILIKE '%@gmail.com'
created_at BETWEEN '2024-01-01' AND '2024-12-31'
```

**Features:**
- Detects syntax errors before submission
- Auto-completes column names as you type
- Shows enum values for columns with constrained values
- Prevents submission if SQL is invalid (lint errors)

#### 3. **AI Mode** (#)

Natural language → SQL WHERE clause conversion:

**Input:** `active users from last week`
**Output:** `status = 'active' AND created_at > NOW() - INTERVAL '7 days'`

**How it works:**
1. Uses configured AI provider (from Phase 3)
2. Inline model selector (dropdown in mode menu)
3. Sends natural language to AI sidecar
4. AI returns SQL WHERE clause
5. Auto-validates generated SQL

**Phase 3 Integration:**
- Uses `useAIChatStore` for provider/model selection
- Filters by configured providers only
- Shows enabled models in dropdown
- Supports OAuth providers (Claude Code, OpenCode)

### Props

```typescript
interface QuickFilterProps {
  columns: FilterColumnInfo[];          // Column metadata (name, dataType, enumValues)
  value: string;                         // Current filter value
  mode: FilterMode;                      // 'search' | 'where' | 'ai'
  onValueChange: (value: string) => void;
  onModeChange: (mode: FilterMode) => void;
  onSubmit: () => void;                  // Called on Enter or auto-submit
  isLoading?: boolean;                   // Shows spinner
  error?: string | null;                 // Error message below input
  explanation?: string | null;           // AI explanation (e.g., generated SQL)
  searchModeOnly?: boolean;              // Hide mode switcher (search only)
  clientSideFiltering?: boolean;         // AI generates patterns, not SQL
}

interface FilterColumnInfo {
  name: string;                          // Column name
  dataType: string;                      // SQL data type
  enumValues?: string[];                 // Optional enum values for autocomplete
}
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `?` | Switch to WHERE mode |
| `#` | Switch to AI mode |
| `!` | Switch to Search mode |
| `Cmd+.` | Show all columns autocomplete |
| `Enter` | Submit filter (or accept suggestion) |
| `Tab` | Accept autocomplete suggestion |
| `↑/↓` | Navigate suggestions |
| `Escape` | Clear filter or close suggestions |
| `Cmd+Backspace` | Clear and reset to search mode |

### Auto-Submit Behavior

QuickFilter auto-submits after **3 seconds of inactivity** if:
- ✅ Value is not empty
- ✅ Not currently loading
- ✅ Suggestions dropdown is closed
- ✅ No lint errors (WHERE mode only)
- ✅ Value changed since last submit

This provides instant filtering while typing without spamming the backend.

### Performance Optimizations

**Phase 2.3 Performance Improvements:**
1. **Memoized Components** - `EnumSuggestionItem`, `ColumnSuggestionItem`
2. **Stable Refs** - Keymap callbacks use refs to avoid recreation
3. **Limited Rendering** - Max 50 suggestions visible (rest lazy-loaded)
4. **Web Worker Linting** - SQL validation off-thread (non-blocking)
5. **Lightweight Dropdown** - Direct DOM positioning (no Portal overhead)

### Usage Examples

#### Basic Table Filtering

```tsx
import { QuickFilter } from "@/components/DataGrid/components/QuickFilter";

function TableToolbar({ tableColumns, onFilter }) {
  const [filterValue, setFilterValue] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("search");
  const [isFiltering, setIsFiltering] = useState(false);

  const handleSubmit = async () => {
    setIsFiltering(true);
    try {
      await onFilter(filterValue, filterMode);
    } finally {
      setIsFiltering(false);
    }
  };

  return (
    <QuickFilter
      columns={tableColumns}
      value={filterValue}
      mode={filterMode}
      onValueChange={setFilterValue}
      onModeChange={setFilterMode}
      onSubmit={handleSubmit}
      isLoading={isFiltering}
    />
  );
}
```

#### Query Result Filtering (Client-Side)

```tsx
function QueryResultsGrid({ columns, data }) {
  const [filter, setFilter] = useState("");
  const [filteredData, setFilteredData] = useState(data);

  const applyFilter = () => {
    // Client-side filtering logic
    const filtered = data.filter(row =>
      // Apply search pattern to row
    );
    setFilteredData(filtered);
  };

  return (
    <div>
      <QuickFilter
        columns={columns}
        value={filter}
        mode="search"
        onValueChange={setFilter}
        onSubmit={applyFilter}
        searchModeOnly={true}          // Only search mode
        clientSideFiltering={true}     // Frontend filtering
      />
      <DataGrid data={filteredData} />
    </div>
  );
}
```

#### MongoDB Collection Filtering

```tsx
function MongoCollectionBrowser({ fields, onFilter }) {
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<FilterMode>("ai");

  return (
    <QuickFilter
      columns={fields}
      value={filter}
      mode={mode}
      onValueChange={setFilter}
      onModeChange={setMode}
      onSubmit={() => onFilter(filter, mode)}
      explanation="AI will generate MongoDB query filter"
    />
  );
}
```

#### With Enum Autocomplete

```tsx
const columns: FilterColumnInfo[] = [
  {
    name: "status",
    dataType: "enum",
    enumValues: ["active", "pending", "inactive", "archived"],
  },
  {
    name: "priority",
    dataType: "enum",
    enumValues: ["low", "medium", "high", "critical"],
  },
  {
    name: "created_at",
    dataType: "timestamp",
  },
];

// When user types: status =
// → Shows autocomplete: 'active', 'pending', 'inactive', 'archived'
```

---

## AIAssistantSidebar Component

### Overview

`AIAssistantSidebar` is a full-featured AI chat interface with **Phase 3 context awareness**, tool call visualization, and conversation persistence.

**Location:** `src/components/AIAssistant/AIAssistantSidebar.tsx`

### Features

#### 1. **Context-Aware Suggestions** (Phase 3)

Fetches intelligent suggestions from AI sidecar based on workspace context:

**PostgreSQL (active table: "users"):**
- "Explain the structure of **users**"
- "Show me sample data from **users**"
- "What are the relationships for **users**?"
- "What indexes exist on **users**?"

**MongoDB (active collection: "customers"):**
- "Show me sample documents from **customers**"
- "What fields are common in **customers**?"
- "Suggest an aggregation pipeline for **customers**"

**Redis (active key: "session:abc123"):**
- "Explain the structure of **session:abc123**"
- "Show TTL and type info for **session:abc123**"
- "Find related keys to **session:abc123**"

**No Connection:**
- "How do I connect to a database?"
- "What databases are supported?"
- "Explain SQL query basics"

**How it works:**
1. Uses `useWorkspaceContext(connectionId)` to get active table/collection/key
2. Sends context to `/suggestions` endpoint
3. Sidecar runs `generateSuggestions(context)` with full workspace state
4. Returns 4 most relevant suggestions
5. Updates when user navigates (clicks different table)

#### 2. **Tool Call Visualization**

Shows when AI uses backend tools (Phase 3):

**Supported Tools:**
- `list_tables` - SQL table enumeration
- `count_documents` - MongoDB document counting
- `sample_documents` - MongoDB random sampling
- `scan_keys` - Redis key pattern scanning
- `key_info` - Redis key metadata (type, TTL)

**Display:**
```
┌─────────────────────────────────────┐
│ 🔧 List Tables                      │
│ Status: ✅ Success                   │
│ Input:                              │
│   connectionId: "abc-123"           │
│ Output:                             │
│   [users, orders, products]         │
│ Duration: 234ms                     │
└─────────────────────────────────────┘
```

**ToolCallCard Props:**
```typescript
interface ToolCallCardProps {
  toolName: string;           // Raw tool name (list_tables)
  friendlyName: string;       // Display name (List Tables)
  status: "pending" | "success" | "error";
  input: Record<string, any>; // Tool input args
  output?: string;            // Tool output
  error?: string;             // Error message if failed
}
```

#### 3. **Conversation Persistence**

**Storage:** IndexedDB via Dexie (`src/lib/db/conversations.ts`)

**Features:**
- ✅ Auto-saves messages to database
- ✅ Auto-generates conversation title from first message
- ✅ History sidebar with conversation list
- ✅ Per-connection conversation storage
- ✅ Survives app restarts

**Database Schema:**
```typescript
interface Conversation {
  id: string;                    // UUID
  connectionId: string | null;   // Which DB connection
  title: string;                 // Auto-generated or custom
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationMessage {
  id: string;                    // Message UUID
  conversationId: string;        // Parent conversation
  role: "user" | "assistant";
  content: string;               // Text content
  parts: MessagePart[];          // Full message parts (text, tool calls, etc.)
  createdAt: Date;
}
```

**Hooks:**
```typescript
// Conversation management
const { conversation, updateTitle } = useConversation({
  conversationId: string,
  connectionId: string | null,
  title: string,
});

// Message persistence
const { messages, addMessage } = useConversationMessages(conversationId);
```

#### 4. **Model Selection UI**

Inline model selector in input footer:

**Display:**
```
┌─────────────────────────────────────────┐
│ [Attachment] [🤖 gpt-4] [Send]          │
└─────────────────────────────────────────┘
        Click to open model picker
```

**Features:**
- ✅ Filters by configured providers (has API key)
- ✅ Shows enabled models only (from `useAIChatStore`)
- ✅ Groups by provider
- ✅ Shows checkmark for selected model
- ✅ Supports OAuth providers (Claude Code, OpenCode)

#### 5. **Connection Context Display**

Shows current workspace context:

**With Connection:**
```
Connected to mydb. Ask questions about your data or get help with queries.
```

**Without Connection:**
```
No active connection. Ask general questions about databases and SQL.
```

**Context Passed to AI:**
```typescript
interface WorkspaceContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  activeTable: string | null;         // From Phase 3
  activeCollection: string | null;    // From Phase 3
  activeKey: string | null;           // From Phase 3
  recentTables: string[];             // From Phase 3
  recentCollections: string[];        // From Phase 3
  recentKeys: string[];               // From Phase 3
  activeQuery: string | null;
  lastAction: "browse" | "query" | "filter" | null;
}
```

### Props

```typescript
// No props - fully self-contained
// Uses stores and hooks for state management
```

### State Management

**Stores:**
- `usePreferencesStore` - Settings panel
- `useAIChatStore` - Provider/model selection, enabled models
- `db.conversations` - IndexedDB persistence

**Hooks:**
- `useAIChat` - Chat streaming (Vercel AI SDK)
- `useWorkspaceContext` - Phase 3 context extraction
- `useConversation` - Conversation persistence
- `useConversationMessages` - Message persistence

### Component Structure

```
AIAssistantSidebar
├── Header
│   ├── Title ("AI Assistant")
│   ├── New Conversation Button
│   ├── History Toggle Button
│   └── Settings Button
├── ResizablePanelGroup
│   ├── ConversationList (optional sidebar)
│   └── Chat Panel
│       ├── Conversation (message list)
│       │   ├── Empty State
│       │   └── Messages
│       │       ├── User Messages
│       │       └── Assistant Messages
│       │           ├── Text Parts
│       │           ├── Reasoning Parts
│       │           └── Tool Call Parts (ToolCallCard)
│       ├── Suggestions (when empty)
│       └── PromptInput
│           ├── Attachments
│           ├── Textarea
│           └── Footer
│               ├── Attachment Button
│               ├── Model Selector
│               └── Submit Button
```

### Usage Examples

#### Basic Integration

```tsx
import { AIAssistantSidebar } from "@/components/AIAssistant/AIAssistantSidebar";

function WorkspaceLayout() {
  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={70}>
        <QueryPanel />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={30} minSize={25}>
        <AIAssistantSidebar />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

#### Tabbed Layout

```tsx
function WorkspaceTabs() {
  return (
    <Tabs defaultValue="query">
      <TabsList>
        <TabsTrigger value="query">Query</TabsTrigger>
        <TabsTrigger value="ai">AI Assistant</TabsTrigger>
      </TabsList>

      <TabsContent value="query">
        <QueryPanel />
      </TabsContent>

      <TabsContent value="ai" className="h-full">
        <AIAssistantSidebar />
      </TabsContent>
    </Tabs>
  );
}
```

#### Contextual Help Modal

```tsx
function DataBrowser() {
  const [showAI, setShowAI] = useState(false);

  return (
    <>
      <Button onClick={() => setShowAI(true)}>
        Ask AI for Help
      </Button>

      <Sheet open={showAI} onOpenChange={setShowAI}>
        <SheetContent className="w-[600px] p-0">
          <AIAssistantSidebar />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

#### Error Recovery Assistant

```tsx
function QueryPanelWithAI() {
  const [queryError, setQueryError] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(false);

  const handleQueryError = (error: string) => {
    setQueryError(error);
    setShowAI(true);
    // AI will see error in context and suggest fixes
  };

  return (
    <div className="flex h-full">
      <QueryPanel onError={handleQueryError} />

      {showAI && (
        <div className="w-[400px] border-l">
          <AIAssistantSidebar />
        </div>
      )}
    </div>
  );
}
```

---

## Phase 3 Integration

Both components leverage Phase 3 AI architecture improvements.

### QuickFilter Phase 3 Features

#### 1. **AI Provider Selection**

```typescript
// Uses Phase 3 provider system
import { useAIChatStore } from "@/stores/aiChatStore";

const {
  selectedProvider,
  selectedModel,
  availableProviders,
  configuredProviders,
  setProvider,
  setModel,
  getProviderEnabledModels,
} = useAIChatStore();
```

**In UI (AI Mode):**
- Mode dropdown shows nested model selector
- Filters by configured providers (has API key or OAuth)
- Shows only enabled models (checkboxes in Preferences)
- Supports OAuth providers (Claude Code, OpenCode)

#### 2. **Model Selector Dropdown** (line 1160-1228)

When user switches to AI mode (#):
1. Dropdown shows "AI Model" section
2. Lists configured providers
3. Shows enabled models per provider
4. Click to select provider + model
5. Selection persisted via `useAIChatStore`

**Example:**
```
┌─────────────────────────────┐
│ Search Mode                 │
│ WHERE Mode                  │
│ AI Assistant         ✓      │  ← Selected
├─────────────────────────────┤
│ AI Model                    │
│  openai                     │
│    GPT-5               ✓    │
│    GPT-5 Mini               │
│  anthropic                  │
│    Claude Sonnet 4.5        │
│  claude-code (OAuth)        │  ← From Phase 3!
│    Claude Code Latest       │
└─────────────────────────────┘
```

### AIAssistantSidebar Phase 3 Features

#### 1. **Context-Aware Suggestions** (line 332-378)

```typescript
const workspaceContext = useWorkspaceContext(connectionId);

useEffect(() => {
  const fetchSuggestions = async () => {
    const response = await fetch(`${AI_SIDECAR_URL}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: workspaceContext }),
    });

    const data = await response.json();
    setSuggestions(data.suggestions || []);
  };

  void fetchSuggestions();
}, [connectionId, workspaceContext]);
```

**What gets sent:**
```json
{
  "context": {
    "connectionId": "abc-123",
    "database": "mydb",
    "schema": "public",
    "activeTable": "users",        // ← From Phase 3
    "activeCollection": null,
    "activeKey": null,
    "recentTables": ["users", "orders"],  // ← From Phase 3
    "recentCollections": [],
    "recentKeys": [],
    "activeQuery": null,
    "lastAction": "browse"
  }
}
```

**What comes back:**
```json
{
  "suggestions": [
    "Explain the structure of users",
    "Show me sample data from users",
    "What are the relationships for users?",
    "What indexes exist on users?"
  ]
}
```

#### 2. **Tool Call Rendering** (line 580-595)

When AI uses tools (Phase 3):
```typescript
// Message parts include tool invocations
{
  type: "tool-list_tables",
  state: "output-available",
  input: { connectionId: "abc-123" },
  output: ["users", "orders", "products"],
}

// Rendered as ToolCallCard
<ToolCallCard
  toolName="list_tables"
  friendlyName="List Tables"
  status="success"
  input={{ connectionId: "abc-123" }}
  output={["users", "orders", "products"]}
/>
```

#### 3. **OAuth Provider Support**

After enabling OAuth (from earlier):
```typescript
// Model selector shows OAuth providers
availableProviders
  .filter((provider) =>
    configuredProviders.includes(provider.name)  // ← Includes OAuth
  )
  .map((provider) => {
    // Shows: openai, anthropic, claude-code, opencode, etc.
  })
```

**Display:**
```
Model Selector
├── openai (API Key)
│   ├── GPT-5
│   └── GPT-5 Mini
├── anthropic (API Key)
│   └── Claude Sonnet 4.5
├── claude-code (OAuth)     ← From Phase 3!
│   └── Claude Code Latest
└── opencode (OAuth)        ← From Phase 3!
    └── OpenCode Latest
```

---

## Usage Patterns

### Pattern 1: Enhanced Data Grid

Combine QuickFilter + AIAssistantSidebar for power-user experience:

```tsx
function EnhancedDataBrowser({ tableColumns, data, connectionId }) {
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<FilterMode>("search");
  const [filteredData, setFilteredData] = useState(data);

  const applyFilter = (value: string, filterMode: FilterMode) => {
    // Filter logic based on mode
    setFilteredData(/* filtered data */);
  };

  return (
    <ResizablePanelGroup direction="horizontal">
      {/* Main data grid with QuickFilter */}
      <ResizablePanel defaultSize={70}>
        <div className="flex flex-col h-full">
          <div className="p-2 border-b">
            <QuickFilter
              columns={tableColumns}
              value={filter}
              mode={mode}
              onValueChange={setFilter}
              onModeChange={setMode}
              onSubmit={() => applyFilter(filter, mode)}
            />
          </div>
          <DataGrid data={filteredData} columns={tableColumns} />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* AI Assistant sidebar */}
      <ResizablePanel defaultSize={30} minSize={25}>
        <AIAssistantSidebar />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

**User Workflow:**
1. User types `#active users from last week` in QuickFilter
2. AI generates: `status = 'active' AND created_at > NOW() - INTERVAL '7 days'`
3. Grid filters to 5 rows
4. User asks in AI sidebar: "Why are there only 5 results?"
5. AI uses `execute_query` tool with context (knows filter + table)
6. AI explains: "The strict date filter excludes most records. Try 2 weeks."
7. User adjusts filter: `#active users from last two weeks`
8. Grid now shows 47 rows

### Pattern 2: MongoDB Collection Explorer

```tsx
function MongoCollectionExplorer({ collection, connectionId }) {
  const [filter, setFilter] = useState("");
  const [documents, setDocuments] = useState([]);

  return (
    <div className="flex flex-col h-full">
      {/* Collection toolbar */}
      <div className="p-2 border-b flex gap-2">
        <QuickFilter
          columns={[]} // MongoDB doesn't have fixed schema
          value={filter}
          mode="ai"
          onValueChange={setFilter}
          onSubmit={() => filterDocuments(filter)}
          explanation="AI will generate MongoDB query filter"
        />
        <Button onClick={() => /* ... */}>Aggregate</Button>
      </div>

      {/* Split: Document list + AI assistant */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={65}>
          <DocumentList documents={documents} />
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={35}>
          <AIAssistantSidebar />
          {/* AI knows:
              - activeCollection: "customers"
              - recentCollections: ["customers", "orders"]
              - Suggests MongoDB-specific operations
          */}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
```

### Pattern 3: Query Builder Assistant

```tsx
function QueryBuilder({ connectionId, tableName }) {
  const [sql, setSql] = useState("");
  const [showAI, setShowAI] = useState(false);

  return (
    <div className="flex h-full">
      {/* Query editor */}
      <div className="flex-1">
        <CodeEditor value={sql} onChange={setSql} />
        <Button onClick={executeQuery}>Run Query</Button>
      </div>

      {/* AI help panel (togglable) */}
      {showAI && (
        <div className="w-[400px] border-l">
          <AIAssistantSidebar />
          {/* AI knows user is in query mode:
              - lastAction: "query"
              - activeQuery: "SELECT * FROM users WHERE..."
              - Can suggest query improvements
          */}
        </div>
      )}

      <Button
        className="absolute top-2 right-2"
        onClick={() => setShowAI(!showAI)}
      >
        {showAI ? "Hide AI" : "Ask AI"}
      </Button>
    </div>
  );
}
```

### Pattern 4: Contextual Error Recovery

```tsx
function SmartQueryPanel({ connectionId }) {
  const [error, setError] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(false);

  const handleQueryError = (err: Error) => {
    setError(err.message);
    setShowAI(true); // Auto-open AI on error
  };

  return (
    <Sheet open={showAI} onOpenChange={setShowAI}>
      <SheetContent className="w-[600px]">
        {/* AI Assistant with error context */}
        <div className="mb-4 p-3 bg-destructive/10 rounded">
          <p className="text-sm text-destructive">{error}</p>
        </div>
        <AIAssistantSidebar />
        {/* User can ask: "What's wrong with this query?"
            AI sees error in conversation, suggests fix
        */}
      </SheetContent>
    </Sheet>
  );
}
```

---

## Examples

### Example 1: Table Browser with AI Filter

```tsx
import { QuickFilter, FilterMode } from "@/components/DataGrid/components/QuickFilter";
import { AIAssistantSidebar } from "@/components/AIAssistant/AIAssistantSidebar";

function TableBrowser() {
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<FilterMode>("search");
  const { data, columns } = useTableData();

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={70}>
        <div className="flex flex-col h-full">
          <QuickFilter
            columns={columns.map(c => ({
              name: c.name,
              dataType: c.type,
              enumValues: c.enumValues,
            }))}
            value={filter}
            mode={mode}
            onValueChange={setFilter}
            onModeChange={setMode}
            onSubmit={() => applyFilter(filter)}
          />
          <DataGrid data={data} />
        </div>
      </ResizablePanel>

      <ResizablePanel defaultSize={30}>
        <AIAssistantSidebar />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

### Example 2: Query Results with Client-Side Filter

```tsx
function QueryResults({ results }) {
  const [filter, setFilter] = useState("");
  const [filtered, setFiltered] = useState(results);

  const applyClientFilter = () => {
    // Client-side filtering
    const filtered = results.filter(row =>
      Object.values(row).some(val =>
        String(val).toLowerCase().includes(filter.toLowerCase())
      )
    );
    setFiltered(filtered);
  };

  return (
    <div>
      <QuickFilter
        columns={Object.keys(results[0] || {}).map(key => ({
          name: key,
          dataType: "text",
        }))}
        value={filter}
        mode="search"
        onValueChange={setFilter}
        onSubmit={applyClientFilter}
        searchModeOnly={true}
        clientSideFiltering={true}
      />
      <ResultsGrid data={filtered} />
    </div>
  );
}
```

### Example 3: MongoDB Collection Browser

```tsx
function MongoCollectionBrowser({ collection, fields }) {
  const [filter, setFilter] = useState("");

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={65}>
        <QuickFilter
          columns={fields}
          value={filter}
          mode="ai"
          onValueChange={setFilter}
          onSubmit={() => filterCollection(filter)}
        />
        <DocumentList />
      </ResizablePanel>

      <ResizablePanel defaultSize={35}>
        <AIAssistantSidebar />
        {/* Context-aware suggestions for MongoDB:
            - "Show sample documents from {collection}"
            - "Explain the schema of {collection}"
            - "Suggest aggregation pipeline"
        */}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

---

## Testing Phase 3 Integration

### QuickFilter AI Mode

1. **Switch to AI mode:**
   - Type `#` or click mode selector → AI Assistant
   - Model selector dropdown appears

2. **Select OAuth provider:**
   - Should see "claude-code (OAuth)" or "opencode (OAuth)"
   - Select model

3. **Test natural language:**
   - Input: `active users created last week`
   - Should generate: `status = 'active' AND created_at > NOW() - INTERVAL '7 days'`

### AIAssistantSidebar Context Awareness

1. **Test active table detection:**
   - Click on "users" table in table browser
   - Open AI Assistant
   - **Check suggestions** - should mention "users"
   - Example: "Explain the structure of **users**"

2. **Test context in requests:**
   - Open DevTools > Network
   - Send AI message
   - Find `/suggestions` request
   - Inspect body:
     ```json
     {
       "context": {
         "activeTable": "users",
         "recentTables": ["users", "orders"]
       }
     }
     ```

3. **Test tool visualization:**
   - Ask: "What tables are available?"
   - AI should use `list_tables` tool
   - Tool call should render with:
     - ✅ Tool name
     - ✅ Input args
     - ✅ Output
     - ✅ Success status

4. **Test conversation persistence:**
   - Send several messages
   - Refresh app
   - Click "Show History" (clock icon)
   - Should see conversation in list
   - Title auto-generated from first message

---

## Troubleshooting

### QuickFilter Issues

**Problem:** AI mode not showing model selector
**Fix:** Check `useAIChatStore` - ensure providers loaded, at least one configured

**Problem:** WHERE mode not showing lint errors
**Fix:** Check Web Worker availability - pg-parser needs worker pool

**Problem:** Autocomplete not showing
**Fix:** Ensure `columns` prop includes correct `dataType` and `enumValues`

### AIAssistantSidebar Issues

**Problem:** Suggestions not context-aware
**Fix:**
1. Verify `useWorkspaceContext` returns real values (not null)
2. Check `/suggestions` endpoint returns 200
3. Inspect request body for `activeTable`

**Problem:** Tool calls not rendering
**Fix:** Check message parts include `type: "tool-{toolName}"` and proper state

**Problem:** Conversations not persisting
**Fix:**
1. Check IndexedDB in DevTools > Application
2. Look for `conversations` and `messages` tables
3. Verify `db.conversations.add()` succeeds

**Problem:** OAuth providers not showing
**Fix:**
1. Restart app after enabling OAuth (Phase 3)
2. Check `configuredProviders` includes oauth provider names
3. Verify sidecar rebuilt with `make build-ai`

---

## Next Steps

### Immediate Actions

1. **Wire up QuickFilter** to table browsers
2. **Test context awareness** in AIAssistantSidebar
3. **Enable OAuth providers** (already done in Phase 3)

### Future Enhancements

1. **QuickFilter:**
   - History of recent filters
   - Save favorite filters
   - Export/import filter presets

2. **AIAssistantSidebar:**
   - Conversation export (Markdown, JSON)
   - Conversation search
   - Pin important conversations
   - Multi-turn tool execution

3. **Combined:**
   - Click AI suggestion → auto-fill QuickFilter
   - Share filter from QuickFilter → AI chat
   - Voice input for AI mode

---

## References

- **Phase 3 Implementation:** `docs/phase3-implementation-summary.md`
- **UI Integration Guide:** `docs/UI_INTEGRATION_COMPLETE.md`
- **Quick Start:** `docs/QUICK_START_UI_INTEGRATION.md`
- **OAuth Integration:** `src-tauri/sidecar-ai/docs/OAUTH_INTEGRATION.md`
- **Testing Guide:** `docs/TESTING_PHASE3.md`

---

**Document Version:** 1.0
**Phase 3 Status:** ✅ Complete
**Components Status:** ✅ Production Ready
