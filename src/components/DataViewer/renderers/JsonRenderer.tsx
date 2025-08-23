import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface JsonRendererProps {
  value: any;
  className?: string;
  compact?: boolean;
}

export const JsonRenderer: React.FC<JsonRendererProps> = ({ value, className, compact = false }) => {
  const [expanded, setExpanded] = useState(!compact);
  const [showDialog, setShowDialog] = useState(false);

  const renderJsonTree = (data: any, depth = 0): React.ReactNode => {
    if (data === null) return <span className="text-muted-foreground">null</span>;
    if (data === undefined) return <span className="text-muted-foreground">undefined</span>;
    
    if (typeof data === 'string') return <span className="text-green-600 dark:text-green-400">"{data}"</span>;
    if (typeof data === 'number') return <span className="text-blue-600 dark:text-blue-400">{data}</span>;
    if (typeof data === 'boolean') return <span className="text-purple-600 dark:text-purple-400">{String(data)}</span>;
    
    if (Array.isArray(data)) {
      if (data.length === 0) return <span>[]</span>;
      if (depth > 2 && compact) return <span className="text-muted-foreground">[{data.length} items]</span>;
      
      return (
        <div className="inline-block">
          <span>[</span>
          <div className="pl-4">
            {data.map((item, index) => (
              <div key={index}>
                {renderJsonTree(item, depth + 1)}
                {index < data.length - 1 && ','}
              </div>
            ))}
          </div>
          <span>]</span>
        </div>
      );
    }
    
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return <span>{'{}'}</span>;
      if (depth > 2 && compact) return <span className="text-muted-foreground">{`{${keys.length} props}`}</span>;
      
      return (
        <div className="inline-block">
          <span>{'{'}</span>
          <div className="pl-4">
            {keys.map((key, index) => (
              <div key={key}>
                <span className="text-purple-600 dark:text-purple-400">"{key}"</span>
                <span>: </span>
                {renderJsonTree(data[key], depth + 1)}
                {index < keys.length - 1 && ','}
              </div>
            ))}
          </div>
          <span>{'}'}</span>
        </div>
      );
    }
    
    return <span>{String(data)}</span>;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(value, null, 2));
  };

  const jsonString = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const preview = compact && jsonString.length > 50 
    ? jsonString.substring(0, 50) + '...' 
    : jsonString;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </Button>
        <span className="font-mono text-xs">
          {expanded ? renderJsonTree(value) : preview}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 ml-auto"
          onClick={() => setShowDialog(true)}
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
        
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                JSON Viewer
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </DialogTitle>
            </DialogHeader>
            <div className="font-mono text-sm">
              {renderJsonTree(value)}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn("font-mono text-sm", className)}>
      {renderJsonTree(value)}
    </div>
  );
};