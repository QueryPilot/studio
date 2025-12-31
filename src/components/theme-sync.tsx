import { useEffect } from "react";

import { useTheme } from "@/components/theme-provider";
import { useAppStore } from "@/stores/appStore";

export function ThemeSync(): null {
  const appTheme = useAppStore((state) => state.theme);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (appTheme !== theme) {
      setTheme(appTheme);
    }
  }, [appTheme, theme, setTheme]);

  return null;
}
