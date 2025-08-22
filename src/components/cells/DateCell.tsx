import { useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarIcon, Clock } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parse, isValid } from "date-fns";

interface DateCellProps {
  value: string | Date;
  isEditing: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
  columnMeta?: {
    db_type: string;
    nullable?: boolean;
  };
}

export function DateCell({
  value,
  isEditing,
  onChange,
  onEditComplete,
  columnMeta,
}: DateCellProps) {
  const [date, setDate] = useState<Date | undefined>(() => {
    if (!value || value === "NULL") return undefined;
    try {
      const parsed = value instanceof Date ? value : new Date(value);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    } catch {
      return undefined;
    }
  });
  
  const [inputValue, setInputValue] = useState(() => {
    if (!date) return "";
    const dbType = columnMeta?.db_type?.toLowerCase() || "";
    if (dbType.includes("time") && !dbType.includes("timestamp")) {
      return format(date, "HH:mm");
    }
    if (dbType.includes("timestamp") || dbType.includes("datetime")) {
      return format(date, "dd/MM/yyyy, HH:mm");
    }
    return format(date, "dd/MM/yyyy");
  });
  
  const [timeValue, setTimeValue] = useState(() => {
    if (!date) return "12:30";
    return format(date, "HH:mm");
  });
  
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasTime = useCallback(() => {
    const dbType = columnMeta?.db_type?.toLowerCase() || "";
    return dbType.includes("timestamp") || dbType.includes("datetime");
  }, [columnMeta]);

  const isTimeOnly = useCallback(() => {
    const dbType = columnMeta?.db_type?.toLowerCase() || "";
    return dbType.includes("time") && !dbType.includes("timestamp");
  }, [columnMeta]);

  const getDateFormat = useCallback(() => {
    if (isTimeOnly()) return "HH:mm";
    if (hasTime()) return "dd/MM/yyyy, HH:mm";
    return "dd/MM/yyyy";
  }, [hasTime, isTimeOnly]);

  const parseInputValue = useCallback((value: string) => {
    if (!value) return undefined;
    
    try {
      let parsed: Date;
      if (isTimeOnly()) {
        // For time only, parse as time on today's date
        parsed = parse(value, "HH:mm", new Date());
      } else if (hasTime()) {
        // Try parsing with time
        parsed = parse(value, "dd/MM/yyyy, HH:mm", new Date());
        if (!isValid(parsed)) {
          // Try without time
          parsed = parse(value, "dd/MM/yyyy", new Date());
          if (isValid(parsed)) {
            parsed.setHours(12, 30, 0, 0);
          }
        }
      } else {
        // Date only
        parsed = parse(value, "dd/MM/yyyy", new Date());
      }
      
      return isValid(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }, [hasTime, isTimeOnly]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    const parsed = parseInputValue(newValue);
    if (parsed) {
      setDate(parsed);
      setTimeValue(format(parsed, "HH:mm"));
      onChange?.(parsed.toISOString());
    } else if (newValue === "" && columnMeta?.nullable) {
      setDate(undefined);
      onChange?.("NULL");
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onEditComplete?.();
    }
  };

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      // Preserve time when selecting date
      if (hasTime() && date) {
        selectedDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
      } else if (hasTime()) {
        const [hours, minutes] = timeValue.split(":").map(Number);
        selectedDate.setHours(hours, minutes, 0, 0);
      }
      
      setDate(selectedDate);
      setInputValue(format(selectedDate, getDateFormat()));
      onChange?.(selectedDate.toISOString());
    } else if (columnMeta?.nullable) {
      setDate(undefined);
      setInputValue("");
      onChange?.("NULL");
    }
    
    if (!hasTime()) {
      setIsCalendarOpen(false);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = e.target.value;
    setTimeValue(newTime);
    
    if (date && newTime) {
      const [hours, minutes] = newTime.split(":").map(Number);
      const updatedDate = new Date(date);
      updatedDate.setHours(hours, minutes, 0, 0);
      setDate(updatedDate);
      setInputValue(format(updatedDate, getDateFormat()));
      onChange?.(updatedDate.toISOString());
    }
  };

  const formatDisplayValue = (val: string | Date) => {
    if (!val || val === "NULL") return "NULL";
    
    try {
      const date = val instanceof Date ? val : new Date(val);
      if (isNaN(date.getTime())) return String(val);
      
      const dbType = columnMeta?.db_type?.toLowerCase() || "";
      
      if (dbType.includes("time") && !dbType.includes("timestamp")) {
        return date.toLocaleTimeString();
      }
      if (dbType.includes("timestamp") || dbType.includes("datetime")) {
        return date.toLocaleString();
      }
      return date.toLocaleDateString();
    } catch {
      return String(val);
    }
  };

  const getIcon = () => {
    if (isTimeOnly()) {
      return <Clock className="h-3 w-3" />;
    }
    return <CalendarIcon className="h-3 w-3" />;
  };

  if (!isEditing) {
    const displayValue = formatDisplayValue(value);
    return (
      <div className="px-2 py-1 text-xs flex items-center gap-1 truncate" title={String(value)}>
        {displayValue === "NULL" ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          <>
            <span className="text-muted-foreground">{getIcon()}</span>
            <span>{displayValue}</span>
          </>
        )}
      </div>
    );
  }

  // For time-only fields, just show a simple time input
  if (isTimeOnly()) {
    return (
      <Input
        ref={inputRef}
        type="time"
        value={timeValue}
        onChange={handleTimeChange}
        onKeyDown={handleInputKeyDown}
        className="h-6 text-xs border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        autoFocus
      />
    );
  }

  return (
    <div className="flex items-center gap-0.5 w-full">
      <Input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        placeholder={columnMeta?.nullable ? "NULL" : getDateFormat().toLowerCase()}
        className="h-6 text-xs border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
        autoFocus
      />
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 hover:bg-primary/10"
            type="button"
          >
            <CalendarIcon className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            initialFocus
          />
          {hasTime() && (
            <div className="p-3 border-t">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="time"
                  value={timeValue}
                  onChange={handleTimeChange}
                  className="h-6 text-xs"
                />
              </div>
            </div>
          )}
          {columnMeta?.nullable && (
            <div className="p-3 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  handleDateSelect(undefined);
                  setIsCalendarOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}