import React, { useState, useEffect } from 'react';
import { MapPin, Maximize2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface SpatialRendererProps {
  value: any;
  className?: string;
}

interface SpatialData {
  type: 'spatial';
  subtype?: string;
  format: 'geojson' | 'wkt' | 'wkb';
  value: any;
}

export const SpatialRenderer: React.FC<SpatialRendererProps> = ({ value, className }) => {
  const [showDialog, setShowDialog] = useState(false);
  const [formattedValue, setFormattedValue] = useState<string>('');

  useEffect(() => {
    if (typeof value === 'object' && value?.type === 'spatial') {
      const spatialData = value as SpatialData;
      
      if (spatialData.format === 'geojson') {
        setFormattedValue(JSON.stringify(spatialData.value, null, 2));
      } else if (spatialData.format === 'wkt') {
        setFormattedValue(spatialData.value);
      } else if (spatialData.format === 'wkb') {
        setFormattedValue(`WKB: ${spatialData.value.substring(0, 50)}...`);
      }
    } else {
      setFormattedValue(String(value));
    }
  }, [value]);

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedValue);
  };

  const renderPreview = () => {
    if (typeof value === 'object' && value?.type === 'spatial') {
      const spatialData = value as SpatialData;
      const subtype = spatialData.subtype || 'geometry';
      
      return (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-500" />
          <span className="text-xs font-mono">
            {subtype.toUpperCase()} ({spatialData.format.toUpperCase()})
          </span>
        </div>
      );
    }
    
    return <span className="text-xs text-muted-foreground">Spatial Data</span>;
  };

  const renderMapView = () => {
    if (typeof value === 'object' && value?.type === 'spatial' && value.format === 'geojson') {
      // In a real implementation, you would render an actual map here using a library like Leaflet
      return (
        <div className="bg-muted rounded-md p-8 text-center">
          <MapPin className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Map visualization would appear here
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            (Requires map library integration)
          </p>
        </div>
      );
    }
    
    return null;
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {renderPreview()}
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
              Spatial Data Viewer
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {renderMapView()}
            
            <div>
              <h3 className="text-sm font-medium mb-2">Raw Data</h3>
              <pre className="bg-muted p-4 rounded-md overflow-auto max-h-64 text-xs">
                {formattedValue}
              </pre>
            </div>
            
            {typeof value === 'object' && value?.type === 'spatial' && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Type:</span> {value.subtype || 'Unknown'}
                </div>
                <div>
                  <span className="font-medium">Format:</span> {value.format.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};