import { IconChevronRight, IconHome } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
  path: string[];
  onNavigate: (path: string[]) => void;
  className?: string;
}

export function Breadcrumb({ path, onNavigate, className }: BreadcrumbProps) {
  return (
    <div className={cn("flex items-center text-sm text-muted-foreground", className)}>
      <button
        onClick={() => onNavigate([])}
        className="hover:text-foreground flex items-center transition-colors"
      >
        <IconHome className="h-4 w-4 mr-1" />
        root
      </button>
      {path.map((segment, index) => (
        <div key={index} className="flex items-center">
          <IconChevronRight className="h-4 w-4 mx-1" />
          <button
            onClick={() => onNavigate(path.slice(0, index + 1))}
            className="hover:text-foreground transition-colors"
          >
            {segment}
          </button>
        </div>
      ))}
    </div>
  );
}
