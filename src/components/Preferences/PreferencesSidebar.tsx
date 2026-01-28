import { cn } from "@/lib/utils";
import {
  usePreferencesStore,
  type PreferenceCategory,
} from "@/stores/preferencesStore";
import {
  IconSettings,
  IconCode,
  IconKeyboard,
  IconWorld,
  IconActivity,
} from "@tabler/icons-react";

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
    <div className="pt-10 w-64 bg-secondary flex flex-col overflow-hidden h-full">
      <nav className="flex-1 p-3 space-y-1 overflow-y-scroll h-full border-none">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              onClick={() => {
                setActiveCategory(category.id);
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg transition-all",
                "border-l-2 border-l-transparent rounded-l-none hover:bg-primary/20 hover:text-primary hover:border-l-primary ",
                {
                  "bg-primary/20 text-primary font-medium border-l-primary":
                    activeCategory === category.id,
                  "text-muted-foreground hover:text-foreground":
                    activeCategory !== category.id,
                },
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
