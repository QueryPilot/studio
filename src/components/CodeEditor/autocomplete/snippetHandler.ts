/**
 * Snippet Expansion Handler
 * Handles snippet template expansion with placeholders
 */

import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/**
 * Create a snippet completion that handles template expansion
 */
export function createSnippetCompletion(
  label: string,
  template: string,
  detail?: string,
  info?: string,
  _score?: number,
): Completion {
  return {
    label,
    detail,
    info,
    apply: (
      view: EditorView,
      _completion: Completion,
      from: number,
      to: number,
    ) => {
      // Parse template and extract placeholders
      const { text, placeholders } = parseSnippetTemplate(template);

      // Insert the expanded text
      view.dispatch({
        changes: { from, to, insert: text },
        selection:
          placeholders.length > 0 && placeholders[0]
            ? { anchor: from + placeholders[0].from }
            : { anchor: from + text.length },
      });

      // If there are placeholders, we could implement tabstop navigation here
      // For now, we just position the cursor at the first placeholder
    },
    type: "text",
  } as Completion & { score?: number };
}

interface Placeholder {
  index: number;
  from: number;
  to: number;
  text: string;
}

/**
 * Parse snippet template and extract placeholders
 */
function parseSnippetTemplate(template: string): {
  text: string;
  placeholders: Placeholder[];
} {
  const placeholders: Placeholder[] = [];
  let offset = 0;

  // Replace ${n:text} with text and track placeholder positions
  const text = template.replace(
    /\$\{(\d+):([^}]+)\}/g,
    (_match, index: string, content: string) => {
      const placeholderIndex = parseInt(index, 10);
      const from = offset;
      const to = offset + content.length;

      placeholders.push({
        index: placeholderIndex,
        from,
        to,
        text: content,
      });

      offset += content.length;
      return content;
    },
  );

  // Sort placeholders by index
  placeholders.sort((a, b) => a.index - b.index);

  return { text, placeholders };
}

/**
 * Helper to create snippet-based completions from template
 */
export function snippetCompletion(
  template: string,
  options: {
    label?: string;
    detail?: string;
    info?: string;
    score?: number;
  } = {},
): Completion {
  // Extract label from template if not provided
  const label = options.label || (template.split("\n")[0] ?? "").substring(0, 30);

  return createSnippetCompletion(
    label,
    template,
    options.detail,
    options.info,
    options.score,
  );
}
