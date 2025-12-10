import { type Command } from "@/types/command";
import { eventBus } from "@/services/eventBus";

export const editorCommands: Command[] = [
  {
    id: "editor.find",
    label: "Find",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:find", {});
    },
  },
  {
    id: "editor.replace",
    label: "Find and Replace",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:replace", {});
    },
  },
  {
    id: "editor.goToLine",
    label: "Go to Line",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:go-to-line", {});
    },
  },
  {
    id: "editor.toggleWordWrap",
    label: "Toggle Word Wrap",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:toggle-word-wrap", {});
    },
  },
  {
    id: "editor.toggleComment",
    label: "Toggle Line Comment",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:toggle-comment", {});
    },
  },
  {
    id: "editor.format",
    label: "Format Document",
    category: "Editor",
    when: "editorTextFocus",
    handler: () => {
      eventBus.emit("query-editor:format", {});
    },
  },
];
