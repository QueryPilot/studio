import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { Search, RotateCcw, AlertCircle } from "lucide-react";
import { KeyboardManager } from "@/services/keyboard/KeyboardManager";

interface Shortcut {
  id: string;
  title: string;
  category: string;
  currentKeys: string;
  defaultKeys: string;
  isModified: boolean;
}

export default function ShortcutsPanel() {
  const { setUnsavedChanges } = usePreferencesStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [recordingShortcut, setRecordingShortcut] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const manager = KeyboardManager.getInstance();
    const commands = manager.getAllCommands();

    const shortcutList: Shortcut[] = commands
      .filter((cmd) => cmd.keybinding)
      .map((cmd) => ({
        id: cmd.id,
        title: cmd.title,
        category: cmd.category || "General",
        currentKeys: cmd.keybinding?.key || "",
        defaultKeys: cmd.keybinding?.key || "",
        isModified: false,
      }));

    // Add hardcoded preferences shortcut
    shortcutList.unshift({
      id: "workbench.action.openPreferences",
      title: "Open Preferences",
      category: "General",
      currentKeys: "cmd+,",
      defaultKeys: "cmd+,",
      isModified: false,
    });

    setShortcuts(shortcutList);
    setUnsavedChanges(false);
  }, []);

  const filteredShortcuts = shortcuts.filter((shortcut) => {
    const matchesSearch =
      shortcut.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      shortcut.currentKeys.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesModified = !showModifiedOnly || shortcut.isModified;
    return matchesSearch && matchesModified;
  });

  const handleRecordShortcut = (shortcutId: string) => {
    setRecordingShortcut(shortcutId);

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys = [];
      if (e.metaKey || e.ctrlKey) keys.push(e.metaKey ? "cmd" : "ctrl");
      if (e.altKey) keys.push("alt");
      if (e.shiftKey) keys.push("shift");

      if (e.key && !["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        keys.push(e.key.toLowerCase());
        const newKeyCombo = keys.join("+");

        setShortcuts(
          shortcuts.map((s) =>
            s.id === shortcutId
              ? {
                  ...s,
                  currentKeys: newKeyCombo,
                  isModified: newKeyCombo !== s.defaultKeys,
                }
              : s,
          ),
        );

        setRecordingShortcut(null);
        setUnsavedChanges(true);
        window.removeEventListener("keydown", handleKeyDown);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    setTimeout(() => {
      if (recordingShortcut === shortcutId) {
        setRecordingShortcut(null);
        window.removeEventListener("keydown", handleKeyDown);
      }
    }, 5000);
  };

  const handleResetShortcut = (shortcutId: string) => {
    setShortcuts(
      shortcuts.map((s) =>
        s.id === shortcutId
          ? { ...s, currentKeys: s.defaultKeys, isModified: false }
          : s,
      ),
    );
    setUnsavedChanges(true);
  };

  const handleResetAll = () => {
    setShortcuts(
      shortcuts.map((s) => ({
        ...s,
        currentKeys: s.defaultKeys,
        isModified: false,
      })),
    );
    setUnsavedChanges(true);
  };

  const groupedShortcuts = filteredShortcuts.reduce<Record<string, Shortcut[]>>(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Customize keyboard shortcuts for commands
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
              }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="modified-only"
              checked={showModifiedOnly}
              onCheckedChange={setShowModifiedOnly}
            />
            <Label htmlFor="modified-only" className="text-sm">
              Modified only
            </Label>
          </div>
          <Button variant="outline" onClick={handleResetAll}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All
          </Button>
        </div>

        <div className="border rounded-lg">
          {Object.entries(groupedShortcuts).map(
            ([category, categoryShortcuts]) => (
              <div key={category}>
                <div className="px-4 py-2 bg-muted/50 border-b">
                  <p className="text-sm font-medium">{category}</p>
                </div>
                <div className="divide-y">
                  {categoryShortcuts.map((shortcut) => (
                    <div
                      key={shortcut.id}
                      className="px-4 py-3 flex items-center gap-4"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{shortcut.title}</p>
                        {shortcut.id === "workbench.action.openPreferences" && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <AlertCircle className="h-3 w-3" />
                            This shortcut cannot be modified
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {recordingShortcut === shortcut.id ? (
                          <Badge
                            variant="destructive"
                            className="animate-pulse"
                          >
                            Press keys...
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              handleRecordShortcut(shortcut.id);
                            }}
                            disabled={
                              shortcut.id === "workbench.action.openPreferences"
                            }
                            className="font-mono text-xs"
                          >
                            {shortcut.currentKeys}
                          </Button>
                        )}
                        {shortcut.isModified && (
                          <>
                            <span className="text-xs text-muted-foreground">
                              (was: {shortcut.defaultKeys})
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                handleResetShortcut(shortcut.id);
                              }}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
