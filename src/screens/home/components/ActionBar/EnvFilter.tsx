import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useHomeScreenStore } from "../../store/homeScreenStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";

const ENV_FILTERS = [
  { key: "all", label: "All", color: "bg-gray-500" },
  { key: "local", label: "Local", color: "bg-gray-500" },
  { key: "dev", label: "Dev", color: "bg-blue-500" },
  { key: "staging", label: "Staging", color: "bg-yellow-500" },
  { key: "uat", label: "UAT", color: "bg-amber-600" },
  { key: "prod", label: "Prod", color: "bg-red-500" },
  { key: "test", label: "Test", color: "bg-green-500" },
];

export function EnvFilter() {
  const activeEnvFilters = useHomeScreenStore((s) => s.activeEnvFilters);
  const toggleEnvFilter = useHomeScreenStore((s) => s.toggleEnvFilter);
  const connections = useConnectionStore((s) => s.connections);

  // Calculate counts for each filter
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: connections.length };

    for (const conn of connections) {
      const tags = conn.metadata.tags;
      for (const tag of tags) {
        const lowerTag = tag.toLowerCase();
        counts[lowerTag] = (counts[lowerTag] || 0) + 1;
      }
    }

    return counts;
  }, [connections]);

  return (
    <div className="flex flex-col gap-0.5 px-1.5 py-1">
      {ENV_FILTERS.map((env) => {
        const isActive =
          env.key === "all"
            ? activeEnvFilters.includes("all")
            : activeEnvFilters.includes(env.key);

        const count = filterCounts[env.key] || 0;

        return (
          <button
            key={env.key}
            type="button"
            className={cn(
              "group flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-left",
              "transition-all duration-150 ease-out",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-foreground/6",
              isActive && "bg-foreground/8 text-foreground"
            )}
            onClick={() => {
              toggleEnvFilter(env.key);
            }}
          >
            <div
              className={cn(
                "h-2 w-2 rounded-full transition-all duration-150",
                env.color,
                "group-hover:scale-110",
                isActive && "scale-125"
              )}
            />
            <span
              className={cn(
                "flex-1 transition-all duration-150",
                "text-xs",
                isActive && "font-medium"
              )}
            >
              {env.label}
            </span>
            {count > 0 && (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                  "transition-all duration-150",
                  isActive
                    ? "bg-foreground/10 text-foreground font-medium"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
