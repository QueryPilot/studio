import React, { useState } from 'react';
import { ChevronRight, ChevronDown, GitBranch, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface HierarchyRendererProps {
  value: any;
  className?: string;
}

interface HierarchyData {
  type: 'hierarchyid';
  path: string;
  level: number;
}

export const HierarchyRenderer: React.FC<HierarchyRendererProps> = ({ value, className }) => {
  const [expanded, setExpanded] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const getHierarchyData = (): HierarchyData => {
    if (typeof value === 'object' && value?.type === 'hierarchyid') {
      return value as HierarchyData;
    }
    // Parse string path like "/1/2/3/"
    const path = String(value);
    const level = path.split('/').filter(p => p).length;
    return { type: 'hierarchyid', path, level };
  };

  const hierarchyData = getHierarchyData();
  const pathSegments = hierarchyData.path.split('/').filter(p => p);

  const renderPath = () => {
    return (
      <div className="flex items-center gap-1">
        {pathSegments.map((segment, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-muted-foreground">/</span>}
            <span className="text-xs font-mono">{segment}</span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderTree = () => {
    return (
      <div className="space-y-1">
        {pathSegments.map((segment, index) => (
          <div
            key={index}
            className="flex items-center gap-2"
            style={{ paddingLeft: `${index * 20}px` }}
          >
            <GitBranch className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm font-mono">{segment}</span>
            {index === pathSegments.length - 1 && (
              <span className="text-xs text-muted-foreground ml-2">(current)</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </Button>
      <GitBranch className="h-4 w-4 text-green-500" />
      <span className="text-xs text-muted-foreground">Level {hierarchyData.level}</span>
      {expanded ? renderTree() : renderPath()}
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 ml-auto"
        onClick={() => setShowDialog(true)}
      >
        <Maximize2 className="h-3 w-3" />
      </Button>
      
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Hierarchy Path Viewer</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Path</h3>
              <code className="bg-muted px-3 py-2 rounded-md block">
                {hierarchyData.path}
              </code>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-2">Tree View</h3>
              <div className="bg-muted p-4 rounded-md">
                {renderTree()}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Level:</span> {hierarchyData.level}
              </div>
              <div>
                <span className="font-medium">Segments:</span> {pathSegments.length}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};