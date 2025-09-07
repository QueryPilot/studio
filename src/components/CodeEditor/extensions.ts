import type { Extension } from "@codemirror/state";
import {
  keymap,
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  foldService,
  indentUnit,
  codeFolding,
  foldKeymap,
} from "@codemirror/language";
import {
  searchKeymap,
  highlightSelectionMatches,
  search,
} from "@codemirror/search";
import type { SqlDialect, CodeEditorLanguage } from "./types";

// Enhanced SQL folding service using syntax tree for better nested support
const sqlFoldService = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  const lineText = line.text.trim();
  const lineTextUpper = lineText.toUpperCase();

  // Helper to find matching END for block statements
  const findBlockEnd = (
    startLine: number,
    startPattern: string,
    endPatterns: string[],
  ): number | null => {
    let depth = 1;
    const lines = state.doc.lines;

    for (let i = startLine + 1; i <= lines && i <= startLine + 1000; i++) {
      const checkLine = state.doc.line(i);
      const checkText = checkLine.text.trim().toUpperCase();

      // Skip empty lines and comments
      if (!checkText || checkText.startsWith("--")) continue;

      // Check for nested blocks
      if (startPattern === "BEGIN") {
        if (checkText === "BEGIN") depth++;
        else if (checkText === "END" || checkText === "END;") {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "IF") {
        // Handle IF...ELSIF...ELSE...END IF
        if (checkText.startsWith("IF ") && !checkText.startsWith("END IF")) {
          depth++;
        } else if (
          checkText.startsWith("END IF") ||
          checkText === "ENDIF" ||
          checkText === "ENDIF;"
        ) {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "CASE") {
        if (checkText.startsWith("CASE ")) depth++;
        else if (checkText.startsWith("END CASE") || checkText === "END") {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else if (startPattern === "LOOP") {
        if (
          checkText === "LOOP" ||
          checkText.startsWith("FOR ") ||
          checkText.startsWith("WHILE ")
        ) {
          depth++;
        } else if (checkText.startsWith("END LOOP")) {
          depth--;
          if (depth === 0) return checkLine.to;
        }
      } else {
        // Generic pattern matching
        for (const endPattern of endPatterns) {
          if (checkText.startsWith(endPattern) || checkText === endPattern) {
            return checkLine.to;
          }
        }
      }
    }

    return null;
  };

  // Check different SQL block patterns
  if (lineTextUpper === "BEGIN" || lineTextUpper.endsWith(" BEGIN")) {
    const endPos = findBlockEnd(line.number, "BEGIN", ["END", "END;"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (
    (lineTextUpper.startsWith("IF ") || lineTextUpper.includes(" IF ")) &&
    !lineTextUpper.startsWith("END IF") &&
    !lineTextUpper.includes("END IF")
  ) {
    const endPos = findBlockEnd(line.number, "IF", ["END IF", "ENDIF"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (lineTextUpper.startsWith("CASE ")) {
    const endPos = findBlockEnd(line.number, "CASE", ["END CASE", "END"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  if (
    lineTextUpper === "LOOP" ||
    lineTextUpper.startsWith("FOR ") ||
    lineTextUpper.startsWith("FOREACH ") ||
    lineTextUpper.startsWith("WHILE ")
  ) {
    const endPos = findBlockEnd(line.number, "LOOP", ["END LOOP"]);
    if (endPos) return { from: line.from, to: endPos };
  }

  // Handle CREATE statements
  if (
    lineTextUpper.startsWith("CREATE ") ||
    lineTextUpper.startsWith("CREATE OR REPLACE ")
  ) {
    if (
      lineTextUpper.includes("FUNCTION") ||
      lineTextUpper.includes("PROCEDURE") ||
      lineTextUpper.includes("TRIGGER")
    ) {
      // Look for $$ or END
      for (
        let i = line.number + 1;
        i <= state.doc.lines && i <= line.number + 200;
        i++
      ) {
        const checkLine = state.doc.line(i);
        const checkText = checkLine.text.trim();
        if (
          checkText === "$$" ||
          checkText === "$function$" ||
          checkText === "$procedure$" ||
          checkText.startsWith("END;") ||
          checkText === "END"
        ) {
          // If we find $$, look for the closing $$
          if (checkText.startsWith("$")) {
            for (let j = i + 1; j <= state.doc.lines && j <= i + 500; j++) {
              const endLine = state.doc.line(j);
              if (endLine.text.trim() === checkText) {
                return { from: line.from, to: endLine.to };
              }
            }
          } else {
            return { from: line.from, to: checkLine.to };
          }
        }
      }
    }
  }

  // Handle DECLARE blocks
  if (lineTextUpper === "DECLARE" || lineTextUpper.startsWith("DECLARE ")) {
    // Find the corresponding BEGIN
    for (
      let i = line.number + 1;
      i <= state.doc.lines && i <= line.number + 100;
      i++
    ) {
      const checkLine = state.doc.line(i);
      if (checkLine.text.trim().toUpperCase() === "BEGIN") {
        return { from: line.from, to: checkLine.from - 1 };
      }
    }
  }

  // Handle AS blocks
  if (lineTextUpper.startsWith("AS ")) {
    // Find the corresponding BEGIN
    for (
      let i = line.number + 1;
      i <= state.doc.lines && i <= line.number + 50;
      i++
    ) {
      const checkLine = state.doc.line(i);
      const checkText = checkLine.text.trim().toUpperCase();
      if (checkText === "BEGIN") {
        return { from: line.from, to: checkLine.from - 1 };
      }
    }
  }

  return null;
});

// Map our dialect types to CodeMirror SQL dialects
const getDialect = (dialect?: SqlDialect) => {
  switch (dialect) {
    case "mysql":
      return MySQL;
    case "sqlite":
      return SQLite;
    case "postgresql":
    default:
      return PostgreSQL;
  }
};

// Get language extension based on language type
export const getLanguageExtension = (
  language: CodeEditorLanguage = "sql",
  dialect?: SqlDialect,
): Extension => {
  switch (language) {
    case "sql":
      return sql({
        dialect: getDialect(dialect),
        upperCaseKeywords: false, // Let syntax highlighting handle the styling
      });
    case "json":
      // For now, treat JSON as plain text
      // We can add JSON language support later if needed
      return [];
    case "text":
    default:
      return [];
  }
};

// Create execute command keymap
export const createExecuteKeymap = (onExecute?: () => void): Extension => {
  if (!onExecute) return [];

  return keymap.of([
    {
      key: "Mod-Enter",
      run: () => {
        onExecute();
        return true;
      },
    },
  ]);
};

// Get editor extensions based on configuration
export const getEditorExtensions = (
  language: CodeEditorLanguage = "sql",
  dialect?: SqlDialect,
  readOnly = false,
  showLineNumbers = true,
  onExecute?: () => void,
): Extension[] => {
  const extensions: Extension[] = [
    // Basic setup
    bracketMatching(),
    highlightSelectionMatches(),
    indentOnInput(),

    // Set indent unit for SQL
    indentUnit.of("  "),

    // Enable line wrapping
    EditorView.lineWrapping,

    // Language support
    getLanguageExtension(language, dialect),

    // Search and replace support
    search({
      top: true, // Show search panel at the top
      caseSensitive: false,
      literal: false,
      regexp: false,
      wholeWord: false,
      createPanel: (view) => {
        const dom = document.createElement("div");
        dom.className = "cm-search-panel";
        return { dom, top: true };
      },
    }),

    // Code folding support
    codeFolding({
      placeholderText: "...",
    }),

    // Custom SQL folding for nested blocks
    sqlFoldService,

    // Keymaps including fold keymap, search keymap, and completion keymap
    keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
  ];

  // Add line numbers and fold gutter if enabled
  if (showLineNumbers) {
    extensions.push(
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter({
        markerDOM: (open) => {
          const marker = document.createElement("span");
          marker.style.cursor = "pointer";
          marker.style.display = "inline-flex";
          marker.style.alignItems = "center";
          marker.style.justifyContent = "center";
          marker.style.width = "20px";
          marker.style.height = "20px";
          marker.style.transition = "color 0.2s";

          // Create SVG element for Lucide-style chevron icon
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.setAttribute("width", "16");
          svg.setAttribute("height", "16");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("fill", "none");
          svg.setAttribute("stroke", "currentColor");
          svg.setAttribute("stroke-width", "2");
          svg.setAttribute("stroke-linecap", "round");
          svg.setAttribute("stroke-linejoin", "round");
          svg.style.color = "#888";
          svg.style.transition = "color 0.2s";

          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          if (open) {
            // ChevronDown icon
            path.setAttribute("d", "M6 9l6 6 6-6");
          } else {
            // ChevronRight icon
            path.setAttribute("d", "M9 6l6 6-6 6");
          }

          svg.appendChild(path);
          marker.appendChild(svg);

          marker.onmouseenter = () => {
            svg.style.color = "#FCA311";
          };
          marker.onmouseleave = () => {
            svg.style.color = "#888";
          };

          return marker;
        },
      }),
    );
  }

  // Add tab indentation if not read-only
  if (!readOnly) {
    extensions.push(keymap.of([indentWithTab]));
  }

  // Add execute keymap if handler provided
  if (onExecute) {
    extensions.push(createExecuteKeymap(onExecute));
  }

  // Add read-only extension if needed (but still allow selection)
  if (readOnly) {
    extensions.push(
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: "0" }) // Allow focus and selection
    );
  }

  // Add base theme
  extensions.push(
    EditorView.theme({
      ".cm-scroller": {
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: "12px",
      },
    }),
  );

  return extensions;
};
