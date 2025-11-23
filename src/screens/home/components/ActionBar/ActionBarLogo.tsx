import { useHomeScreenStore } from "../../store/homeScreenStore";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

export function ActionBarLogo() {
  const setContentMode = useHomeScreenStore((s) => s.setContentMode);
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
  };

  return (
    <div
      className="flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors p-4"
      onClick={handleClick}
    >
      <img src="/logo.png" alt="Query Pilot" className="rounded-lg h-16 w-16" />
      <div className="flex flex-col items-start min-w-0">
        <span className="text-lg font-semibold truncate">Query Pilot</span>
        {version && (
          <span className="text-xs text-muted-foreground">v{version}</span>
        )}
      </div>
    </div>
  );
}
