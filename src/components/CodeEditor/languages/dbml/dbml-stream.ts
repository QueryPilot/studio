import { StreamLanguage } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const dbmlStreamLang = StreamLanguage.define({
  name: "dbml",
  startState: () => ({
    inComment: false,
    inString: false,
    stringDelim: "",
    inMultilineString: false,
    inBlock: false,
    blockType: ""
  }),

  token(stream, state) {
    // Handle multi-line comments
    if (state.inComment) {
      if (stream.match("*/")) {
        state.inComment = false;
        return "comment";
      }
      stream.next();
      return "comment";
    }

    // Handle multi-line strings
    if (state.inMultilineString) {
      if (stream.match("'''")) {
        state.inMultilineString = false;
        return "string";
      }
      stream.next();
      return "string";
    }

    // Handle regular strings
    if (state.inString) {
      if (stream.eat(state.stringDelim)) {
        state.inString = false;
        state.stringDelim = "";
        return "string";
      }
      if (stream.eat("\\")) {
        stream.next(); // Skip escaped character
      } else {
        stream.next();
      }
      return "string";
    }

    // Check for comments
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inComment = true;
      return "comment";
    }

    // Check for multi-line strings
    if (stream.match("'''")) {
      state.inMultilineString = true;
      return "string";
    }

    // Check for strings
    if (stream.eat("'") || stream.eat('"')) {
      state.inString = true;
      state.stringDelim = stream.current();
      return "string";
    }

    // Check for expressions (backticks)
    if (stream.eat("`")) {
      while (!stream.eol() && !stream.eat("`")) {
        if (stream.eat("\\")) stream.next();
        else stream.next();
      }
      return "string-2";
    }

    // Check for color codes
    if (stream.match(/#[0-9a-fA-F]+/)) {
      return "atom";
    }

    // Check for numbers
    if (stream.match(/^-?\d+(\.\d+)?/)) {
      return "number";
    }

    // Check for booleans
    if (stream.match(/^(true|false|null)\b/)) {
      return "atom";
    }

    // Check for operators
    if (stream.match(/^(<>|<=|>=|<|>|-)/)) {
      return "operator";
    }

    // Check for keywords
    if (stream.match(/^(Project|Table|TablePartial|TableGroup|Enum|Ref|Note|indexes)\b/)) {
      return "keyword";
    }

    // Check for modifiers
    if (stream.match(/^(pk|primary\s+key|unique|not\s+null|null|increment|default|note|ref|as)\b/)) {
      return "modifier";
    }

    // Check for data types
    if (stream.match(/^(integer|varchar|text|boolean|timestamp|date|datetime|json|jsonb|decimal|numeric|float|double|uuid|bytea|char|bigint|smallint|serial|bigserial)\b/)) {
      return "type";
    }

    // Check for actions
    if (stream.match(/^(cascade|restrict|set\s+null|set\s+default|no\s+action|delete|update)\b/)) {
      return "modifier";
    }

    // Check for identifiers
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?/)) {
      return "variable";
    }

    // Check for punctuation
    if (stream.eat(/[{}[\](),.:~]/)) {
      return "punctuation";
    }

    // Skip whitespace
    if (stream.eatSpace()) {
      return null;
    }

    // Unknown character
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] }
  }
});

export const dbmlStream = () => StreamLanguage.define(dbmlStreamLang.language);