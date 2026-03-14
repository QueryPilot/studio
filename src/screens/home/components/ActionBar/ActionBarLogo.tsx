import { useHomeScreenStore } from "../../store/homeScreenStore";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

export function ActionBarLogo() {
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);
  const setSearchQuery = useHomeScreenStore((s) => s.setSearchQuery);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {
        setVersion("");
      });
  }, []);

  const handleClick = () => {
    setContentMode("browse");
    setSearchQuery("");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-3 px-4 py-3 text-left rounded-lg hover:bg-foreground/6 active:bg-foreground/10 transition-colors duration-150"
    >
      <img src="/logo.png" alt="Query Pilot" className="rounded-lg h-10 w-10" />
      <div className="flex flex-col items-start min-w-0">
        <span className="text-base font-semibold truncate">Query Pilot</span>
        {version && (
          <span className="text-[11px] text-muted-foreground">v{version}</span>
        )}
      </div>
    </button>
  );
}
