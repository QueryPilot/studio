import { cn } from "@/lib/utils";
import {
  usePreferencesStore,
  type PreferenceCategory,
} from "@/stores/preferencesStore";
import { IconSettings, IconCode, IconRobot, IconKeyboard, IconWorld, IconActivity } from '@tabler/icons-react';
import logo from "@/assets/logo.png";

const categories = [
  {
    id: "general" as PreferenceCategory,
    label: "General",
    icon: IconSettings,
  },
  {
    id: "editor" as PreferenceCategory,
    label: "Editor",
    icon: IconCode,
  },
  {
    id: "ai" as PreferenceCategory,
    label: "AI Runtime",
    icon: IconRobot,
  },
  {
    id: "shortcuts" as PreferenceCategory,
    label: "Keyboard Shortcuts",
    icon: IconKeyboard,
  },
  {
    id: "globalShortcuts" as PreferenceCategory,
    label: "Global Shortcuts",
    icon: IconWorld,
  },
  {
    id: "telemetry" as PreferenceCategory,
    label: "Telemetry & Reporting",
    icon: IconActivity,
  },
];

export function PreferencesSidebar() {
  const { activeCategory, setActiveCategory } = usePreferencesStore();

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col overflow-hidden max-h-[80vh]">
      <div className="p-4 border-b flex items-center gap-3">
        <img src={logo} alt="Query Pilot" className="h-8 w-8" />
        <h2 className="font-semibold text-base">Preferences</h2>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-scroll max-h-[calc(80vh-65px)]">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              onClick={() => {
                setActiveCategory(category.id);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-all",
                "hover:bg-accent/50 hover:text-accent-foreground",
                activeCategory === category.id
                  ? "bg-accent text-accent-foreground font-medium shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate text-left">{category.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
