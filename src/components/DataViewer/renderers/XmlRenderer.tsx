import React, { useState } from 'react';
import { Code, Maximize2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface XmlRendererProps {
  value: any;
  className?: string;
}

export const XmlRenderer: React.FC<XmlRendererProps> = ({ value, className }) => {
  const [showDialog, setShowDialog] = useState(false);
  
  const getXmlString = (): string => {
    if (typeof value === 'object' && value?.type === 'xml') {
      return value.value;
    }
    return String(value);
  };

  const formatXml = (xml: string): string => {
    try {
      const formatted = xml
        .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
        .replace(/(\w+)=("[^"]*")/g, '$1=$2');
      
      let indent = 0;
      return formatted.split('\n').map(line => {
        let indentBefore = indent;
        if (line.match(/^<\/\w/)) indent--;
        else if (line.match(/^<\w[^>]*[^\/]>.*$/)) indent++;
        
        indentBefore = Math.max(0, indentBefore);
        return '  '.repeat(indentBefore) + line;
      }).join('\n');
    } catch {
      return xml;
    }
  };

  const xmlString = getXmlString();
  const preview = xmlString.length > 100 
    ? xmlString.substring(0, 100) + '...' 
    : xmlString;

  const handleCopy = () => {
    navigator.clipboard.writeText(xmlString);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Code className="h-4 w-4 text-orange-500" />
      <span className="text-xs font-mono truncate max-w-[200px]" title={xmlString}>
        {preview}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => setShowDialog(true)}
      >
        <Maximize2 className="h-3 w-3" />
      </Button>
      
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              XML Viewer
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </DialogTitle>
          </DialogHeader>
          
          <pre className="bg-muted p-4 rounded-md overflow-auto text-xs font-mono">
            {formatXml(xmlString)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};