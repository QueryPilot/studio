import { createElement } from "react";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { toast } from "sonner";

import { useAppStore } from "@/stores/appStore";
import { type Command } from "@/types/command";

export const appearanceCommands: Command[] = [
  {
    id: "appearance.setThemeLight",
    label: "Light",
    category: "Appearance",
    description: "Switch to the light theme",
    icon: createElement(IconSun, { className: "text-amber-500" }),
    metadata: { paletteGroup: "Theme" },
    handler: () => {
      useAppStore.getState().setTheme("light");
      toast.success("Light theme enabled");
    },
  },
  {
    id: "appearance.setThemeDark",
    label: "Dark",
    category: "Appearance",
    description: "Switch to the dark theme",
    icon: createElement(IconMoon, { className: "text-indigo-400" }),
    metadata: { paletteGroup: "Theme" },
    handler: () => {
      useAppStore.getState().setTheme("dark");
      toast.success("Dark theme enabled");
    },
  },
  {
    id: "appearance.setThemeSystem",
    label: "System",
    category: "Appearance",
    description: "Match the system theme",
    icon: createElement(IconDeviceDesktop, {
      className: "text-muted-foreground",
    }),
    metadata: { paletteGroup: "Theme" },
    handler: () => {
      useAppStore.getState().setTheme("system");
      toast.success("Using system theme");
    },
  },
  {
    id: "appearance.zoomIn",
    label: "Zoom In",
    category: "Appearance",
    handler: () => {
      const store = useAppStore.getState();
      const currentSize = store.preferences.fontSize;
      const newSize = Math.min(currentSize + 1, 24);
      store.updatePreferences({ fontSize: newSize });
      toast.success(`Font size: ${newSize}px`);
    },
  },
  {
    id: "appearance.zoomOut",
    label: "Zoom Out",
    category: "Appearance",
    handler: () => {
      const store = useAppStore.getState();
      const currentSize = store.preferences.fontSize;
      const newSize = Math.max(currentSize - 1, 10);
      store.updatePreferences({ fontSize: newSize });
      toast.success(`Font size: ${newSize}px`);
    },
  },
  {
    id: "appearance.resetZoom",
    label: "Reset Zoom",
    category: "Appearance",
    handler: () => {
      useAppStore.getState().updatePreferences({ fontSize: 14 });
      toast.success("Font size reset to 14px");
    },
  },
];
