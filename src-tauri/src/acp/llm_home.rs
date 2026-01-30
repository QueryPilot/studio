//! LLM Home Directory Management
//!
//! Manages the `~/.querypilot/llm/` directory where AI agents run.
//! Handles template file installation and version tracking.

use std::fs;
use std::path::PathBuf;

/// Current version of the LLM templates
const TEMPLATE_VERSION: &str = "1.0.0";

/// Get the LLM home directory path (~/.querypilot/llm/)
pub fn get_llm_home() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".querypilot").join("llm"))
}

/// Initialize the LLM home directory with template files
pub fn initialize_llm_home() -> Result<PathBuf, String> {
    let llm_home = get_llm_home()?;

    // Create directory structure
    fs::create_dir_all(&llm_home).map_err(|e| format!("Failed to create LLM home: {}", e))?;
    fs::create_dir_all(llm_home.join("skills"))
        .map_err(|e| format!("Failed to create skills dir: {}", e))?;
    fs::create_dir_all(llm_home.join("memory"))
        .map_err(|e| format!("Failed to create memory dir: {}", e))?;

    // Check if we need to update templates
    let version_file = llm_home.join(".template-version");
    let current_version = fs::read_to_string(&version_file).unwrap_or_default();

    if current_version.trim() != TEMPLATE_VERSION {
        tracing::info!(
            "Updating LLM templates from {} to {}",
            current_version.trim(),
            TEMPLATE_VERSION
        );
        install_templates(&llm_home)?;

        // Write new version
        fs::write(&version_file, TEMPLATE_VERSION)
            .map_err(|e| format!("Failed to write version file: {}", e))?;
    }

    Ok(llm_home)
}

/// Install template files to the LLM home directory
fn install_templates(llm_home: &PathBuf) -> Result<(), String> {
    // CLAUDE.md template
    let claude_md = r#"# Query Pilot - Claude Code Agent Instructions

You are an AI assistant integrated into Query Pilot, a database IDE application.

## Your Role

You help users with:
- Writing and optimizing SQL queries
- Understanding database schemas
- Explaining query results and errors
- Suggesting database design improvements
- Answering questions about databases (PostgreSQL, MySQL, SQLite, MongoDB, Redis, MSSQL)

## Important Restrictions

**You are running in a sandboxed environment within Query Pilot.**

- **DO NOT** attempt to access files outside this directory
- **DO NOT** execute commands that could harm the user's system
- **DO NOT** make network requests to external services
- **DO NOT** attempt to install packages or modify system configuration

## Context

When the user asks questions, you may receive database context including:
- Connection information (database type, name)
- Schema information (tables, columns, types)
- Current query being edited

Use this context to provide relevant, database-specific answers.

## Response Guidelines

1. Be concise and focused on the database task at hand
2. Provide SQL examples when helpful
3. Explain your reasoning for query optimizations
4. Warn about potential performance issues or security concerns (SQL injection, etc.)
5. Format SQL code properly with syntax highlighting

## Skills

Check the `skills/` directory for any additional capabilities or memory from previous sessions.
"#;

    // AGENT.md template (generic for all agents)
    let agent_md = r#"# Query Pilot - AI Agent Guidelines

## Environment

You are running as an AI assistant within **Query Pilot**, a local-first database IDE.

**Working Directory:** This sandboxed directory (`~/.querypilot/llm/`)

## Capabilities

You can assist with:
- SQL query writing and optimization
- Database schema analysis
- Query debugging and error explanation
- Database design recommendations
- Data modeling advice

## Supported Databases

- PostgreSQL
- MySQL / MariaDB
- SQLite
- Microsoft SQL Server
- MongoDB (document queries)
- Redis (commands)

## Response Format

- Use markdown for formatting
- Use code blocks with language hints for SQL: ```sql
- Keep responses focused and actionable
- Provide examples when helpful

## Memory & Skills

- `skills/` - Reusable capabilities and patterns
- `memory/` - Persistent context from previous sessions

## Safety

This is a sandboxed environment. Do not attempt to:
- Access files outside this directory
- Execute system commands
- Make external network requests
- Modify system configuration
"#;

    // Write template files
    fs::write(llm_home.join("CLAUDE.md"), claude_md)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;

    fs::write(llm_home.join("AGENT.md"), agent_md)
        .map_err(|e| format!("Failed to write AGENT.md: {}", e))?;

    // Create a .gitignore to prevent accidental commits
    let gitignore = r#"# Query Pilot LLM workspace
memory/
*.log
"#;
    fs::write(llm_home.join(".gitignore"), gitignore)
        .map_err(|e| format!("Failed to write .gitignore: {}", e))?;

    tracing::info!("LLM templates installed successfully");
    Ok(())
}
