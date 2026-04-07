import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@/utils/tauri";
import { platform } from "@tauri-apps/plugin-os";

/**
 * Windows-only custom window controls (minimize, maximize/restore, close).
 * Renders nothing on macOS/Linux since they use native decorations.
 */
export function WindowControls() {
  const isWin = isTauri() && platform() === "windows";
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWin) return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());

      const { listen } = await import("@tauri-apps/api/event");
      const u1 = await listen("tauri://resize", async () => {
        setMaximized(await win.isMaximized());
      });
      unlisten = u1;
    };
    void setup();

    return () => unlisten?.();
  }, [isWin]);

  const handleMinimize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  }, []);

  const handleClose = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  if (!isWin) return null;

  return (
    <div className="flex items-center h-full shrink-0 -mr-px">
      <button
        type="button"
        onClick={() => void handleMinimize()}
        className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-foreground/8 transition-colors"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" className="fill-foreground">
          <rect width="10" height="1" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => void handleMaximize()}
        className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-foreground/8 transition-colors"
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" className="fill-none stroke-foreground">
            <path d="M3 0.5h6.5v6.5M0.5 3h6.5v6.5H0.5z" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" className="fill-none stroke-foreground">
            <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => void handleClose()}
        className="inline-flex items-center justify-center w-[46px] h-8 hover:bg-[#c42b1c] hover:text-white transition-colors"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="stroke-current">
          <path d="M1 1l8 8M9 1l-8 8" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
