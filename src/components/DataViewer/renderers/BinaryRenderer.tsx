import React, { useState } from 'react';
import { Binary, Copy, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BinaryRendererProps {
  value: string; // Base64 encoded string
  className?: string;
}

export const BinaryRenderer: React.FC<BinaryRendererProps> = ({ value, className }) => {
  const [format, setFormat] = useState<'hex' | 'base64'>('hex');
  
  const toHex = (base64: string): string => {
    try {
      const binary = atob(base64);
      let hex = '';
      for (let i = 0; i < binary.length; i++) {
        const byte = binary.charCodeAt(i).toString(16).padStart(2, '0');
        hex += byte;
        if ((i + 1) % 16 === 0) hex += '\n';
        else if ((i + 1) % 2 === 0) hex += ' ';
      }
      return hex.trim();
    } catch {
      return 'Invalid base64 data';
    }
  };

  const getBinarySize = (base64: string): number => {
    try {
      return Math.round(base64.length * 0.75); // Approximate size
    } catch {
      return 0;
    }
  };

  const displayValue = format === 'hex' ? toHex(value) : value;
  const size = getBinarySize(value);
  const preview = displayValue.substring(0, 50) + (displayValue.length > 50 ? '...' : '');

  const handleCopy = () => {
    navigator.clipboard.writeText(displayValue);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Binary className="h-4 w-4 text-purple-500" />
      <span className="text-xs text-muted-foreground">{size} bytes</span>
      <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded max-w-[150px] truncate">
        {preview}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => setFormat(format === 'hex' ? 'base64' : 'hex')}
        title={`Switch to ${format === 'hex' ? 'Base64' : 'Hex'}`}
      >
        {format === 'hex' ? <ToggleLeft className="h-3 w-3" /> : <ToggleRight className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={handleCopy}
      >
        <Copy className="h-3 w-3" />
      </Button>
    </div>
  );
};