import { cn } from "@/lib/utils";
import {
  usePreferencesStore,
  type PreferenceCategory,
} from "@/stores/preferencesStore";
import {
  IconSettings,
  IconKeyboard,
  IconSparkles,
  IconActivity,
  IconPlug,
  IconKey,
  IconNetwork,
} from "@tabler/icons-react";

const categories = [
  {
    id: "general" as PreferenceCategory,
    label: "General",
    icon: IconSettings,
  },
  {
    id: "shortcuts" as PreferenceCategory,
    label: "Keyboard Shortcuts",
    icon: IconKeyboard,
  },
  {
    id: "ai" as PreferenceCategory,
    label: "AI",
    icon: IconSparkles,
  },
  {
    id: "telemetry" as PreferenceCategory,
    label: "Telemetry & Reporting",
    icon: IconActivity,
  },
  {
    id: "integrations" as PreferenceCategory,
    label: "Integrations",
    icon: IconPlug,
  },
  {
    id: "auth-profiles" as PreferenceCategory,
    label: "Auth Profiles",
    icon: IconKey,
  },
  {
    id: "tunnel-profiles" as PreferenceCategory,
    label: "Tunnel Profiles",
    icon: IconNetwork,
  },
];

export function PreferencesSidebar() {
  const { activeCategory, setActiveCategory } = usePreferencesStore();

  return (
    <div className="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>
      <nav className="flex-1 px-2 pb-3 space-y-0.5">
        {categories.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              onClick={() => {
                setActiveCategory(category.id);
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs rounded-md transition-colors",
                {
                  "bg-accent text-accent-foreground font-medium":
                    activeCategory === category.id,
                  "text-muted-foreground hover:text-foreground hover:bg-accent/50":
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
