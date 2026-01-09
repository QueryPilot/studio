import React, { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconTrash, IconKey } from "@tabler/icons-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type { GeometryCustomCell, GeometryType } from "./types";
import {
  parseGeometry,
  formatWkt,
  GEOMETRY_TYPES,
  COMMON_SRIDS,
  getExampleCoordinates,
} from "./utils";
import { useCommitOnUnmount } from "../hooks/useCommitOnUnmount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GeometryCellEditorProps {
  value: GeometryCustomCell;
  onFinishedEditing: (
    newValue?: GeometryCustomCell,
    movement?: readonly [-1 | 0 | 1, -1 | 0 | 1],
  ) => void;
}

export const GeometryCellEditor: React.FC<GeometryCellEditorProps> = ({
  value,
  onFinishedEditing,
}) => {
  const initialValue = useMemo(
    () => value.data.value ?? "",
    [value.data.value],
  );
  const parsedInitial = useMemo(
    () => parseGeometry(initialValue),
    [initialValue],
  );

  const [geometryType, setGeometryType] = useState<GeometryType | null>(
    parsedInitial.type,
  );
  const [srid, setSrid] = useState<number | null>(parsedInitial.srid);
  const [coordinates, setCoordinates] = useState(parsedInitial.coordinates);
  const [rawMode, setRawMode] = useState(false);
  const [rawValue, setRawValue] = useState(initialValue);

  const finishedRef = useRef(false);

  const nullable = Boolean(value.data.nullable);
  const { columnName, isPrimaryKey, dbType } = value.data;

  // Validation
  const validation = useMemo(() => {
    if (rawMode) {
      return parseGeometry(rawValue);
    }
    if (!geometryType) {
      return {
        isValid: true,
        type: null,
        srid: null,
        coordinates: "",
        error: undefined,
      };
    }
    return parseGeometry(formatWkt(geometryType, coordinates, srid));
  }, [rawMode, rawValue, geometryType, coordinates, srid]);

  const getCurrentValue = useCallback(() => {
    if (rawMode) {
      return rawValue.trim() || null;
    }
    if (!geometryType) {
      return null;
    }
    return formatWkt(geometryType, coordinates.trim(), srid);
  }, [rawMode, rawValue, geometryType, coordinates, srid]);

  const commit = useCallback(
    (nextValue: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const copyData = nextValue == null ? "NULL" : nextValue;

      const newCell: GeometryCustomCell = {
        kind: value.kind,
        data: {
          ...value.data,
          value: nextValue,
        },
        copyData,
        allowOverlay: value.allowOverlay,
        readonly: value.readonly,
      };

      onFinishedEditing(newCell);
    },
    [onFinishedEditing, value],
  );

  const commitCurrentValue = useCallback(() => {
    const currentValue = getCurrentValue();
    const hasChanged = currentValue !== initialValue;

    if (!hasChanged) {
      finishedRef.current = true;
      onFinishedEditing(undefined);
      return;
    }

    if (!validation.isValid && currentValue) {
      // Don't commit invalid values
      return;
    }

    commit(currentValue);
  }, [
    commit,
    getCurrentValue,
    initialValue,
    validation.isValid,
    onFinishedEditing,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (finishedRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishedRef.current = true;
        onFinishedEditing(undefined);
      } else if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        commitCurrentValue();
      }
    },
    [commitCurrentValue, onFinishedEditing],
  );

  useCommitOnUnmount(finishedRef, commitCurrentValue);

  const handleClear = () => {
    if (!nullable) return;
    commit(null);
  };

  const handleTypeChange = (type: string) => {
    const newType = type as GeometryType;
    setGeometryType(newType);

    // Pre-fill with example if coordinates are empty
    if (!coordinates.trim()) {
      setCoordinates(getExampleCoordinates(newType));
    }
  };

  const handleSridChange = (sridStr: string) => {
    setSrid(sridStr === "none" ? null : parseInt(sridStr, 10));
  };

  const toggleRawMode = () => {
    if (rawMode) {
      // Switching to structured mode
      const parsed = parseGeometry(rawValue);
      setGeometryType(parsed.type);
      setSrid(parsed.srid);
      setCoordinates(parsed.coordinates);
    } else {
      // Switching to raw mode
      setRawValue(getCurrentValue() || "");
    }
    setRawMode(!rawMode);
  };

  return (
    <div className="w-full flex flex-col relative click-outside-ignore z-50 min-w-[400px] gdg-editor-shell">
      {/* Header with column info */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-muted/50 border-b border-border/50">
        {isPrimaryKey && (
          <IconKey className="h-3 w-3 text-yellow-600 dark:text-yellow-500" />
        )}
        <span className="text-[10px] font-medium text-foreground/80">
          {columnName}
        </span>
        {dbType && (
          <span className="text-[9px] text-muted-foreground ml-auto">
            {dbType}
          </span>
        )}
      </div>

      {/* Mode toggle */}
      <div className="px-2 py-1 border-b border-border/30 flex items-center gap-2">
        <Button
          variant={rawMode ? "ghost" : "secondary"}
          size="sm"
          className="h-5 text-[10px] px-2"
          onClick={() => !rawMode && toggleRawMode()}
        >
          Structured
        </Button>
        <Button
          variant={rawMode ? "secondary" : "ghost"}
          size="sm"
          className="h-5 text-[10px] px-2"
          onClick={() => rawMode && toggleRawMode()}
        >
          Raw WKT
        </Button>
        <div className="flex-1" />
        {validation.isValid ? (
          <span className="text-[9px] text-green-600">✓ Valid</span>
        ) : (
          <span className="text-[9px] text-destructive">✗ Invalid</span>
        )}
      </div>

      {rawMode ? (
        /* Raw WKT mode */
        <div className="px-2 py-1.5">
          <textarea
            className={cn(
              "w-full h-32 bg-transparent text-xs font-mono outline-none p-2 border rounded resize-none",
              !validation.isValid ? "border-destructive" : "border-border/50",
            )}
            value={rawValue}
            onChange={(e) => {
              setRawValue(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="SRID=4326;POINT(0 0)"
            autoFocus
          />
        </div>
      ) : (
        /* Structured mode */
        <>
          {/* Type and SRID selectors */}
          <div className="px-2 py-1.5 border-b border-border/30 flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-[9px] text-muted-foreground">Type</Label>
              <Select
                value={geometryType || ""}
                onValueChange={(value) => {
                  if (value) {
                    handleTypeChange(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEOMETRY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Label className="text-[9px] text-muted-foreground">SRID</Label>
              <Select
                value={srid?.toString() || "none"}
                onValueChange={(value) => {
                  if (value) {
                    handleSridChange(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No SRID</SelectItem>
                  {COMMON_SRIDS.map(({ value: sridValue, label }) => (
                    <SelectItem key={sridValue} value={sridValue.toString()}>
                      {sridValue} - {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Coordinates input */}
          <div className="px-2 py-1.5">
            <Label className="text-[9px] text-muted-foreground mb-1 block">
              Coordinates
            </Label>
            <textarea
              className={cn(
                "w-full h-20 bg-transparent text-xs font-mono outline-none p-2 border rounded resize-none",
                !validation.isValid ? "border-destructive" : "border-border/50",
              )}
              value={coordinates}
              onChange={(e) => {
                setCoordinates(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                geometryType
                  ? getExampleCoordinates(geometryType)
                  : "Select a geometry type first"
              }
              disabled={!geometryType}
              autoFocus
            />
          </div>
        </>
      )}

      {/* Preview */}
      {getCurrentValue() && (
        <div className="px-2 py-1 border-t border-border/30">
          <Label className="text-[9px] text-muted-foreground">Output:</Label>
          <code className="text-[9px] font-mono block break-all mt-0.5">
            {getCurrentValue()}
          </code>
        </div>
      )}

      {/* Validation error */}
      {!validation.isValid && validation.error && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/10">
          {validation.error}
        </div>
      )}

      {/* Footer */}
      <div className="px-2 py-1 flex items-center gap-2 border-t border-border/30">
        <span className="text-[9px] text-muted-foreground">
          Ctrl+Enter to save, Esc to cancel
        </span>
        <div className="flex-1" />
        {nullable && (
          <Button
            variant="ghost"
            className="h-5 w-5 p-0"
            title="Clear (NULL)"
            onClick={handleClear}
          >
            <IconTrash className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const GeometryCellEditorWithProps = Object.assign(GeometryCellEditor, {
  disablePadding: true,
  disableStyling: false,
});
