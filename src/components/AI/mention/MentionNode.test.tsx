import { describe, expect, it } from "vitest";
import { createEditor, $getRoot, $insertNodes } from "lexical";

import {
  MentionNode,
  $createMentionNode,
  $isMentionNode,
  type MentionNodeData,
  type SerializedMentionNode,
} from "./MentionNode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestEditor() {
  return createEditor({ nodes: [MentionNode] });
}

/** Run a callback inside an editor.update and flush synchronously. */
async function withEditor<T>(fn: () => T): Promise<T> {
  const editor = createTestEditor();
  const root = document.createElement("div");
  editor.setRootElement(root);

  let result!: T;
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        result = fn();
      },
      { onUpdate: resolve },
    );
  });
  return result;
}

/** Insert a mention node and return its text content from a read. */
async function getTextContent(data: MentionNodeData): Promise<string> {
  const editor = createTestEditor();
  const root = document.createElement("div");
  editor.setRootElement(root);

  let text = "";
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const node = $createMentionNode(data);
        $getRoot().clear();
        $insertNodes([node]);
      },
      { onUpdate: resolve },
    );
  });

  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent();
  });
  return text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MentionNode", () => {
  it("getType() returns 'mention'", () => {
    expect(MentionNode.getType()).toBe("mention");
  });

  it("$createMentionNode does not throw", async () => {
    await expect(
      withEditor(() =>
        $createMentionNode({
          mentionType: "table",
          name: "users",
          displayLabel: "users",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("$isMentionNode identifies mention nodes", async () => {
    const result = await withEditor(() => {
      const node = $createMentionNode({
        mentionType: "table",
        name: "users",
        displayLabel: "users",
      });
      return $isMentionNode(node);
    });
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getTextContent
  // -------------------------------------------------------------------------

  it("getTextContent for table mention with connection and schema", async () => {
    const text = await getTextContent({
      mentionType: "table",
      connectionName: "DevDB",
      schema: "public",
      name: "users",
      displayLabel: "public.users",
    });
    expect(text).toBe("@DevDB/public.users");
  });

  it("getTextContent for connection mention", async () => {
    const text = await getTextContent({
      mentionType: "connection",
      connectionName: "DevDB",
      name: "DevDB",
      displayLabel: "DevDB",
    });
    expect(text).toBe("@DevDB");
  });

  it("getTextContent for connection mention with spaces quotes the name", async () => {
    const text = await getTextContent({
      mentionType: "connection",
      connectionName: "My Database",
      name: "My Database",
      displayLabel: "My Database",
    });
    expect(text).toBe('@"My Database"');
  });

  it("getTextContent for tab mention", async () => {
    const text = await getTextContent({
      mentionType: "tab",
      name: "My Query",
      displayLabel: "My Query",
    });
    expect(text).toBe('@tab:"My Query"');
  });

  it("getTextContent for tab mention without spaces", async () => {
    const text = await getTextContent({
      mentionType: "tab",
      name: "SelectAll",
      displayLabel: "SelectAll",
    });
    expect(text).toBe("@tab:SelectAll");
  });

  it("getTextContent for view mention", async () => {
    const text = await getTextContent({
      mentionType: "view",
      schema: "public",
      name: "active_users",
      displayLabel: "active_users",
    });
    expect(text).toBe("@public.active_users");
  });

  it("getTextContent for function mention", async () => {
    const text = await getTextContent({
      mentionType: "function",
      connectionName: "DevDB",
      schema: "public",
      name: "get_user",
      displayLabel: "get_user",
    });
    expect(text).toBe("@DevDB/public.get_user");
  });

  // -------------------------------------------------------------------------
  // JSON round-trip
  // -------------------------------------------------------------------------

  it("exportJSON produces correct structure", async () => {
    const json = await withEditor(() => {
      const node = $createMentionNode({
        mentionType: "table",
        connectionName: "DevDB",
        schema: "public",
        name: "users",
        displayLabel: "public.users",
      });
      return node.exportJSON();
    });

    expect(json).toEqual<SerializedMentionNode>({
      type: "mention",
      version: 1,
      data: {
        mentionType: "table",
        connectionName: "DevDB",
        schema: "public",
        name: "users",
        displayLabel: "public.users",
      },
    });
  });

  it("importJSON round-trips correctly", async () => {
    const serialized: SerializedMentionNode = {
      type: "mention",
      version: 1,
      data: {
        mentionType: "table",
        connectionName: "DevDB",
        schema: "public",
        name: "users",
        displayLabel: "public.users",
      },
    };

    const text = await (async () => {
      const editor = createTestEditor();
      const root = document.createElement("div");
      editor.setRootElement(root);

      await new Promise<void>((resolve) => {
        editor.update(
          () => {
            const node = MentionNode.importJSON(serialized);
            $getRoot().clear();
            $insertNodes([node]);
          },
          { onUpdate: resolve },
        );
      });

      let t = "";
      editor.getEditorState().read(() => {
        t = $getRoot().getTextContent();
      });
      return t;
    })();

    expect(text).toBe("@DevDB/public.users");
  });
});
