import { cn } from "@/lib/utils";

interface ViewMode {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface ViewModeToggleProps {
  modes: ViewMode[];
  activeMode: string;
  onChange: (mode: string) => void;
}

export function ViewModeToggle({ modes, activeMode, onChange }: ViewModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-input bg-background p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          onClick={() => onChange(mode.id)}
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            activeMode === mode.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          aria-label={mode.label}
          aria-pressed={activeMode === mode.id}
        >
          {mode.icon}
          <span className="ml-1.5">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
