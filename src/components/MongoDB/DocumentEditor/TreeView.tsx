import { useState } from "react";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface TreeViewProps {
  data: unknown;
  label?: string; // key or index
  level?: number;
  path?: string[];
  onExpand?: (path: string[], expanded: boolean) => void;
}

export function TreeView({
  data,
  label,
  level = 0,
  path = [],
}: TreeViewProps) {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Default expand top levels

  const isObject = data !== null && typeof data === "object";
  const isArray = Array.isArray(data);
  const isEmpty = isObject && Object.keys(data as object).length === 0;
  
  const renderValue = (val: unknown) => {
    if (val === null) return <span className="text-muted-foreground">null</span>;
    if (val === undefined) return <span className="text-muted-foreground">undefined</span>;
    if (typeof val === "string") return <span className="text-green-600 dark:text-green-400">"{val}"</span>;
    if (typeof val === "number") return <span className="text-blue-600 dark:text-blue-400">{val}</span>;
    if (typeof val === "boolean") return <span className="text-purple-600 dark:text-purple-400">{val ? "true" : "false"}</span>;
    return <span>{String(val)}</span>;
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  if (isObject && !isEmpty) {
    const keys = Object.keys(data as object);
    const ItemIcon = isExpanded ? IconChevronDown : IconChevronRight;

    return (
      <div className="font-mono text-sm select-text">
        <div 
          className={cn(
            "flex items-center hover:bg-muted/50 rounded px-1 cursor-pointer py-0.5",
          )}
          style={{ paddingLeft: `${level * 12 + 4}px` }}
          onClick={handleToggle}
        >
          <ItemIcon className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
          {label !== undefined && (
            <span className="mr-2 text-foreground font-medium">{label}:</span>
          )}
          <span className="text-muted-foreground text-xs">
            {isArray ? `Array(${keys.length})` : `Object{${keys.length}}`}
          </span>
        </div>
        
        {isExpanded && (
          <div>
            {keys.map((key) => (
              <TreeView
                key={key}
                label={key}
                data={(data as Record<string, unknown>)[key]}
                level={level + 1}
                path={[...path, key]}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Primitive or Empty Object
  return (
    <div 
      className="font-mono text-sm hover:bg-muted/50 rounded px-1 py-0.5 flex items-center select-text"
      style={{ paddingLeft: `${level * 12 + 4}px` }}
    >
      {/* Spacer for alignment with expandable items */}
      <span className="w-4 inline-block shrink-0" /> 
      
      {label !== undefined && (
        <span className="mr-2 text-foreground font-medium">{label}:</span>
      )}
      {isObject && isEmpty ? (
        <span className="text-muted-foreground">
          {isArray ? "[]" : "{}"}
        </span>
      ) : (
        renderValue(data)
      )}
    </div>
  );
}
