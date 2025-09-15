import type {
  Completion,
  CompletionContext,
  CompletionSource,
  CompletionResult,
} from "@codemirror/autocomplete";

const KEYWORDS: Array<{ label: string; apply?: string; detail?: string }> = [
  { label: "SELECT" },
  { label: "FROM" },
  { label: "WHERE" },
  { label: "JOIN" },
  { label: "INNER JOIN", apply: "INNER JOIN " },
  { label: "LEFT JOIN", apply: "LEFT JOIN " },
  { label: "RIGHT JOIN", apply: "RIGHT JOIN " },
  { label: "FULL JOIN", apply: "FULL JOIN " },
  { label: "GROUP BY" },
  { label: "ORDER BY" },
  { label: "HAVING" },
  { label: "LIMIT" },
  { label: "OFFSET" },
  { label: "INSERT INTO", apply: "INSERT INTO " },
  { label: "VALUES", apply: "VALUES " },
  { label: "UPDATE" },
  { label: "SET", apply: "SET " },
  { label: "DELETE FROM", apply: "DELETE FROM " },
  { label: "CREATE TABLE", apply: "CREATE TABLE " },
  { label: "DROP TABLE", apply: "DROP TABLE " },
];

export const keywordCompletionSource: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  const word = context.matchBefore(/[\w]+$/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;
  const prefix = (word?.text || "").toLowerCase();
  const options: Completion[] = KEYWORDS.filter(
    (k) => !prefix || k.label.toLowerCase().startsWith(prefix),
  ).map((k) => ({
    label: k.label,
    type: "keyword",
    detail: k.detail || "keyword",
    apply: k.apply || `${k.label} `,
  }));
  // If nothing typed yet (prefix empty) and not explicit, don't flood with keywords
  if (!prefix && !context.explicit) return null;
  if (options.length === 0) return null;
  return { from, options, validFor: /^(?:[\w]+)?$/ };
};
