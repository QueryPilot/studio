// src/ai/constants.ts

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_TOOL_STEPS = 5;

export function buildSystemPrompt(context?: {
  databaseType?: string;
  schema?: string;
}): string {
  const parts = [
    "You are a database assistant in Query Pilot, a desktop database IDE.",
    "You help users write SQL queries, explain database concepts, and analyze data.",
    "When generating SQL, output it in a ```sql code block.",
    "Be concise. Prefer showing SQL over explaining it.",
  ];

  if (context?.databaseType) {
    parts.push(`The user is connected to a ${context.databaseType} database.`);
  }

  if (context?.schema) {
    parts.push("Here is the relevant database schema:");
    parts.push(context.schema);
  }

  parts.push(
    "You have access to tools for querying the database, listing tables, and describing table structure.",
    "Use these tools when the user asks about their data or schema.",
    "After running a query with the queryDatabase tool, summarize the results clearly.",
  );

  return parts.join("\n\n");
}
