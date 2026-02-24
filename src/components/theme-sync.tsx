import { useEffect, useRef } from "react";

import { useTheme } from "@/components/theme-provider";
import { useAppStore } from "@/stores/appStore";

const THEME_CHANNEL = "query-pilot-theme-sync";

export function ThemeSync(): null {
  const appTheme = useAppStore((state) => state.theme);
  const setAppTheme = useAppStore((state) => state.setTheme);
  const { theme, setTheme } = useTheme();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isExternalUpdate = useRef(false);

  // Sync appStore theme to next-themes
  useEffect(() => {
    if (appTheme !== theme) {
      setTheme(appTheme);
    }
  }, [appTheme, theme, setTheme]);

  // Cross-window synchronization via BroadcastChannel
  useEffect(() => {
    // Create broadcast channel for theme sync
    const channel = new BroadcastChannel(THEME_CHANNEL);
    channelRef.current = channel;

    // Listen for theme changes from other windows
    channel.onmessage = (event) => {
      const newTheme = event.data?.theme;
      if (newTheme && newTheme !== useAppStore.getState().theme) {
        isExternalUpdate.current = true;
        setAppTheme(newTheme);
        // Reset flag after state update propagates
        requestAnimationFrame(() => {
          isExternalUpdate.current = false;
        });
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [setAppTheme]);

  // Broadcast theme changes to other windows
  useEffect(() => {
    // Don't broadcast if this was an external update (from another window)
    if (isExternalUpdate.current) return;

    channelRef.current?.postMessage({ theme: appTheme });
  }, [appTheme]);

  // Fallback: Listen for storage events (for browsers without BroadcastChannel support)
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "app-store" && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          const newTheme = parsed?.state?.theme;
          if (newTheme && newTheme !== useAppStore.getState().theme) {
            isExternalUpdate.current = true;
            setAppTheme(newTheme);
            requestAnimationFrame(() => {
              isExternalUpdate.current = false;
            });
          }
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [setAppTheme]);

  // Apply zoom level from store to the document body
  const zoomLevel = useAppStore((state) => state.zoomLevel);
  useEffect(() => {
    document.body.style.zoom = (zoomLevel / 100).toString();
  }, [zoomLevel]);

  return null;
}
