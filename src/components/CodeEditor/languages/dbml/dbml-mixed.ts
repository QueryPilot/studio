import {
  LanguageSupport,
  foldService,
  indentService
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { lintGutter } from "@codemirror/lint";

// Import the stream parser for syntax highlighting
import { dbmlLanguage as streamParser } from "./dbml-language";
// Import linter and IntelliSense
import { dbmlLinter } from "./dbml-linter";
// import { dbmlCompletions } from "./dbml-intellisense"; // Disabled for now

// Enhanced DBML folding service
const dbmlFoldService = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  const lineText = line.text.trim();

  // Main block structures that can be folded
  const blockKeywords = [
    'Project',
    'Table',
    'TablePartial',
    'TableGroup',
    'Enum',
    'Ref',
    'Note',
    'indexes'
  ];

  // Check if line starts with a block keyword
  for (const keyword of blockKeywords) {
    if (lineText.startsWith(keyword + ' ') || lineText === keyword || lineText.startsWith(keyword + '\t')) {
      // Find the opening brace
      let bracePos = -1;
      const searchEnd = Math.min(from + 500, state.doc.length);

      for (let pos = from; pos < searchEnd; pos++) {
        if (state.doc.sliceString(pos, pos + 1) === '{') {
          bracePos = pos;
          break;
        }
        // Stop if we hit a new line without finding a brace (for single-line definitions)
        if (state.doc.sliceString(pos, pos + 1) === '\n') {
          const nextLine = state.doc.lineAt(pos + 1);
          if (!nextLine.text.trim().startsWith('{')) {
            break;
          }
        }
      }

      if (bracePos === -1) continue;

      // Find matching closing brace
      let depth = 1;
      let closePos = -1;

      for (let pos = bracePos + 1; pos < state.doc.length && pos < bracePos + 10000; pos++) {
        const char = state.doc.sliceString(pos, pos + 1);

        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            closePos = pos;
            break;
          }
        }
      }

      if (closePos > bracePos) {
        return { from: bracePos + 1, to: closePos };
      }
    }
  }

  // Handle multi-line strings (triple quotes)
  if (lineText.includes("'''")) {
    const start = from + lineText.indexOf("'''") + 3;

    // Find closing triple quotes
    for (let i = line.number + 1; i <= state.doc.lines && i <= line.number + 100; i++) {
      const checkLine = state.doc.line(i);
      const idx = checkLine.text.indexOf("'''");
      if (idx !== -1) {
        return { from: start, to: checkLine.from + idx };
      }
    }
  }

  // Handle block comments
  if (lineText.includes("/*")) {
    const start = from + lineText.indexOf("/*") + 2;
    const docStr = state.doc.sliceString(start, Math.min(start + 5000, state.doc.length));
    const closeIdx = docStr.indexOf("*/");
    if (closeIdx !== -1) {
      return { from: start, to: start + closeIdx };
    }
  }

  return null;
});

// Enhanced DBML indentation service
const dbmlIndentService = indentService.of((context, pos) => {
  const line = context.lineAt(pos);
  const prevLine = pos > 0 ? context.lineAt(pos - 1) : null;

  if (!prevLine) return 0;

  const prevText = prevLine.text;
  const prevTrimmed = prevText.trim();
  const currentTrimmed = line.text.trim();

  // Calculate base indent from previous line
  let baseIndent = 0;
  for (let i = 0; i < prevText.length; i++) {
    if (prevText[i] === ' ') baseIndent++;
    else if (prevText[i] === '\t') baseIndent += context.unit;
    else break;
  }

  // If previous line opens a block, indent
  if (prevTrimmed.endsWith('{')) {
    return baseIndent + context.unit;
  }

  // If current line closes a block, dedent
  if (currentTrimmed.startsWith('}')) {
    return Math.max(0, baseIndent - context.unit);
  }

  // If inside indexes block, maintain indent
  if (prevTrimmed.startsWith('indexes') && prevTrimmed.includes('{')) {
    return baseIndent + context.unit;
  }

  // Inside a block (check for unclosed braces)
  let braceCount = 0;
  const currentLineNum = context.state.doc.lineAt(pos).number;

  for (let lineNo = 1; lineNo <= currentLineNum; lineNo++) {
    const checkLine = context.state.doc.line(lineNo);
    const text = checkLine.text;
    for (const char of text) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }
  }

  if (braceCount > 0) {
    // We're inside a block
    const blockIndent = context.unit * braceCount;

    // Special handling for certain keywords
    if (currentTrimmed.startsWith('Note:') ||
        currentTrimmed.startsWith('indexes') ||
        currentTrimmed.startsWith('~')) {
      return blockIndent;
    }

    return blockIndent;
  }

  return baseIndent;
});

// Create the mixed-mode language support using StreamLanguage
export const dbmlMixedLanguage = streamParser;

export function dbmlMixed() {
  return new LanguageSupport(dbmlMixedLanguage, [
    // Add folding and indentation services
    dbmlFoldService,
    dbmlIndentService,
    // Add linter and lint gutter
    dbmlLinter(),
    lintGutter(),
    // IntelliSense completions disabled for now
    // dbmlCompletions(),
    // Additional extensions for better DBML support
    EditorState.languageData.of(() => {
      return [{
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
        closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] }
      }];
    })
  ]);
}

