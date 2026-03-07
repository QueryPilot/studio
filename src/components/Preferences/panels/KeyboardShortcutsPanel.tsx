import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { commandService } from "@/services/commandService";
import { keybindingService } from "@/services/keybindingService";
import { userKeybindingsService } from "@/services/userKeybindingsService";
import { keyboardEventToKeybindingInput } from "@/lib/keyboardDispatch";
import { type CommandDescriptor } from "@/types/command";
import {
  type KeybindingSerialization,
  type ResolvedKeybinding,
} from "@/types/keybinding";
import {
  IconCircleDot,
  IconX,
  IconArrowBackUp,
  IconSearch,
} from "@tabler/icons-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShortcutRow {
  command: CommandDescriptor;
  keybinding?: ResolvedKeybinding;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickBestKeybinding(
  commandId: string,
  bindings: ResolvedKeybinding[],
): ResolvedKeybinding | undefined {
  const matches = bindings.filter((binding) => binding.command === commandId);
  if (matches.length === 0) return undefined;
  return matches.sort((left, right) => right.weight - left.weight)[0];
}

// ---------------------------------------------------------------------------
// In-app shortcuts list (no search — search is in the parent sticky header)
// ---------------------------------------------------------------------------

function InAppShortcutsList({ query }: { query: string }) {
  const [rows, setRows] = useState<ShortcutRow[]>([]);
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(
    null,
  );

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
  }, []);

  // Recording key listener
  useEffect(() => {
    if (!recordingCommandId) return;

    const row = rows.find(
      (candidate) => candidate.command.id === recordingCommandId,
    );
    if (!row) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecordingCommandId(null);
        return;
      }

      if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) return;

      const keybindingInput = keyboardEventToKeybindingInput(event);
      if (!keybindingInput) return;

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
    setRecordingCommandId((current) =>
      current === commandId ? null : commandId,
    );
  };

  const handleReset = (commandId: string) => {
    userKeybindingsService.resetCommand(commandId);
    if (recordingCommandId === commandId) setRecordingCommandId(null);
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

  const filteredRows = useMemo(() => {
    if (!query) return rows;
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
      if (!groups.has(category)) groups.set(category, []);
      const group = groups.get(category);
      if (group) group.push(row);
    }
    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      items: items.sort((left, right) =>
        left.command.label.localeCompare(right.command.label),
      ),
    }));
  }, [filteredRows]);

  return (
    <div className="space-y-3">
      {recordingCommandId ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs flex items-center gap-2">
          <IconCircleDot className="size-3 text-primary animate-pulse" />
          Recording shortcut for{" "}
          <strong className="text-primary">{recordingCommandId}</strong>
          <span className="text-muted-foreground">
            — Press a key combination, or Esc to cancel
          </span>
        </div>
      ) : null}

      <div className="rounded-md border overflow-y-auto max-h-[calc(100vh-155px)]">
        {grouped.map(({ category, items }, groupIndex) => (
          <section key={category}>
            {groupIndex > 0 && <div className="border-t" />}
            <header className="flex items-center justify-between px-3 py-1.5 bg-muted/50 backdrop-blur-md sticky top-0 z-10">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {category}
              </span>
              <Badge
                variant="secondary"
                className="h-4 min-w-4 px-1 text-[10px]"
              >
                {items.length}
              </Badge>
            </header>
            <div>
              {items.map((row) => {
                const isRecording = recordingCommandId === row.command.id;
                return (
                  <div
                    key={row.command.id}
                    className="group/row flex items-center h-8 px-3 border-t first:border-t-0 border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    {/* Command name */}
                    <div className="flex-1 min-w-0 mr-3">
                      <span className="text-xs truncate block">
                        {row.command.label}
                      </span>
                    </div>

                    {/* Keybinding display — fixed width for alignment */}
                    <div className="w-28 shrink-0 flex justify-end mr-1">
                      {row.keybinding?.resolvedLabel ? (
                        <div className="flex items-center gap-0.5">
                          {row.keybinding.resolvedLabel
                            .split(" ")
                            .map((chord, chordIndex) => (
                              <Kbd
                                key={`${row.command.id}-chord-${chordIndex}`}
                              >
                                {chord}
                              </Kbd>
                            ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </div>

                    {/* Actions — visible on hover or when recording */}
                    <div
                      className={`flex items-center gap-0.5 w-[68px] shrink-0 justify-end ${
                        isRecording
                          ? "visible"
                          : "invisible group-hover/row:visible"
                      }`}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant={isRecording ? "secondary" : "ghost"}
                              onClick={() => {
                                handleStartRecording(row.command.id);
                              }}
                            />
                          }
                        >
                          <IconCircleDot className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {isRecording ? "Cancel recording" : "Record shortcut"}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => {
                                handleUnbind(row);
                              }}
                              disabled={!row.keybinding}
                            />
                          }
                        >
                          <IconX className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Remove keybinding
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => {
                                handleReset(row.command.id);
                              }}
                            />
                          }
                        >
                          <IconArrowBackUp className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Reset to default
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No commands match this filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function KeyboardShortcutsPanel() {
  const [query, setQuery] = useState("");

  return (
    <div className="-mx-10 -my-6 flex flex-col h-[calc(100vh-16px)]">
      {/* Fixed header — fills full width */}
      <div className="shrink-0 px-10 pt-6 pb-3 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
          <p className="text-xs text-muted-foreground">
            Customize command keybindings. User keybindings override defaults.
          </p>
        </div>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search commands, keybindings..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="pl-8 h-8"
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-10 pb-6">
        <InAppShortcutsList query={query} />
      </div>
    </div>
  );
}
