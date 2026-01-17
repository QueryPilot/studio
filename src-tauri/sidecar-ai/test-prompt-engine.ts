/**
 * Quick test for PromptEngine
 */

import { getPromptEngine } from "./prompts/engine";

async function test() {
  console.log("Loading PromptEngine...");
  const engine = await getPromptEngine();

  console.log("\nAvailable templates:", engine.getTemplateNames());
  console.log("Available partials:", engine.getPartialNames());

  // Test rendering with SQL connection
  console.log("\n=== Test 1: With SQL Connection ===");
  const withSqlConnection = engine.render("system", {
    connection: {
      connectionId: "test-conn-123",
      database: "testdb",
      schema: "public",
      paradigm: "sql",
    },
    tools: [
      {
        name: "list_tables",
        friendlyName: "List Tables",
        description: "List all tables in a schema",
        category: "discovery",
        capabilities: ["sql"],
      },
    ],
    maxToolSteps: 25,
  });
  console.log(withSqlConnection.substring(0, 600) + "...");

  // Test rendering with Document connection
  console.log("\n=== Test 1b: With Document Connection ===");
  const withDocConnection = engine.render("system", {
    connection: {
      connectionId: "test-conn-456",
      database: "mongodb",
      schema: "n/a",
      paradigm: "document",
    },
    tools: [
      {
        name: "list_collections",
        friendlyName: "List Collections",
        description: "List all collections",
        category: "discovery",
        capabilities: ["document"],
      },
    ],
    maxToolSteps: 25,
  });
  // Look for "Document Database Paradigm" in output
  const hasDocContext = withDocConnection.includes("Document Database Paradigm");
  console.log(`Contains Document context: ${hasDocContext ? "✓" : "✗"}`);
  if (hasDocContext) {
    const idx = withDocConnection.indexOf("Document Database Paradigm");
    console.log(withDocConnection.substring(idx, idx + 300) + "...");
  }

  // Test rendering without connection
  console.log("\n=== Test 2: Without Connection ===");
  const withoutConnection = engine.render("system", {
    tools: [],
    maxToolSteps: 25,
  });
  console.log(withoutConnection.substring(0, 300) + "...");

  console.log("\n✅ PromptEngine test complete!");
}

test().catch(console.error);
