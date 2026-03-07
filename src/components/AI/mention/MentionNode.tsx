import type { EditorConfig, LexicalEditor, LexicalNode, SerializedLexicalNode } from "lexical";
import { DecoratorNode } from "lexical";

import { formatMention } from "@/utils/mentionParser";

import { MentionChip } from "./MentionChip";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface MentionNodeData {
  mentionType: "connection" | "table" | "view" | "function" | "tab";
  connectionId?: string;
  connectionName?: string;
  database?: string;
  schema?: string;
  /** Unique tab identifier for disambiguating tabs across panels */
  tabId?: string;
  name: string;
  displayLabel: string;
}

// ---------------------------------------------------------------------------
// Serialized shape
// ---------------------------------------------------------------------------

export interface SerializedMentionNode extends SerializedLexicalNode {
  data: MentionNodeData;
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class MentionNode extends DecoratorNode<React.ReactNode> {
  __data: MentionNodeData;

  static getType(): string {
    return "mention";
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__data, node.__key);
  }

  constructor(data: MentionNodeData, key?: string) {
    super(key);
    this.__data = data;
  }

  // -- DOM ------------------------------------------------------------------

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.style.display = "inline";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  // -- Inline ---------------------------------------------------------------

  isInline(): boolean {
    return true;
  }

  // -- Text content (serialised mention for AI) -----------------------------

  getTextContent(): string {
    const { mentionType, connectionId, connectionName, schema, name } = this.__data;

    if (mentionType === "connection") {
      // Connection mentions: @ConnName[id:xxx]
      if (!connectionName && !name) return "@";
      const label = connectionName ?? name;
      const safeLabel = /^[a-zA-Z_]\w*$/.test(label) ? label : `"${label}"`;
      const idSuffix = connectionId ? `[id:${connectionId}]` : "";
      return `@${safeLabel}${idSuffix}`;
    }

    if (mentionType === "tab") {
      const base = formatMention("tab", name);
      const tabIdSuffix = this.__data.tabId ? `[id:${this.__data.tabId}]` : "";
      return `${base}${tabIdSuffix}`;
    }

    // table | view | function — delegate to shared formatter, append [id:xxx]
    const base = formatMention(mentionType, name, schema, connectionName);
    const idSuffix = connectionId ? `[id:${connectionId}]` : "";
    return `${base}${idSuffix}`;
  }

  // -- Decorate (React) -----------------------------------------------------

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.ReactNode {
    return <MentionChip data={this.__data} />;
  }

  // -- JSON export / import -------------------------------------------------

  exportJSON(): SerializedMentionNode {
    return {
      type: MentionNode.getType(),
      version: 1,
      data: { ...this.__data },
    };
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode(serializedNode.data);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function $createMentionNode(data: MentionNodeData): MentionNode {
  return new MentionNode(data);
}

export function $isMentionNode(
  node: LexicalNode | null | undefined,
): node is MentionNode {
  return node instanceof MentionNode;
}
