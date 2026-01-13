/**
 * MongoDB Document TreeView Component
 */

import { useState, useCallback } from "react";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface TreeNodeProps {
  name: string;
  value: JsonValue;
  path: string[];
  depth: number;
  onNavigate: (path: string[]) => void;
  onValueChange?: (path: string[], newValue: JsonValue) => void;
  isEditable?: boolean;
}

const getValueType = (value: JsonValue): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const getValuePreview = (value: JsonValue): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.length > 50) return `"${value.slice(0, 50)}..."`;
    return `"${value}"`;
  }
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
};

const getTypeColor = (type: string): string => {
  switch (type) {
    case "string":
      return "text-green-600 dark:text-green-400";
    case "number":
      return "text-blue-600 dark:text-blue-400";
    case "boolean":
      return "text-purple-600 dark:text-purple-400";
    case "null":
      return "text-gray-500";
    case "array":
    case "object":
      return "text-orange-600 dark:text-orange-400";
    default:
      return "text-foreground";
  }
};

export function TreeNode({
  name,
  value,
  path,
  depth,
  onNavigate,
  onValueChange,
  isEditable = false,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const valueType = getValueType(value);
  const isExpandable = valueType === "object" || valueType === "array";
  const hasChildren =
    isExpandable &&
    (Array.isArray(value) ? value.length > 0 : Object.keys(value as object).length > 0);

  const handleToggle = useCallback(() => {
    if (hasChildren) {
      setIsExpanded((prev) => !prev);
    }
  }, [hasChildren]);

  const handleDoubleClick = useCallback(() => {
    if (isEditable && !isExpandable) {
      setEditValue(
        typeof value === "string" ? value : JSON.stringify(value)
      );
      setIsEditing(true);
    }
  }, [isEditable, isExpandable, value]);

  const handleEditComplete = useCallback(() => {
    if (onValueChange) {
      try {
        const parsed =
          valueType === "string" ? editValue : JSON.parse(editValue);
        onValueChange(path, parsed);
      } catch {
        // Parsing failed - retain original value
      }
    }
    setIsEditing(false);
  }, [editValue, onValueChange, path, valueType]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleEditComplete();
      } else if (e.key === "Escape") {
        setIsEditing(false);
      }
    },
    [handleEditComplete]
  );

  const handleNameClick = useCallback(
    (e: React.MouseEvent) => {
      if (isExpandable && e.detail === 2) {
        onNavigate(path);
      }
    },
    [isExpandable, onNavigate, path]
  );

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 px-1 rounded hover:bg-accent/50 cursor-pointer",
          "font-mono text-xs"
        )}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span
          className={cn(
            "w-4 h-4 flex items-center justify-center",
            hasChildren ? "cursor-pointer" : "opacity-0"
          )}
          onClick={handleToggle}
        >
          {hasChildren &&
            (isExpanded ? (
              <IconChevronDown className="h-3 w-3" />
            ) : (
              <IconChevronRight className="h-3 w-3" />
            ))}
        </span>

        <span
          className="text-foreground font-medium"
          onClick={handleNameClick}
          title={isExpandable ? "Double-click to navigate" : undefined}
        >
          {name}
        </span>
        <span className="text-muted-foreground">:</span>

        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => { setEditValue(e.target.value); }}
            onBlur={handleEditComplete}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-background border rounded px-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
        ) : (
          <span
            className={cn("ml-1", getTypeColor(valueType))}
            onDoubleClick={handleDoubleClick}
            title={isEditable && !isExpandable ? "Double-click to edit" : undefined}
          >
            {getValuePreview(value)}
          </span>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div>
          {Array.isArray(value)
            ? value.map((item, index) => (
                <TreeNode
                  key={index}
                  name={String(index)}
                  value={item}
                  path={[...path, String(index)]}
                  depth={depth + 1}
                  onNavigate={onNavigate}
                  onValueChange={onValueChange}
                  isEditable={isEditable}
                />
              ))
            : Object.entries(value as Record<string, JsonValue>).map(
                ([key, val]) => (
                  <TreeNode
                    key={key}
                    name={key}
                    value={val}
                    path={[...path, key]}
                    depth={depth + 1}
                    onNavigate={onNavigate}
                    onValueChange={onValueChange}
                    isEditable={isEditable}
                  />
                )
              )}
        </div>
      )}
    </div>
  );
}

interface TreeViewProps {
  data: Record<string, JsonValue>;
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  onValueChange?: (path: string[], newValue: JsonValue) => void;
  isEditable?: boolean;
}

export function TreeView({
  data,
  currentPath,
  onNavigate,
  onValueChange,
  isEditable = false,
}: TreeViewProps) {
  const getDataAtPath = useCallback(
    (path: string[]): Record<string, JsonValue> => {
      let current: JsonValue = data;
      for (const key of path) {
        if (current === null || typeof current !== "object") {
          return data;
        }
        if (Array.isArray(current)) {
          const arrayItem: JsonValue | undefined = current[parseInt(key, 10)];
          if (arrayItem === undefined) return data;
          current = arrayItem;
        } else {
          const objectItem: JsonValue | undefined = (current as Record<string, JsonValue>)[key];
          if (objectItem === undefined) return data;
          current = objectItem;
        }
      }
      if (current === null || typeof current !== "object") {
        return data;
      }
      return current as Record<string, JsonValue>;
    },
    [data]
  );

  const currentData = getDataAtPath(currentPath);

  if (typeof currentData !== "object") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No data to display
      </div>
    );
  }

  return (
    <div className="p-2 overflow-auto">
      {Array.isArray(currentData)
        ? currentData.map((item, index) => (
            <TreeNode
              key={index}
              name={String(index)}
              value={item}
              path={[...currentPath, String(index)]}
              depth={0}
              onNavigate={onNavigate}
              onValueChange={onValueChange}
              isEditable={isEditable}
            />
          ))
        : Object.entries(currentData).map(([key, value]) => (
            <TreeNode
              key={key}
              name={key}
              value={value}
              path={[...currentPath, key]}
              depth={0}
              onNavigate={onNavigate}
              onValueChange={onValueChange}
              isEditable={isEditable}
            />
          ))}
    </div>
  );
}
