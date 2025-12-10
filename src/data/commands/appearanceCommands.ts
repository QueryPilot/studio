import { type Command } from "@/types/command";
import { useAppStore } from "@/stores/appStore";
import { toast } from "sonner";

export const appearanceCommands: Command[] = [
  {
    id: "appearance.toggleTheme",
    label: "Toggle Theme",
    category: "Appearance",
    description: "Switch between light and dark mode",
    handler: () => {
      const store = useAppStore.getState();
      const currentTheme = store.theme;

      // Cycle through: light -> dark -> system -> light
      const nextTheme =
        currentTheme === "light"
          ? "dark"
          : currentTheme === "dark"
            ? "system"
            : "light";

      store.setTheme(nextTheme);
      toast.success(`Theme: ${nextTheme}`);
    },
  },
  {
    id: "appearance.setThemeLight",
    label: "Set Light Theme",
    category: "Appearance",
    handler: () => {
      useAppStore.getState().setTheme("light");
      toast.success("Light theme enabled");
    },
  },
  {
    id: "appearance.setThemeDark",
    label: "Set Dark Theme",
    category: "Appearance",
    handler: () => {
      useAppStore.getState().setTheme("dark");
      toast.success("Dark theme enabled");
    },
  },
  {
    id: "appearance.setThemeSystem",
    label: "Use System Theme",
    category: "Appearance",
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
