import { useState, useEffect, useRef, memo } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineCellEditorProps {
  value: any;
  onSave: (value: any) => void;
  onCancel: () => void;
  className?: string;
  type?: 'text' | 'number' | 'boolean' | 'date' | 'json';
}

export const InlineCellEditor = memo(function InlineCellEditor({
  value,
  onSave,
  onCancel,
  className,
  type = 'text',
}: InlineCellEditorProps) {
  const [editValue, setEditValue] = useState(() => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value.value !== undefined) return String(value.value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  useEffect(() => {
    const ref = type === 'json' ? textareaRef.current : inputRef.current;
    if (ref) {
      ref.focus();
      ref.select();
    }
  }, [type]);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab') {
      // Allow tab to save and move to next cell
      e.preventDefault();
      handleSave();
    }
  };
  
  const handleSave = () => {
    let parsedValue: any = editValue;
    
    // Parse based on type
    if (type === 'number') {
      const numValue = editValue === '' ? null : Number(editValue);
      if (numValue !== null && isNaN(numValue)) {
        // Invalid number, don't save
        onCancel();
        return;
      }
      parsedValue = numValue;
    } else if (type === 'boolean') {
      parsedValue = editValue.toLowerCase() === 'true' || editValue === '1';
    } else if (type === 'json') {
      try {
        parsedValue = JSON.parse(editValue);
      } catch {
        // Invalid JSON, don't save
        onCancel();
        return;
      }
    } else if (editValue === '') {
      parsedValue = null;
    }
    
    onSave(parsedValue);
  };
  
  if (type === 'boolean') {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <input
          type="checkbox"
          checked={editValue === 'true' || editValue === '1'}
          onChange={(e) => { setEditValue(e.target.checked ? 'true' : 'false'); }}
          onKeyDown={handleKeyDown}
          className="focus:ring-2 focus:ring-primary"
          autoFocus
        />
        <button
          onClick={handleSave}
          className="p-0.5 hover:bg-primary/20 rounded"
          title="Save"
        >
          <Check className="h-3 w-3 text-green-600" />
        </button>
        <button
          onClick={onCancel}
          className="p-0.5 hover:bg-destructive/20 rounded"
          title="Cancel"
        >
          <X className="h-3 w-3 text-red-600" />
        </button>
      </div>
    );
  }
  
  if (type === 'json') {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => { setEditValue(e.target.value); }}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          className={cn(
            "w-full px-1 py-0.5 text-xs font-mono",
            "bg-background border border-primary rounded",
            "focus:outline-none focus:ring-2 focus:ring-primary",
            "resize-none"
          )}
          rows={3}
        />
      </div>
    );
  }
  
  return (
    <div className={cn("relative w-full h-full", className)}>
      <input
        ref={inputRef}
        type={type === 'number' ? 'number' : 'text'}
        value={editValue}
        onChange={(e) => { setEditValue(e.target.value); }}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className={cn(
          "absolute inset-0 w-full h-full",
          "px-1 text-xs bg-background",
          "border-2 border-primary rounded-sm",
          "focus:outline-none focus:ring-0",
          type === 'number' && "text-right"
        )}
      />
    </div>
  );
});