import { type Command } from "@/types/command";
import { eventBus } from "@/services/eventBus";

export const exportCommands: Command[] = [
  {
    id: "data.export.csv",
    label: "Export to CSV",
    category: "Export",
    when: "dataGridFocus",
    handler: () => {
      eventBus.emit("data-grid:export-csv", {});
    },
  },
  {
    id: "data.export.json",
    label: "Export to JSON",
    category: "Export",
    when: "dataGridFocus",
    handler: () => {
      eventBus.emit("data-grid:export-json", {});
    },
  },
  {
    id: "data.copyAs.insert",
    label: "Copy as INSERT Statements",
    category: "Export",
    when: "dataGridFocus && !selectionEmpty",
    handler: () => {
      eventBus.emit("data-grid:copy-as-insert", {});
    },
  },
  {
    id: "data.copyAs.json",
    label: "Copy Selection as JSON",
    category: "Export",
    when: "dataGridFocus && !selectionEmpty",
    handler: () => {
      eventBus.emit("data-grid:copy", { mode: "json" });
    },
  },
];
