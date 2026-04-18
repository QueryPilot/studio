import { cn } from "@/lib/utils";

interface PrimaryBadgeProps {
  className?: string;
}

export function PrimaryBadge({ className }: PrimaryBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        className,
      )}
      aria-label="Primary schema"
    >
      PRIMARY
    </span>
  );
}
