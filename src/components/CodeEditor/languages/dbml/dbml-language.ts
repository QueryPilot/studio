import { LanguageSupport, StreamLanguage } from "@codemirror/language";

const dbmlStreamParser = StreamLanguage.define({
  name: "dbml",
  startState: () => ({
    inComment: false,
    inString: false,
    stringDelim: "",
    inMultilineString: false,
    multilineCount: 0
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
      if (stream.eat("\\")) {
        stream.next(); // Skip escaped character
        return "string";
      }
      if (stream.eat(state.stringDelim)) {
        state.inString = false;
        state.stringDelim = "";
        return "string";
      }
      stream.next();
      return "string";
    }

    // Skip whitespace
    if (stream.eatSpace()) {
      return null;
    }

    // Check for comments
    if (stream.match("//")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match("/*")) {
      state.inComment = true;
      return "blockComment";
    }

    // Check for multi-line strings
    if (stream.match("'''")) {
      state.inMultilineString = true;
      return "string";
    }

    // Check for strings
    const ch = stream.peek();
    if (ch === "'" || ch === '"') {
      stream.next();
      state.inString = true;
      state.stringDelim = ch;
      return "string";
    }

    // Check for expressions (backticks)
    if (stream.eat("`")) {
      while (!stream.eol() && !stream.eat("`")) {
        if (stream.eat("\\")) stream.next();
        else stream.next();
      }
      return "string2";
    }

    // Check for color codes
    if (stream.match(/#[0-9a-fA-F]+\b/)) {
      return "atom";
    }

    // Check for numbers
    if (stream.match(/^-?\d+(\.\d+)?/)) {
      return "number";
    }

    // Check for booleans and null
    if (stream.match(/^(true|false|null)\b/)) {
      return "bool";
    }

    // Check for relationship operators
    if (stream.match(/^(<>|<|>|-)/)) {
      return "operator";
    }

    // Check for main keywords - must be case-sensitive for DBML
    if (stream.match(/^(Project|Table|TablePartial|TableGroup|Enum|Enum|Ref|Note|indexes)\b/)) {
      return "keyword";
    }

    // Check for constraint keywords
    if (stream.match(/^(pk|primary\s+key|unique|not\s+null|null|increment|default|note|ref|as)\b/i)) {
      return "modifier";
    }

    // Check for data types - expanded list from official DBML
    if (stream.match(/^(integer|varchar|text|boolean|timestamp|timestamptz|date|datetime|json|jsonb|decimal|numeric|float|double|uuid|bytea|char|bigint|smallint|serial|bigserial|int|int2|int4|int8|tinyint|mediumint|real|time|timetz|year|binary|varbinary|blob|tinyblob|mediumblob|longblob|tinytext|mediumtext|longtext|citext|interval|money|inet|cidr|macaddr|bit|varbit|xml|array|hstore|point|line|lseg|box|path|polygon|circle|enum)\b/i)) {
      return "typeName";
    }

    // Check for cascade actions
    if (stream.match(/^(cascade|restrict|set\s+null|set\s+default|no\s+action|delete|update|headercolor|color|type|name)\b/i)) {
      return "modifier";
    }

    // Check for partial reference (tilde operator)
    if (stream.eat("~")) {
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        return "operator";
      }
      return "punctuation";
    }

    // Check for identifiers (including schema.table.column notation)
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,2}/)) {
      return "variableName";
    }

    // Check for punctuation
    if (stream.eat(/[{}[\](),.:]/)) {
      return "punctuation";
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

export const dbmlLanguage = dbmlStreamParser;

export function dbml() {
  return new LanguageSupport(dbmlLanguage);
}