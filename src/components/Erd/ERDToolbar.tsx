import React, { useState, useRef, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  IconLayoutSidebar,
  IconPlus,
  IconRefresh,
  IconArrowsShuffle,
  IconZoomIn,
  IconZoomOut,
  IconMaximize,
  IconArrowsRightLeft,
  IconArrowsUpDown,
  IconSearch,
  IconDownload,
  IconX,
  IconPhoto,
  IconFileTypeSql,
} from "@tabler/icons-react";

export type LayoutDirection = "LR" | "TB" | "RL" | "BT";
export type SQLExportFormat = "postgres" | "mysql" | "mssql" | "oracle";

interface ERDToolbarProps {
  isCodeVisible: boolean;
  onToggleCodePanel: () => void;
  onCreateView?: () => void;
  onRefresh?: () => void;
  onAutoArrange?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  layoutDirection?: LayoutDirection;
  onLayoutDirectionChange?: (direction: LayoutDirection) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onExportPNG?: () => void;
  onExportSVG?: () => void;
  onExportSQL?: (format: SQLExportFormat) => void;
  isExporting?: boolean;
}

const SQL_FORMATS: { value: SQLExportFormat; label: string }[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL / MariaDB" },
  { value: "mssql", label: "SQL Server" },
  { value: "oracle", label: "Oracle" },
];

export const ERDToolbar: React.FC<ERDToolbarProps> = ({
  isCodeVisible,
  onToggleCodePanel,
  onCreateView,
  onRefresh,
  onAutoArrange,
  onZoomIn,
  onZoomOut,
  onFitView,
  layoutDirection = "LR",
  onLayoutDirectionChange,
  searchQuery = "",
  onSearchChange,
  onExportPNG,
  onExportSVG,
  onExportSQL,
  isExporting = false,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  return (
    <div className="flex items-center justify-between p-1.5">
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={isCodeVisible ? "secondary" : "ghost"}
                size="icon"
                aria-pressed={isCodeVisible}
                onClick={onToggleCodePanel}
              >
                <IconLayoutSidebar />
              </Button>
            }
          />
          <TooltipContent>
            {isCodeVisible ? "Hide Code Editor" : "Show Code Editor"}
          </TooltipContent>
        </Tooltip>

        {/* Search */}
        {isSearchOpen ? (
          <div className="flex items-center gap-1">
            <div className="relative">
              <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search tables..."
                className="h-7 w-40 pl-7 pr-7 text-xs"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onSearchChange?.("");
                    setIsSearchOpen(false);
                  }
                }}
              />
              {searchQuery && (
                <button
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => onSearchChange?.("")}
                >
                  <IconX className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => { setIsSearchOpen(true); }}
                >
                  <IconSearch />
                </Button>
              }
            />
            <TooltipContent>Search Tables</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-1">
        {/* Zoom Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onZoomIn?.();
                }}
              >
                <IconZoomIn />
              </Button>
            }
          />
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onZoomOut?.();
                }}
              >
                <IconZoomOut />
              </Button>
            }
          />
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onFitView?.();
                }}
              >
                <IconMaximize />
              </Button>
            }
          />
          <TooltipContent>Fit View</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onAutoArrange?.();
                }}
              >
                <IconArrowsShuffle />
              </Button>
            }
          />
          <TooltipContent>Auto Arrange</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onRefresh?.();
                }}
              >
                <IconRefresh />
              </Button>
            }
          />
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Layout Direction Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={layoutDirection === "LR" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => {
                  onLayoutDirectionChange?.("LR");
                }}
              >
                <IconArrowsUpDown />
              </Button>
            }
          />
          <TooltipContent>Vertical Layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant={layoutDirection === "TB" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => {
                  onLayoutDirectionChange?.("TB");
                }}
              >
                <IconArrowsRightLeft />
              </Button>
            }
          />
          <TooltipContent>Horizontal Layout</TooltipContent>
        </Tooltip>
        {/* Divider */}
        <div className="h-5 w-px bg-border mx-0.5" />

        {/* Export Controls */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isExporting}
              >
                <IconDownload />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="text-xs" onClick={onExportPNG}>
              <IconPhoto className="h-3.5 w-3.5 mr-2" />
              Export as PNG
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={onExportSVG}>
              <IconPhoto className="h-3.5 w-3.5 mr-2" />
              Export as SVG
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-xs">
                <IconFileTypeSql className="h-3.5 w-3.5 mr-2" />
                Export as SQL
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {SQL_FORMATS.map((fmt) => (
                  <DropdownMenuItem
                    key={fmt.value}
                    className="text-xs"
                    onClick={() => onExportSQL?.(fmt.value)}
                  >
                    {fmt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Other Controls */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onCreateView?.();
                }}
              >
                <IconPlus />
              </Button>
            }
          />
          <TooltipContent>New View</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
