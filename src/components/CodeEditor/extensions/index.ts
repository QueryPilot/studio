/**
 * CodeEditor Extensions
 *
 * Modular extensions for the high-performance SQL editor.
 */

export { createMultiCursorExtension, getCursorCount } from "./multi-cursor";

export { createSnippetExtension, SQL_SNIPPETS, getSnippetByPrefix, getAllSnippets } from "./snippets";
export type { Snippet } from "./snippets";

export { createParameterHintsExtension } from "./parameter-hints";

export { createFormatterExtension, formatEditorContent } from "./formatter";

export { createGotoDefinitionExtension } from "./goto-definition";
export type { GotoDefinitionEvent } from "./goto-definition";

export { createSemanticHighlightingExtension, clearSemanticCache } from "./semantic-highlighting";

export { createRefactoringExtension } from "./sql-refactoring";
export type { RefactorOptions } from "./sql-refactoring";

export { startRename } from "./inline-rename";

export { createScrollbarMarkersExtension } from "./scrollbar-markers";

export { createFormatOnPasteExtension } from "./format-on-paste";

export { createQueryHistoryNavExtension } from "./query-history-navigation";
