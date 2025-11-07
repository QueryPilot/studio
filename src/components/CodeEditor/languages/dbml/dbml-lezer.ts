import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  foldNodeProp,
  foldInside
} from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";

// Import the existing stream parser as fallback
import { dbmlLanguage as streamParser } from "./dbml-language";

// Create the DBML language with enhanced features
export const dbmlLezerLanguage = LRLanguage.define({
  name: "dbml",
  parser: (streamParser.parser as any).configure({
    props: [
      styleTags({
        "Project Table TablePartial TableGroup Enum Ref Note indexes": t.keyword,
        "as": t.keyword,
        "pk primary key unique not null increment default note ref": t.modifier,
        "cascade restrict set delete update": t.modifier,
        "headercolor color type name": t.propertyName,
        "true false null": t.bool,
        "integer varchar text boolean timestamp date json jsonb": t.typeName,
        "decimal numeric float double uuid bytea": t.typeName,
        "bigint smallint serial bigserial": t.typeName,
        Identifier: t.variableName,
        String: t.string,
        Number: t.number,
        LineComment: t.lineComment,
        BlockComment: t.blockComment,
        "< > - <>": t.operator,
        "{ } [ ] ( )": t.bracket,
        ", : . ~": t.punctuation,
      }),
      indentNodeProp.add({
        // Auto-indent for blocks
        Block: context => {
          const column = context.column(context.node.from);
          return column + context.unit;
        },
        Project: context => context.column(context.node.from) + context.unit,
        Table: context => context.column(context.node.from) + context.unit,
        TablePartial: context => context.column(context.node.from) + context.unit,
        TableGroup: context => context.column(context.node.from) + context.unit,
        Enum: context => context.column(context.node.from) + context.unit,
        Ref: context => context.column(context.node.from) + context.unit,
        Note: context => context.column(context.node.from) + context.unit,
        IndexBlock: context => context.column(context.node.from) + context.unit,
      }),
      foldNodeProp.add({
        // Enable code folding for all block structures
        Block: foldInside,
        Project: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        Table: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        TablePartial: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        TableGroup: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        Enum: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        Ref: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        Note: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 200, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        IndexBlock: (node, state) => {
          const start = node.from;
          const text = state.sliceDoc(start, Math.min(start + 100, node.to));
          const openBrace = text.indexOf('{');
          if (openBrace === -1) return null;
          return { from: start + openBrace + 1, to: node.to - 1 };
        },
        "BlockComment": node => {
          return { from: node.from + 2, to: node.to - 2 };
        }
      })
    ]
  }),
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    indentOnInput: /^\s*\}$/,
    closeBrackets: {
      brackets: ["(", "[", "{", "'", '"', "`"],
      before: ")]}'\"`"
    },
    wordChars: "$",
  }
});

// Export the enhanced DBML language support
export function dbmlLezer() {
  return new LanguageSupport(dbmlLezerLanguage, [
    // Additional support extensions can be added here
  ]);
}