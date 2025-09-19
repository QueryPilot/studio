import { memo, useEffect, useState, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/databaseService";

interface IndexTypeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  connectionId?: string;
  isEditing?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "default" | "small";
}

// Simple in-memory cache for index types per connection
const IndexTypeCache = new Map<
  string,
  Array<{ value: string; label: string }>
>();

// Clear cache after 5 minutes to allow for database changes
setInterval(() => {
  IndexTypeCache.clear();
}, 5 * 60 * 1000);

// Clear cache on module load to ensure fresh data
IndexTypeCache.clear();

const formatIndexType = (type: string): string => {
  // Format database index type names to be more readable
  switch (type.toLowerCase()) {
    case "btree":
      return "B-Tree";
    case "hash":
      return "Hash";
    case "gin":
      return "GIN";
    case "gist":
      return "GiST";
    case "spgist":
      return "SP-GiST";
    case "brin":
      return "BRIN";
    case "bloom":
      return "Bloom";
    default:
      return type.toUpperCase();
  }
};

export const IndexTypeSelector = memo(function IndexTypeSelector({
  value,
  onChange,
  connectionId,
  isEditing = false,
  disabled = false,
  className,
  size = "default",
}: IndexTypeSelectorProps) {
  const [indexTypes, setIndexTypes] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const cacheKeyRef = useRef<string | null>(null);

  // Load index types from database (source of truth)
  // Always load when we have a connectionId, not just when editing
  useEffect(() => {
    if (
      connectionId &&
      connectionId !== cacheKeyRef.current &&
      !isLoading
    ) {
      setIsLoading(true);
      cacheKeyRef.current = connectionId;

      // Check cache first
      const cachedTypes = IndexTypeCache.get(connectionId);
      if (cachedTypes) {
        setIndexTypes(cachedTypes);
        setIsLoading(false);
        return;
      }

      // Load from database - this is the source of truth
      databaseService
        .getSupportedIndexTypes(connectionId)
        .then((types) => {
          const formattedTypes = types.map((type) => ({
            value: type,
            label: formatIndexType(type),
          }));
          setIndexTypes(formattedTypes);
          // Cache the result
          IndexTypeCache.set(connectionId, formattedTypes);
        })
        .catch((err: unknown) => {
          console.error(
            "[IndexTypeSelector] Failed to load index types from database:",
            err,
          );
          // On error, show minimal default
          const defaultTypes = [{ value: "btree", label: "B-Tree" }];
          setIndexTypes(defaultTypes);
          IndexTypeCache.set(connectionId, defaultTypes);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [connectionId, isLoading]);

  // Always show the select component, just disable it when not editing
  // This maintains consistent UI for all rows including primary keys

  return (
    <Select
      value={value.toLowerCase()}
      onValueChange={onChange}
      disabled={disabled || !isEditing}
    >
      <SelectTrigger
        className={cn(
          "text-xs text-foreground/80 dark:text-foreground/70 border-0 bg-transparent",
          isEditing && !disabled && "hover:bg-muted/50",
          disabled && "opacity-60 cursor-not-allowed",
          size === "small" ? "!h-6 !px-1.5 !py-0.5" : "!px-2 !py-1",
          className,
        )}
      >
        <SelectValue placeholder="Select type" />
      </SelectTrigger>
      <SelectContent className="py-1">
        {indexTypes.map((type) => (
          <SelectItem
            key={type.value}
            value={type.value}
            className="text-xs py-1 px-2 outline-none"
          >
            {type.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
