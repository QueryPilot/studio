/**
 * CodeEditor Extensions
 *
 * Modular extensions for the high-performance SQL editor.
 */

export { createVimExtension } from "./vim";
export type { VimConfig } from "./vim";

export { createMultiCursorExtension, getCursorCount } from "./multi-cursor";

export { createSnippetExtension, SQL_SNIPPETS, getSnippetByPrefix, getAllSnippets } from "./snippets";
export type { Snippet } from "./snippets";

export { createParameterHintsExtension } from "./parameter-hints";

export { createFormatterExtension, formatEditorContent } from "./formatter";

export { createGotoDefinitionExtension } from "./goto-definition";
export type { GotoDefinitionEvent } from "./goto-definition";

export { createSemanticHighlightingExtension, clearSemanticCache } from "./semantic-highlighting";
