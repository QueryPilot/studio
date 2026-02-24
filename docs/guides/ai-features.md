# AI Features Guide

Query Pilot integrates with AI coding agents via the **Agent Client Protocol (ACP)** to provide intelligent assistance for database work. This guide covers how to set up and use AI features.

## Overview

Query Pilot's AI features include:

- **Explain Query**: Get AI explanations for complex SQL queries
- **Generate SQL**: Create SQL from natural language descriptions
- **AI Filters**: Use natural language to filter data in the DataGrid
- **AI Panel**: Interactive chat with database context awareness

---

## Part 1: Installing AI Agents

Query Pilot automatically detects ACP-compatible AI agents installed on your system. You need at least one agent installed to use AI features.

### Supported Agents

| Agent | Binary Name | Notes |
|-------|-------------|-------|
| Claude Code (ACP adapter) | `claude-code-acp` | Recommended for best results |
| Gemini CLI | `gemini` | Uses `--experimental-acp` flag |
| OpenCode | `opencode` | Uses `acp` subcommand |
| Codex (ACP adapter) | `codex-acp` | OpenAI Codex via ACP |
| Goose | `goose` | Uses `--acp` flag |

### Claude Code Setup

Claude Code is the recommended agent for Query Pilot.

**Prerequisites:**
- An Anthropic API key or Claude Pro/Team subscription
- Node.js v18 or later

**Installation:**

1. Install Claude Code globally:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Install the ACP adapter:
   ```bash
   npm install -g claude-code-acp
   ```

3. Configure authentication:
   ```bash
   claude auth
   ```
   Follow the prompts to authenticate with your Anthropic account.

4. Verify installation:
   ```bash
   claude-code-acp --version
   ```

### Gemini CLI Setup

**Prerequisites:**
- A Google Cloud account with Vertex AI API enabled
- Node.js v18 or later

**Installation:**

1. Install Gemini CLI:
   ```bash
   npm install -g @google/gemini-cli
   ```

2. Authenticate with Google Cloud:
   ```bash
   gcloud auth application-default login
   ```

3. Verify installation:
   ```bash
   gemini --version
   ```

> **Note**: Gemini CLI requires the `--experimental-acp` flag for ACP mode. Query Pilot handles this automatically.

### OpenCode Setup

**Prerequisites:**
- An OpenAI API key

**Installation:**

1. Install OpenCode:
   ```bash
   npm install -g opencode
   ```

2. Configure your API key:
   ```bash
   export OPENAI_API_KEY="your-api-key"
   ```

3. Verify installation:
   ```bash
   opencode --version
   ```

### Goose Setup

**Prerequisites:**
- Python 3.9 or later

**Installation:**

1. Install Goose:
   ```bash
   pip install goose-ai
   ```

2. Configure your preferred AI provider in Goose's config file.

3. Verify installation:
   ```bash
   goose --version
   ```

### Verifying Agent Detection

To check if Query Pilot detects your installed agents:

1. Open Query Pilot
2. Open the AI Panel (see "Using the AI Panel" below)
3. Look at the agent selector dropdown in the panel header

If agents are detected, you'll see them listed in the dropdown. If no agents are found, you'll see a "No AI agents found" message with a link to installation instructions.

**Troubleshooting Detection:**

- Ensure the agent binary is in your system PATH
- Restart Query Pilot after installing a new agent
- Check that the agent runs successfully from your terminal

---

## Part 2: Using AI Features

### The AI Panel

The AI Panel is the main interface for interacting with AI agents.

**Opening the Panel:**

- Use the command palette: `Cmd/Ctrl + Shift + P` and search for "Toggle AI Assistant"
- Or use the keyboard shortcut (if configured in your keybindings)

**Panel Features:**

- **Agent Selector**: Choose which installed agent to use (top-right dropdown)
- **Message History**: View your conversation with the AI
- **Thinking Blocks**: See the AI's reasoning process (collapsible)
- **Cancel Button**: Stop generation mid-response

**Conversation Tips:**

- The AI has access to your current database schema context
- Ask specific questions about tables, columns, or relationships
- Request SQL queries for specific tasks
- Ask for explanations of complex queries

### Explain Query

Get AI explanations for SQL queries you're working on.

**How to Use:**

1. Open a SQL editor with a query
2. Select the SQL you want explained (or leave empty to use the entire query)
3. Run the "AI: Explain Query" command from the command palette

The AI Panel will open and provide:
- A breakdown of what the query does
- Explanation of each clause (SELECT, WHERE, JOIN, etc.)
- Potential performance considerations
- Suggestions for improvements (if applicable)

**Example Prompt (generated automatically):**

```
Explain this SQL query:

SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5
ORDER BY order_count DESC;
```

### Generate SQL

Create SQL queries from natural language descriptions.

