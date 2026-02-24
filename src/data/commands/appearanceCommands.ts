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
      const newLevel = Math.min(store.zoomLevel + 10, 150);
      store.setZoomLevel(newLevel);
      toast.success(`Zoom: ${newLevel}%`);
    },
  },
  {
    id: "appearance.zoomOut",
    label: "Zoom Out",
    category: "Appearance",
    handler: () => {
      const store = useAppStore.getState();
      const newLevel = Math.max(store.zoomLevel - 10, 75);
      store.setZoomLevel(newLevel);
      toast.success(`Zoom: ${newLevel}%`);
    },
  },
  {
    id: "appearance.resetZoom",
    label: "Reset Zoom",
    category: "Appearance",
    handler: () => {
      useAppStore.getState().setZoomLevel(100);
      toast.success("Zoom reset to 100%");
    },
  },
];
