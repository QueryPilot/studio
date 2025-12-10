import { type Command } from "@/types/command";
import { eventBus } from "@/services/eventBus";

export const queryCommands: Command[] = [
  {
    id: "query.execute",
    label: "Execute Query",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:execute", {});
    },
  },
  {
    id: "query.executeSelection",
    label: "Execute Selection",
    category: "Query",
    when: "editorTextFocus && queryEditor && hasSelection",
    handler: () => {
      eventBus.emit("query-editor:execute", { mode: "text" });
    },
  },
  {
    id: "query.explain",
    label: "Explain Query (EXPLAIN ANALYZE)",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:explain", {});
    },
  },
  {
    id: "query.cancel",
    label: "Cancel Running Query",
    category: "Query",
    handler: () => {
      eventBus.emit("query-editor:cancel", {});
    },
  },
  {
    id: "query.save",
    label: "Save Query",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:save", {});
    },
  },
  {
    id: "query.clear",
    label: "Clear Editor",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:clear", {});
    },
  },
  {
    id: "query.format",
    label: "Format Query",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      eventBus.emit("query-editor:format", {});
    },
  },
  {
    id: "query.toggleHistory",
    label: "Toggle Query History",
    category: "Query",
    handler: () => {
      eventBus.emit("query-editor:toggle-history", {});
    },
  },
];
