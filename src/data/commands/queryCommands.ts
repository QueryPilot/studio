import { type Command } from "@/types/command";
import { eventBus } from "@/services/eventBus";
import { queryActionDispatcher } from "@/services/queryActionDispatcher";

export const queryCommands: Command[] = [
  {
    id: "query.execute",
    label: "Execute Query",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("execute");
    },
  },
  {
    id: "query.executeSelection",
    label: "Execute Selection",
    category: "Query",
    when: "editorTextFocus && queryEditor && hasSelection",
    handler: () => {
      void queryActionDispatcher.dispatch("executeSelection");
    },
  },
  {
    id: "query.executeAll",
    label: "Execute All Statements",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("executeAll");
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
      void queryActionDispatcher.dispatch("cancel");
    },
  },
  {
    id: "query.save",
    label: "Save Query",
    category: "Query",
    when: "editorTextFocus && queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("save");
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
      void queryActionDispatcher.dispatch("format");
    },
  },
  {
    id: "query.toggleResults",
    label: "Toggle Results Panel",
    category: "Query",
    when: "queryEditor",
    handler: () => {
      void queryActionDispatcher.dispatch("toggleResults");
    },
  },
];
