import React, { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useKeyboardServices } from "@/components/KeyboardProvider";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { type CommandDescriptor } from "@/types/command";
import { type KeybindingSerialization, type ResolvedKeybinding } from "@/types/keybinding";
import { userKeybindingsService } from "@/services/userKeybindingsService";
import { keyboardEventToKeybindingInput } from "@/lib/keyboardDispatch";

interface ShortcutRow {
  command: CommandDescriptor;
  keybinding?: ResolvedKeybinding;
}

export interface KeyboardShortcutsHelpProps {
  embedded?: boolean;
}

function pickBestKeybinding(
  commandId: string,
  bindings: ResolvedKeybinding[],
): ResolvedKeybinding | undefined {
  const matches = bindings.filter((binding) => binding.command === commandId);
  if (matches.length === 0) {
    return undefined;
  }
  return matches.sort((left, right) => right.weight - left.weight)[0];
}

function KeyboardShortcutsContent({
  rows,
  query,
  setQuery,
  recordingCommandId,
  onStartRecording,
  onReset,
  onUnbind,
}: {
  rows: ShortcutRow[];
  query: string;
  setQuery: (value: string) => void;
  recordingCommandId: string | null;
  onStartRecording: (commandId: string) => void;
  onReset: (commandId: string) => void;
  onUnbind: (row: ShortcutRow) => void;
}): React.JSX.Element {
  const filteredRows = useMemo(() => {
    if (!query) {
      return rows;
    }

    const lower = query.toLowerCase();
    return rows.filter((row) => {
      const label = row.command.label.toLowerCase();
      const category = row.command.category?.toLowerCase() ?? "";
      const keybinding = row.keybinding?.resolvedLabel.toLowerCase() ?? "";
      return (
        label.includes(lower) ||
        category.includes(lower) ||
        keybinding.includes(lower)
      );
    });
  }, [query, rows]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ShortcutRow[]>();
    for (const row of filteredRows) {
      const category = row.command.category ?? "General";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      const group = groups.get(category);
      if (group) {
        group.push(row);
      }
    }

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      items: items.sort((left, right) =>
        left.command.label.localeCompare(right.command.label),
      ),
    }));
  }, [filteredRows]);

  return (
    <div className="space-y-4">
      {recordingCommandId ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2 text-xs">
          Recording shortcut for <strong>{recordingCommandId}</strong>. Press a key combination, or press Esc to cancel.
        </div>
      ) : null}
      <Input
        placeholder="Filter by command or keybinding…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <ScrollArea className="max-h-[560px] rounded border">
        <div className="divide-y">
          {grouped.map(({ category, items }) => (
            <section key={category} className="p-4">
              <header className="flex items-center justify-between pb-2">
                <h3 className="text-xs font-semibold">{category}</h3>
                <Badge variant="secondary">{items.length}</Badge>
              </header>
              <div className="space-y-2">
                {items.map((row) => {
                  const isRecording = recordingCommandId === row.command.id;
                  return (
                    <div
                      key={row.command.id}
                      className="flex items-center justify-between rounded border border-transparent px-2 py-2 hover:border-border"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-medium">
                          {row.command.label}
                        </span>
                        {row.command.description ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {row.command.description}
                          </span>
                        ) : null}
                      </div>

                      <div className="ml-3 flex items-center gap-2">
                        {row.keybinding?.resolvedLabel ? (
                          <div className="flex items-center gap-1">
                            {row.keybinding.resolvedLabel.split(" ").map((chord, chordIndex) => (
                              <Kbd key={`${row.command.id}-chord-${chordIndex}`}>{chord}</Kbd>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                        <Button
                          size="sm"
                          variant={isRecording ? "secondary" : "outline"}
                          onClick={() => {
                            onStartRecording(row.command.id);
                          }}
                        >
                          {isRecording ? "Recording…" : "Record"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onUnbind(row);
                          }}
                          disabled={!row.keybinding}
                        >
                          Unbind
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onReset(row.command.id);
                          }}
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {grouped.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
              No commands match this filter.
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export function KeyboardShortcutsHelp({
  embedded = false,
}: KeyboardShortcutsHelpProps): React.JSX.Element {
  const { keyboardShortcutsOpen, setKeyboardShortcutsOpen } = useDialogStore();
  const { commandService, keybindingService } = useKeyboardServices();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ShortcutRow[]>([]);
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(null);

  useEffect(() => {
    const updateShortcuts = () => {
      const commands = commandService.list();
      const keybindings = keybindingService.list();
      setRows(
        commands.map((command) => ({
          command,
          keybinding: pickBestKeybinding(command.id, keybindings),
        })),
      );
    };

    updateShortcuts();

    const disposers = [
      commandService.onDidRegister(() => {
        updateShortcuts();
      }),
      commandService.onDidUnregister(() => {
        updateShortcuts();
      }),
      keybindingService.onDidRegister(updateShortcuts),
      keybindingService.onDidUnregister(updateShortcuts),
      keybindingService.onDidChange(updateShortcuts),
      userKeybindingsService.onDidChange(() => {
        updateShortcuts();
      }),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [commandService, keybindingService]);

  useEffect(() => {
    if (!recordingCommandId) return;

    const row = rows.find((candidate) => candidate.command.id === recordingCommandId);
    if (!row) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecordingCommandId(null);
        return;
      }

      if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) {
        return;
      }

      const keybindingInput = keyboardEventToKeybindingInput(event);
      if (!keybindingInput) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      userKeybindingsService.upsert({
        command: row.command.id,
        key: keybindingInput,
        when: row.command.when,
      });
      setRecordingCommandId(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [recordingCommandId, rows]);

  const handleStartRecording = (commandId: string) => {
    setRecordingCommandId((current) => (current === commandId ? null : commandId));
  };

  const handleReset = (commandId: string) => {
    userKeybindingsService.resetCommand(commandId);
    if (recordingCommandId === commandId) {
      setRecordingCommandId(null);
    }
  };

  const handleUnbind = (row: ShortcutRow) => {
    if (!row.keybinding) return;
    const payload: KeybindingSerialization = {
      command: `-${row.command.id}`,
      key: row.keybinding.key,
      when: row.keybinding.when,
    };
    userKeybindingsService.upsert(payload);
  };

  const content = (
    <KeyboardShortcutsContent
      rows={rows}
      query={query}
      setQuery={setQuery}
      recordingCommandId={recordingCommandId}
      onStartRecording={handleStartRecording}
      onReset={handleReset}
      onUnbind={handleUnbind}
    />
  );

  if (embedded) {
    return content;
  }

  return (
    <Dialog
      open={keyboardShortcutsOpen}
      onOpenChange={(open) => {
        if (!open) {
          setRecordingCommandId(null);
        }
        setKeyboardShortcutsOpen(open);
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Record, unbind, and reset shortcuts. User keybindings override defaults.
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
