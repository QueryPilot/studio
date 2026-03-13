import {
  IconSettings,
  IconMoon,
  IconSun,
  IconRotate,
  IconLoader2,
} from "@tabler/icons-react";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { cn } from "@/lib/utils";
import { openAppUpdateDialog } from "@/utils/appUpdate";

export function ActionBarFooter() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const pendingUpdate = useAppStore((state) => state.pendingUpdate);
  const isDownloadingUpdate = useAppStore((state) => state.isDownloadingUpdate);
  const isInstallingUpdate = useAppStore((state) => state.isInstallingUpdate);
  const { openPreferences } = usePreferencesStore();
  const isUpdateBusy = isDownloadingUpdate || isInstallingUpdate;

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const buttonClass = cn(
    "flex items-center gap-2 w-full px-3 py-2 rounded-md",
    "text-xs text-muted-foreground",
    "hover:text-foreground hover:bg-foreground/8",
    "transition-colors duration-150",
  );

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {pendingUpdate && (
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 mb-0.5 rounded-full running-border running-border--primary/30 text-xs font-medium text-primary dark:text-primary transition-opacity",
            isUpdateBusy
              ? "opacity-50 cursor-not-allowed"
              : "cursor-pointer hover:opacity-80",
          )}
          onClick={() => {
            openAppUpdateDialog();
          }}
          disabled={isUpdateBusy}
        >
          {isUpdateBusy ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconRotate className="h-3.5 w-3.5" />
          )}
          <span>
            {isUpdateBusy
              ? "Updating…"
              : pendingUpdate.downloaded
                ? `Restart to update v${pendingUpdate.version}`
                : `New version v${pendingUpdate.version}`}
          </span>
        </button>
      )}

      <button type="button" className={buttonClass} onClick={handleToggleTheme}>
        {theme === "dark" ? (
          <IconSun className="h-4 w-4" />
        ) : (
          <IconMoon className="h-4 w-4" />
        )}
        <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          openPreferences();
        }}
      >
        <IconSettings className="h-4 w-4" />
        <span>Settings</span>
      </button>
    </div>
  );
}
