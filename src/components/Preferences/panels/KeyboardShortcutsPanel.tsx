import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp/KeyboardShortcutsHelp";

export default function KeyboardShortcutsPanel() {
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-background pb-2">
        <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
        <p className="text-xs text-muted-foreground">
          Customize command keybindings. User keybindings override defaults.
        </p>
      </div>
      <KeyboardShortcutsHelp embedded />
    </div>
  );
}
