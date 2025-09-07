import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Filter, ArrowUpDown, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface FilterSortButtonProps {
  filterCount: number;
  sortCount: number;
  onFilterClick: () => void;
  onSortClick: () => void;
  onClearAll?: () => void;
  isFilterOpen?: boolean;
  isSortOpen?: boolean;
  className?: string;
}

export function FilterSortButton({
  filterCount,
  sortCount,
  onFilterClick,
  onSortClick,
  onClearAll,
  isFilterOpen,
  isSortOpen,
  className,
}: FilterSortButtonProps) {
  const totalCount = filterCount + sortCount;
  const hasActiveFilters = totalCount > 0;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isFilterOpen ? "secondary" : "outline"}
              size="sm"
              onClick={onFilterClick}
              className="h-6 text-xs px-2 py-0 relative"
            >
              <Filter className="h-3 w-3 mr-1" />
              <span>Filter</span>
              {filterCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-1.5 -right-1.5 h-3.5 min-w-[14px] px-0.5 text-[9px] leading-none"
                >
                  {filterCount}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Filter ({filterCount} active)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isSortOpen ? "secondary" : "outline"}
              size="sm"
              onClick={onSortClick}
              className="h-6 text-xs px-2 py-0 relative"
            >
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <span>Sort</span>
              {sortCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-1.5 -right-1.5 h-3.5 min-w-[14px] px-0.5 text-[9px] leading-none"
                >
                  {sortCount}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Sort ({sortCount} active)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {hasActiveFilters && onClearAll && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="h-6 px-1 text-xs py-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Clear all filters and sorts</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}