**How to Use:**

1. Open the AI Panel
2. Describe what you want to query in plain language
3. The AI will generate the appropriate SQL

**Example Prompts:**

```
Find all users who signed up last month and haven't made any orders
```

```
Get the top 10 products by revenue with their category names
```

```
Count active subscriptions by plan type for each month in 2024
```

**Tips for Better Results:**

- Be specific about table and column names if you know them
- Mention the database type if syntax matters (PostgreSQL, MySQL, etc.)
- Include any specific conditions or sorting requirements
- Ask for explanations along with the query if needed

### AI Filters in DataGrid

Use natural language to create complex filters in the DataGrid.

**How to Use:**

1. Open any table in the DataGrid view
2. Click on the filter input (or use the `#` prefix in the quick filter)
3. Type your filter in natural language

**Example AI Filters:**

| You Type | AI Generates |
|----------|--------------|
| `# users over 30 in california` | `?age > 30 AND state = 'CA'` |
| `# orders from last week` | `?created_at >= '2024-01-22'` |
| `# active premium accounts` | `?status = 'active' AND plan = 'premium'` |

> **Note**: The `#` prefix triggers AI filter mode. Without it, the filter uses standard search or query modes (see [Data Grid Filtering](../features/data-grid-filtering.md)).

**How AI Filters Work:**

1. Your natural language description is sent to the AI
2. The AI analyzes your table schema (columns and types)
3. It generates the appropriate WHERE clause
4. The filter is applied to your data

---

## Part 3: Troubleshooting

### "No agents found"

If you see "No AI agents found" in the AI Panel:

1. **Verify agent installation**: Run the agent's `--version` command in your terminal
   ```bash
   claude-code-acp --version
   gemini --version
   opencode --version
   goose --version
   ```

2. **Check your PATH**: Ensure the agent binary location is in your system PATH
   ```bash
   which claude-code-acp
   # Should return the path to the binary
   ```

3. **Restart Query Pilot**: Close and reopen the application after installing agents

4. **Check permissions**: Ensure the binary is executable
   ```bash
   chmod +x $(which claude-code-acp)
   ```

### Connection Issues

If the AI panel shows errors when sending messages:

1. **Check agent authentication**: Most agents require API keys or authentication
   - Claude Code: Run `claude auth` to authenticate
   - Gemini: Ensure `gcloud auth application-default login` is configured
   - OpenCode: Verify `OPENAI_API_KEY` environment variable is set

2. **Check network connectivity**: AI agents need internet access to communicate with their respective AI providers

3. **Review agent logs**: Check the terminal output if running Query Pilot from the command line

4. **Try a different agent**: If one agent fails, try switching to another in the agent selector

### Slow Responses

If AI responses are taking too long:

1. **Check your internet connection**: Slow network can cause delays

2. **Consider query complexity**: Very complex database schemas take longer to process

3. **Use the cancel button**: If a response is taking too long, cancel and try rephrasing

4. **Reduce context size**: AI performance can slow with very large schemas. Consider:
   - Working with a specific schema rather than the entire database
   - Breaking complex requests into smaller questions

### Response Quality Issues

If AI responses are inaccurate or unhelpful:

1. **Be more specific**: Include table names, column names, and exact requirements

2. **Provide context**: Mention your database type (PostgreSQL, MySQL, etc.)

3. **Try rephrasing**: Different phrasings can yield better results

4. **Use follow-up questions**: Ask the AI to clarify or improve its response

5. **Switch agents**: Different AI agents have different strengths

---

## Best Practices

### Security Considerations

- **Schema only**: Query Pilot shares only database schema information (table/column names and types) with AI agents, never actual data
- **Local processing**: AI agents run as local subprocesses on your machine
- **API keys**: Keep your AI provider API keys secure; Query Pilot stores them in your OS keychain

### Optimizing AI Usage

1. **Start with context**: When working with a new database, ask the AI to summarize the schema first

2. **Iterate**: Build complex queries step by step, asking the AI to improve or extend

3. **Learn from responses**: AI explanations help you understand SQL better over time

4. **Combine with manual editing**: Use AI-generated SQL as a starting point, then refine manually

### When to Use AI vs. Manual Approaches

**Use AI for:**
- Understanding unfamiliar queries
- Generating boilerplate SQL
- Creating complex filters
- Learning new SQL patterns

**Use manual approaches for:**
- Performance-critical queries that need optimization
- Queries requiring exact syntax for your specific database version
- Sensitive operations where you need full control

---

## Related Documentation

- [Data Grid Filtering](../features/data-grid-filtering.md) - Complete guide to filtering modes
- [Developer Setup](setup.md) - Setting up the development environment
- [Architecture Overview](../llm-context/architecture-overview.md) - Technical architecture details
