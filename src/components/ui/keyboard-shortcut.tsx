import { memo } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const keyboardShortcutVariants = cva(
  "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[10px] font-semibold font-mono rounded shadow-sm",
  {
    variants: {
      variant: {
        default:
          "bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20",
        destructive:
          "bg-destructive-foreground/10 text-destructive-foreground border border-destructive-foreground/20",
        outline: "bg-muted text-muted-foreground border border-border",
        secondary: "bg-background text-secondary-foreground border border-border",
        ghost: "bg-muted text-foreground border border-border",
        link: "bg-muted text-foreground border border-border",
      },
    },
    defaultVariants: {
      variant: "ghost",
    },
  }
);

interface KeyboardShortcutProps
  extends VariantProps<typeof keyboardShortcutVariants> {
  keys: string[];
  className?: string;
}

export const KeyboardShortcut = memo(function KeyboardShortcut({
  keys,
  variant,
  className,
}: KeyboardShortcutProps) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, index) => (
        <kbd key={index} className={keyboardShortcutVariants({ variant })}>
          {key}
        </kbd>
      ))}
    </span>
  );
});
