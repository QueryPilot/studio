import React, { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useKeyboardServices } from "@/components/KeyboardProvider";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { type CommandDescriptor } from "@/types/command";
import { type ResolvedKeybinding } from "@/types/keybinding";

interface ShortcutRow {
  command: CommandDescriptor;
  keybinding?: ResolvedKeybinding;
}

export function KeyboardShortcutsHelp(): React.JSX.Element {
  const { keyboardShortcutsOpen, setKeyboardShortcutsOpen } = useDialogStore();
  const { commandService, keybindingService } = useKeyboardServices();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ShortcutRow[]>([]);
  const [version, setVersion] = useState(0);

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
      keybindingService.onDidRegister(() => {
        setVersion((value) => value + 1);
      }),
      keybindingService.onDidUnregister(() => {
        setVersion((value) => value + 1);
      }),
      keybindingService.onDidChange(() => {
        setVersion((value) => value + 1);
      }),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [commandService, keybindingService]);

  useEffect(() => {
    if (version === 0) {
      return;
    }

    const keybindings = keybindingService.list();
    setRows((current) =>
      current.map((row) => ({
        ...row,
        keybinding: pickBestKeybinding(row.command.id, keybindings),
      })),
    );
  }, [version, keybindingService]);

  const filteredRows = useMemo(() => {
    if (!query) {
      return rows;
    }

    const lower = query.toLowerCase();
    return rows.filter((row) => {
      const label = row.command.label.toLowerCase() || "";
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
      const categoryGroup = groups.get(category);
      if (categoryGroup) {
        categoryGroup.push(row);
      }
    }

    return Array.from(groups.entries()).map(
      ([category, items]: [string, ShortcutRow[]]): {
        category: string;
        items: ShortcutRow[];
      } => ({
        category,
        items: items.sort((left: ShortcutRow, right: ShortcutRow) =>
          left.command.label.localeCompare(right.command.label),
        ),
      }),
    );
  }, [filteredRows]);

  return (
    <Dialog
      open={keyboardShortcutsOpen}
      onOpenChange={setKeyboardShortcutsOpen}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick reference for commands and keybindings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            placeholder="Filter by command or keybinding…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <ScrollArea className="max-h-[500px] rounded border">
            <div className="divide-y">
              {grouped.map(({ category, items }) => (
                <section key={category} className="p-4">
                  <header className="flex items-center justify-between pb-2">
                    <h3 className="text-sm font-semibold">{category}</h3>
                    <Badge variant="secondary">{items.length}</Badge>
                  </header>
                  <div className="space-y-2">
                    {items.map((row: ShortcutRow) => (
                      <div
                        key={row.command.id}
                        className="flex items-center justify-between rounded border border-transparent px-2 py-1.5 hover:border-border"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {row.command.label}
                          </span>
                          {row.command.description ? (
                            <span className="text-xs text-muted-foreground">
                              {row.command.description}
                            </span>
                          ) : null}
                        </div>
                        {row.keybinding?.resolvedLabel ? (
                          <KbdGroup>
                            {row.keybinding.resolvedLabel.split('+').map((key, index) => (
                              <Kbd key={index}>{key.trim()}</Kbd>
                            ))}
                          </KbdGroup>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {grouped.length === 0 ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  No commands match this filter.
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
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
