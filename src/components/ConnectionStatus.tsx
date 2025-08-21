import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConnectionHealth } from '@/hooks/useConnectionHealth';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface ConnectionStatusProps {
  connectionId?: string;
  showLabel?: boolean;
  showLatency?: boolean;
  className?: string;
}

export function ConnectionStatus({ 
  connectionId, 
  showLabel = true, 
  showLatency = true,
  className 
}: ConnectionStatusProps) {
  const { health, isHealthy, isDegraded, isReconnecting, isError } = useConnectionHealth(connectionId);
  
  console.log('[ConnectionStatus] Render:', {
    connectionId,
    health,
    isHealthy,
    isDegraded,
    isReconnecting,
    isError,
  });
  
  if (!connectionId) {
    console.log('[ConnectionStatus] No connectionId provided');
    return null;
  }
  
  if (!health) {
    console.log('[ConnectionStatus] No health data for connectionId:', connectionId);
    // Force visibility for debugging - show "Waiting for health..."
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        {showLabel && (
          <span className="text-xs text-orange-600">
            Waiting for health...
          </span>
        )}
        {/* Debug: Show the connection ID we're monitoring */}
        <span className="text-xs text-gray-500">
          (ID: {connectionId?.slice(-8)})
        </span>
      </div>
    );
  }
  
  const handleRetry = async () => {
    try {
      await invoke('test_connection', { connectionId });
      toast.success('Connection test successful');
    } catch {
      toast.error('Connection test failed');
    }
  };
  
  const getStatusColor = () => {
    if (isHealthy) return 'bg-green-500';
    if (isDegraded) return 'bg-amber-500';
    if (isReconnecting) return 'bg-amber-500 animate-pulse';
    if (isError) return 'bg-red-500';
    return 'bg-gray-500';
  };
  
  const getStatusLabel = () => {
    if (isHealthy) return 'Connected';
    if (isDegraded) return 'Degraded';
    if (isReconnecting) return 'Reconnecting...';
    if (isError) return 'Disconnected';
    return 'Unknown';
  };
  
  const getTooltipContent = () => {
    const lines = [getStatusLabel()];
    
    if (health.rttMs !== undefined && (isHealthy || isDegraded)) {
      lines.push(`Latency: ${String(health.rttMs)}ms`);
    }
    
    if (health.reason) {
      lines.push(health.reason);
    }
    
    if (health.lastPing) {
      // Ensure lastPing is a Date object (might be a string from persisted storage)
      const pingDate = health.lastPing instanceof Date ? health.lastPing : new Date(health.lastPing);
      const secondsAgo = Math.floor((Date.now() - pingDate.getTime()) / 1000);
      lines.push(`Last ping: ${String(secondsAgo)}s ago`);
    }
    
    return lines.join('\n');
  };
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('flex items-center gap-2', className)}>
            <div className={cn('w-2 h-2 rounded-full', getStatusColor())} />
            
            {showLabel && (
              <span className="text-xs text-muted-foreground">
                {getStatusLabel()}
              </span>
            )}
            
            {showLatency && isDegraded && health.rttMs && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {String(health.rttMs)}ms
              </span>
            )}
            
            {isError && (
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-5 px-2 text-xs"
                onClick={handleRetry}
              >
                Retry
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs whitespace-pre-line">
            {getTooltipContent()}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ConnectionStatusBadgeProps {
  connectionId: string;
  className?: string;
}

export function ConnectionStatusBadge({ connectionId, className }: ConnectionStatusBadgeProps) {
  const { health, isHealthy, isDegraded, isReconnecting, isError } = useConnectionHealth(connectionId);
  
  if (!health) {
    return null;
  }
  
  const getIcon = () => {
    if (isReconnecting) {
      return <Loader2 className="w-3 h-3 animate-spin" />;
    }
    return null;
  };
  
  return (
    <div 
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        {
          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300': isHealthy,
          'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300': isDegraded,
          'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 animate-pulse': isReconnecting,
          'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300': isError,
        },
        className
      )}
    >
      {getIcon()}
      {health.status}
    </div>
  );
}