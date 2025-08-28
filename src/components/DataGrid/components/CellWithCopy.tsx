import { memo } from "react";
import { Clipboard, ClipboardCheck } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";

interface CellWithCopyProps {
  children: React.ReactNode;
  value: string;
  className?: string;
}

export const CellWithCopy = memo(function CellWithCopy({
  children,
  value,
  className,
}: CellWithCopyProps) {
  const { copy, isCopied } = useCopy();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copy(value);
  };

  return (
    <div className={cn("relative group flex items-center", className)} style={{ pointerEvents: 'none' }}>
      <div className="flex-1 min-w-0 transition-all duration-200 ease-out" style={{ pointerEvents: 'none' }}>
        {children}
      </div>
      <button
        onClick={handleCopy}
        className={cn(
          "p-0.5 rounded hover:bg-muted/50 flex-shrink-0",
          "transition-all delay-300 duration-200 ease-out",
          "w-6 -mr-6 opacity-0 group-hover:opacity-100 group-hover:-mr-2 overflow-hidden",
        )}
        style={{ pointerEvents: 'auto' }}
        title={isCopied ? "Copied!" : "Copy to clipboard"}
        tabIndex={-1}
        aria-label={isCopied ? "Copied!" : "Copy to clipboard"}
        type="button"
      >
        {isCopied ? (
          <ClipboardCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <Clipboard className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground/70" />
        )}
      </button>
    </div>
  );
});
