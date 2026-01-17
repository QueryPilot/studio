/**
 * Smart Context-Aware Suggestion Generator
 *
 * Generates intelligent suggestions based on workspace context.
 */

import type { WorkspaceContext } from "../types";

export function generateSuggestions(context: WorkspaceContext): string[] {
  // SQL Context - Active Table
  if (context.activeTable) {
    return [
      `Explain the structure of ${context.activeTable}`,
      `Show me sample data from ${context.activeTable}`,
      `What are the relationships for ${context.activeTable}?`,
      `What indexes exist on ${context.activeTable}?`,
    ];
  }

  // Document Context - Active Collection
  if (context.activeCollection) {
    return [
      `Show me sample documents from ${context.activeCollection}`,
      `What fields are common in ${context.activeCollection}?`,
      `Suggest an aggregation pipeline for ${context.activeCollection}`,
      `What's the schema of ${context.activeCollection}?`,
    ];
  }

  // Key-Value Context - Active Key
  if (context.activeKey) {
    return [
      `Explain the structure of ${context.activeKey}`,
      `Show TTL and type info for ${context.activeKey}`,
      `Find related keys to ${context.activeKey}`,
      `What's the size of ${context.activeKey}?`,
    ];
  }

  // SQL Context - Multiple Recent Tables (Relationships)
  if (context.recentTables && context.recentTables.length >= 2) {
    const [table1, table2] = context.recentTables;
    return [
      `How are ${table1} and ${table2} related?`,
      `Show me a query joining ${table1} and ${table2}`,
      `Compare the structures of ${table1} and ${table2}`,
      `List all tables in the schema`,
    ];
  }

  // SQL Context - Single Recent Table
  if (context.recentTables && context.recentTables.length === 1) {
    const table = context.recentTables[0];
    return [
      `Explain the structure of ${table}`,
      `Show relationships for ${table}`,
      `What are the indexes on ${table}?`,
      `Show me sample data from ${table}`,
    ];
  }

  // Document Context - Multiple Recent Collections
  if (context.recentCollections && context.recentCollections.length >= 2) {
    const [col1, col2] = context.recentCollections;
    return [
      `Compare schemas of ${col1} and ${col2}`,
      `Show me documents from both ${col1} and ${col2}`,
      `List all collections in the database`,
      `What's the difference between ${col1} and ${col2}?`,
    ];
  }

  // General Context - Has Connection
  if (context.connectionId) {
    if (context.database) {
      return [
        "What tables exist in this database?",
        "Show me the database schema",
        "Explain the database structure",
        "List all tables and their row counts",
      ];
    }
    return [
      "What databases are available?",
      "Show me the connection info",
      "What's in this database?",
      "Help me explore the database",
    ];
  }

  // Fallback - No Connection
  return [
    "How do I connect to a database?",
    "What databases are supported?",
    "Explain SQL query basics",
    "How do I create a new connection?",
  ];
}
