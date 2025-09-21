import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  foldNodeProp,
  foldInside,
  syntaxTree
} from "@codemirror/language";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  ExternalTokenizer,
  ContextTracker,
  LRParser
} from "@lezer/lr";
import { Input, NodeType, Tree } from "@lezer/common";

// Import the existing stream parser as fallback
import { dbmlLanguage as streamParser } from "./dbml-language";

// Define node types for DBML
const nodeTypes = {
  Project: NodeType.define({ id: 1, name: "Project" }),
  Table: NodeType.define({ id: 2, name: "Table" }),
  TablePartial: NodeType.define({ id: 3, name: "TablePartial" }),
  TableGroup: NodeType.define({ id: 4, name: "TableGroup" }),
  Enum: NodeType.define({ id: 5, name: "Enum" }),
  Ref: NodeType.define({ id: 6, name: "Ref" }),
  Note: NodeType.define({ id: 7, name: "Note" }),
  IndexBlock: NodeType.define({ id: 8, name: "IndexBlock" }),
  ColumnDef: NodeType.define({ id: 9, name: "ColumnDef" }),
  Setting: NodeType.define({ id: 10, name: "Setting" }),
  Block: NodeType.define({ id: 11, name: "Block" }),
};

// Create a custom parser that recognizes DBML blocks
class DBMLParser {
  parse(input: string, pos: number = 0) {
    const blocks: any[] = [];
    const lines = input.split('\n');
    let currentBlock = null;
    let blockStart = 0;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed === '') {
        continue;
      }

      // Check for block starts
      if (!currentBlock) {
        if (trimmed.match(/^Project\s+\w+\s*\{/)) {
          currentBlock = { type: 'Project', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^Table\s+[\w.]+(\s+as\s+\w+)?\s*(\[.*?\])?\s*\{/)) {
          currentBlock = { type: 'Table', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^TablePartial\s+\w+\s*(\[.*?\])?\s*\{/)) {
          currentBlock = { type: 'TablePartial', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^TableGroup\s+\w+\s*(\[.*?\])?\s*\{/)) {
          currentBlock = { type: 'TableGroup', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^Enum\s+[\w.]+\s*\{/)) {
          currentBlock = { type: 'Enum', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^Ref\s+(\w+\s*)?\{/)) {
          currentBlock = { type: 'Ref', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^Note\s+\w+\s*\{/)) {
          currentBlock = { type: 'Note', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        } else if (trimmed.match(/^\s*indexes\s*\{/)) {
          currentBlock = { type: 'IndexBlock', start: lineStart, end: 0, depth: 0 };
          blockStart = lineStart;
          braceDepth = 1;
        }
      } else {
        // Track brace depth
        for (const char of line) {
          if (char === '{') braceDepth++;
          if (char === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              currentBlock.end = lineStart + line.indexOf('}') + 1;
              blocks.push(currentBlock);
              currentBlock = null;
              break;
            }
          }
        }
      }
    }

    return { blocks, input };
  }
}

const dbmlParser = new DBMLParser();

// Create the DBML language with enhanced features
export const dbmlLezerLanguage = LRLanguage.define({
  name: "dbml",
  parser: streamParser.parser.configure({
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