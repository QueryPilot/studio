import {
  snippetCompletion,
  type Completion,
  type CompletionSource,
  type CompletionContext,
} from "@codemirror/autocomplete";

export const sqlSnippets: Completion[] = [
  snippetCompletion("SELECT ${columns} FROM ${table}", {
    label: "select",
    type: "keyword",
    detail: "SELECT statement",
  }),
  snippetCompletion("INSERT INTO ${table} (${columns}) VALUES (${values})", {
    label: "insert",
    type: "keyword",
    detail: "INSERT statement",
  }),
  snippetCompletion(
    "UPDATE ${table} SET ${column} = ${value} WHERE ${condition}",
    {
      label: "update",
      type: "keyword",
      detail: "UPDATE statement",
    },
  ),
  snippetCompletion("COUNT(DISTINCT ${column})", {
    label: "countd",
    type: "function",
    detail: "Count distinct values",
  }),
  snippetCompletion(
    "CASE WHEN ${condition} THEN ${value1} ELSE ${value2} END",
    {
      label: "case",
      type: "keyword",
      detail: "CASE expression",
    },
  ),
];

export const snippetsCompletionSource: CompletionSource = (
  context: CompletionContext,
) => {
  // Only surface snippets on explicit invocation OR exact keyword match to avoid hijacking partials like 'sele'
  const word = context.matchBefore(/[\w]+$/);
  const text = word?.text?.toLowerCase() || "";
  const allowed = ["select", "insert", "update", "countd", "case"];
  if (!context.explicit && !allowed.includes(text)) return null;
  const from = word ? word.from : context.pos;
  // Filter snippets to those matching current word if present
  const options = text
    ? sqlSnippets.filter((s) => s.label?.toLowerCase?.() === text)
    : sqlSnippets;
  return { from, options };
};
