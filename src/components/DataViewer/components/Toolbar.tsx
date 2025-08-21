import { memo } from "react";
import { Table as TableInstance } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ToggleButton } from "@/components/ui/toggle-button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Eye,
  Download,
  Table,
  Database,
  MoreVertical,
  RotateCcw,
  PanelBottomOpen,
  PanelBottomClose,
} from "lucide-react";
import { ViewMode } from "../types";

interface ToolbarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  globalFilter: string;
  setGlobalFilter: (filter: string) => void;
  isColumnsDropdownOpen: boolean;
  setIsColumnsDropdownOpen: (open: boolean) => void;
  table: TableInstance<any>;
  exportAsCSV: () => void;
  selectedRow: any;
  showDetails: boolean;
  setShowDetails: (show: boolean) => void;
  tableStructure: any[];
  columnVisibility: any;
}

export const Toolbar = memo(
  ({
    viewMode,
    setViewMode,
    globalFilter,
    setGlobalFilter,
    isColumnsDropdownOpen,
    setIsColumnsDropdownOpen,
    table,
    exportAsCSV,
    showDetails,
    setShowDetails,
    tableStructure,
    columnVisibility, // eslint-disable-line @typescript-eslint/no-unused-vars
  }: ToolbarProps) => {
    // columnVisibility is used for memo dependency tracking to trigger re-renders
    void columnVisibility;

    return (
      <div className="flex-shrink-0 flex items-center justify-between p-1 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-muted/50 border rounded-md p-0.5 h-7">
            <ToggleButton
              isActive={viewMode === "data"}
              onClick={() => setViewMode("data")}
            >
              <Table className="h-3 w-3 mr-1" />
              Data
            </ToggleButton>
            <ToggleButton
              isActive={viewMode === "structure"}
              onClick={() => setViewMode("structure")}
            >
              <Database className="h-3 w-3 mr-1" />
              Structure
            </ToggleButton>
          </div>

          {viewMode === "data" && (
            <>
              <div className="relative flex-1 flex items-center bg-muted/50 border rounded-md px-1.5 h-7 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
                <Search className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                <Input
                  placeholder="Search..."
                  value={globalFilter ?? ""}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  className="h-5 !text-xs border-0 !bg-transparent !outline-none px-0 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 w-full"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {viewMode === "data" && (
            <>
              <DropdownMenu
                open={isColumnsDropdownOpen}
                onOpenChange={setIsColumnsDropdownOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs bg-muted/50 border rounded-md hover:bg-muted/70"
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56"
                  onInteractOutside={() => setIsColumnsDropdownOpen(false)}
                >
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-medium">Visible Columns</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        table.getAllColumns().forEach((column) => {
                          column.toggleVisibility(true);
                        });
                      }}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <DropdownMenuSeparator />
                  <ScrollArea className="h-64">
                    <div className="px-1">
                      {table.getAllColumns().map((column) => {
                        return (
                          <DropdownMenuCheckboxItem
                            key={column.id}
                            className="text-xs py-1.5 cursor-pointer"
                            checked={column.getIsVisible()}
                            onCheckedChange={(value) => {
                              column.toggleVisibility(!!value);
                            }}
                            onSelect={(e) => e.preventDefault()}
                          >
                            <span className="truncate" title={column.id}>
                              {column.id}
                            </span>
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs bg-muted/50 hover:bg-muted/70"
                  >
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onClick={exportAsCSV}>
                    <Download className="h-3 w-3 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Preview Panel Toggle Button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setShowDetails(!showDetails)}
                title={
                  showDetails ? "Hide Preview Panel" : "Show Preview Panel"
                }
              >
                {showDetails ? (
                  <PanelBottomClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelBottomOpen className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
          {viewMode === "structure" && (
            <span className="text-xs text-muted-foreground">
              {tableStructure.length} columns
            </span>
          )}
        </div>
      </div>
    );
  },
);

Toolbar.displayName = "Toolbar";
