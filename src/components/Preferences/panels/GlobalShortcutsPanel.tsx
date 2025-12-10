import { logger } from "@/lib/logger";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getGlobalShortcutManager } from "@/services/globalShortcuts";
import { isTauri } from "@/utils/tauri";
import { toast } from "sonner";
import {
  IconKeyboard,
  IconInfoCircle,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function GlobalShortcutsPanel() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [defaultShortcut, setDefaultShortcut] = useState("");
  const [customShortcut, setCustomShortcut] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keydownHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  const manager = getGlobalShortcutManager();

  // Cleanup recording timeout and listener on unmount
  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (keydownHandlerRef.current) {
        window.removeEventListener("keydown", keydownHandlerRef.current, true);
      }
    };
  }, []);

  useEffect(() => {
    const checkTauri = async () => {
      const enabled = isTauri();
      setIsEnabled(enabled);

      if (enabled) {
        await manager.initialize();
        const defaultKey = manager.getDefaultShowShortcut();
        setDefaultShortcut(defaultKey);
        setCustomShortcut(defaultKey);

        // IconCheck if default shortcut is registered
        const registered = await manager.isRegistered(defaultKey);
        setIsRegistered(registered);
      }
    };

    void checkTauri();
  }, []);

  const handleRegisterShortcut = async () => {
    if (!customShortcut) {
      toast.error("Please enter a shortcut");
      return;
    }

    if (!manager.validateShortcut(customShortcut)) {
      toast.error(
        "Invalid shortcut format. Must include at least one modifier key.",
      );
      return;
    }

    try {
      // Unregister old shortcut if exists
      if (isRegistered && defaultShortcut !== customShortcut) {
        await manager.unregister(defaultShortcut);
      }

      // Register new shortcut
      const success = await manager.register({
        shortcut: customShortcut,
        description: "Show/activate Query Pilot",
        handler: () => {
          // The handler is in Rust, this is just for tracking
          logger.info("Global shortcut triggered:", customShortcut);
        },
      });

      if (success) {
        setIsRegistered(true);
        setDefaultShortcut(customShortcut);
        toast.success(
          `Global shortcut registered: ${manager.formatShortcutForDisplay(
            customShortcut,
          )}`,
        );
      } else {
        toast.error(
          "Failed to register shortcut. It may already be in use by another application.",
        );
      }
    } catch (error) {
      logger.error("Failed to register global shortcut:", error);
      toast.error("Failed to register shortcut");
    }
  };

  const handleUnregisterShortcut = async () => {
    try {
      await manager.unregister(defaultShortcut);
      setIsRegistered(false);
      toast.success("Global shortcut unregistered");
    } catch (error) {
      logger.error("Failed to unregister global shortcut:", error);
      toast.error("Failed to unregister shortcut");
    }
  };

  const handleResetToDefault = () => {
    const defaultKey = manager.getDefaultShowShortcut();
    setCustomShortcut(defaultKey);
  };

  const startRecording = () => {
    // Clear any existing timeout/listener
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
    }
    if (keydownHandlerRef.current) {
      window.removeEventListener("keydown", keydownHandlerRef.current, true);
    }

    setIsRecording(true);
    toast.info("Press a key combination...");

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const modifiers: string[] = [];
      if (e.metaKey || e.ctrlKey) modifiers.push("CommandOrControl");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.altKey) modifiers.push("Alt");

      // Get the main key (not a modifier)
      const key = e.key;
      if (!["Meta", "Control", "Shift", "Alt"].includes(key)) {
        const shortcut = [...modifiers, key.toUpperCase()].join("+");
        setCustomShortcut(shortcut);
        setIsRecording(false);
        window.removeEventListener("keydown", handleKeyDown, true);
        keydownHandlerRef.current = null;
        if (recordingTimeoutRef.current) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
      }
    };

    keydownHandlerRef.current = handleKeyDown;
    window.addEventListener("keydown", handleKeyDown, true);

    // Auto-cancel after 5 seconds
    recordingTimeoutRef.current = setTimeout(() => {
      setIsRecording(false);
      if (keydownHandlerRef.current) {
        window.removeEventListener("keydown", keydownHandlerRef.current, true);
        keydownHandlerRef.current = null;
      }
      recordingTimeoutRef.current = null;
      toast.info("Recording cancelled");
    }, 5000);
  };

  if (!isEnabled) {
    return (
      <div className="space-y-4">
        <Alert>
          <IconAlertCircle className="h-4 w-4" />
          <AlertTitle>Not Available</AlertTitle>
          <AlertDescription>
            Global shortcuts are only available in the desktop application.
            Please use the Tauri desktop build to enable this feature.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(100vh - 32px)] overflow-y-scroll -mx-4 px-4">
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">Global Shortcuts</h2>
        <p className="text-xs text-muted-foreground">
          Configure system-wide keyboard shortcuts that work even when the app
          is in the background.
        </p>
      </div>

      <Alert>
        <IconInfoCircle className="h-4 w-4" />
        <AlertTitle>How it works</AlertTitle>
        <AlertDescription>
          Global shortcuts allow you to activate Query Pilot from any
          application. Press the shortcut to show and focus the window, even
          when minimized.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconKeyboard className="h-5 w-5" />
            Show/Activate Window
          </CardTitle>
          <CardDescription>
            Press this shortcut from any application to show Query Pilot
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="global-shortcut">Shortcut</Label>
            <div className="flex gap-2">
              <Input
                id="global-shortcut"
                value={customShortcut}
                onChange={(e) => {
                  setCustomShortcut(e.target.value);
                }}
                placeholder="CommandOrControl+Shift+Space"
                className="font-mono"
                disabled={isRecording}
              />
              <Button
                variant="outline"
                onClick={startRecording}
                disabled={isRecording}
              >
                {isRecording ? "Recording..." : "Record"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Display: {manager.formatShortcutForDisplay(customShortcut)}
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleRegisterShortcut} disabled={isRecording}>
              {isRegistered ? "Update Shortcut" : "Register Shortcut"}
            </Button>

            {isRegistered && (
              <Button
                variant="outline"
                onClick={handleUnregisterShortcut}
                disabled={isRecording}
              >
                Unregister
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={handleResetToDefault}
              disabled={isRecording}
            >
              Reset to Default
            </Button>
          </div>

          {isRegistered && (
            <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <IconInfoCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-600 dark:text-green-400">
                Active
              </AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                Global shortcut is registered and active:{" "}
                {manager.formatShortcutForDisplay(defaultShortcut)}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shortcut Format</CardTitle>
          <CardDescription>How to write custom shortcuts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm space-y-1">
            <p>
              <strong>Modifiers:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">
                  CommandOrControl
                </code>{" "}
                - Cmd on Mac, Ctrl on Windows/Linux
              </li>
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">Shift</code> -
                Shift key
              </li>
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">Alt</code> -
                Alt/Option key
              </li>
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">Super</code> -
                Windows/Super key
              </li>
            </ul>
          </div>

          <div className="text-sm space-y-1 pt-2">
            <p>
              <strong>Examples:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">
                  CommandOrControl+Shift+Space
                </code>
              </li>
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">
                  CommandOrControl+Alt+D
                </code>
              </li>
              <li>
                <code className="bg-muted px-1 py-0.5 rounded">
                  Shift+Alt+Q
                </code>
              </li>
            </ul>
          </div>

          <div className="text-sm space-y-1 pt-2">
            <p className="text-yellow-600 dark:text-yellow-400">
              <strong>⚠️ Important:</strong> Avoid shortcuts already used by
              your operating system or other applications.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
