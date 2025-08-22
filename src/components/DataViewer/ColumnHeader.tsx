import { Key, Link2, Fingerprint, Zap } from "lucide-react";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EnhancedColumnMeta } from "@/types/database";

interface ColumnHeaderProps {
  column: EnhancedColumnMeta;
  onNavigateToReference?: (schema: string, table: string) => void;
  className?: string;
}

export function ColumnHeader({ 
  column, 
  onNavigateToReference,
  className
}: ColumnHeaderProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center gap-1 px-2 py-1", className)}>
            {/* Column type indicators */}
            <div className="flex items-center gap-0.5">
              {column.is_pk && (
                <Key className="h-3 w-3 text-yellow-500" />
              )}
              {column.is_fk && (
                <Link2 className="h-3 w-3 text-blue-500" />
              )}
              {column.is_unique && !column.is_pk && (
                <Fingerprint className="h-3 w-3 text-purple-500" />
              )}
              {column.is_indexed && !column.is_pk && !column.is_unique && (
                <Zap className="h-3 w-3 text-green-500" />
              )}
            </div>
            
            {/* Column name */}
            <span className="truncate font-medium text-xs">
              {column.name}
            </span>
            
            {/* Nullable indicator */}
            {column.nullable && (
              <span className="text-xs text-muted-foreground">?</span>
            )}
          </div>
        </TooltipTrigger>
        
        <TooltipContent className="max-w-md" align="start">
          <div className="space-y-2 text-sm">
            {/* Column name and type */}
            <div className="font-semibold border-b pb-1">
              {column.name}
            </div>
            
            {/* Type information */}
            <div>
              <span className="font-medium">Type:</span> {column.db_type}
              {column.precision != null && column.scale != null && (
                <span className="text-muted-foreground"> ({column.precision},{column.scale})</span>
              )}
              {column.character_maximum_length != null && (
                <span className="text-muted-foreground"> ({column.character_maximum_length})</span>
              )}
            </div>
            
            {/* Nullable */}
            <div>
              <span className="font-medium">Nullable:</span> {column.nullable ? "Yes" : "No"}
            </div>
            
            {/* Default value */}
            {column.default && (
              <div>
                <span className="font-medium">Default:</span>{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {column.default}
                </code>
              </div>
            )}
            
            {/* Foreign key reference */}
            {column.fk_reference && (
              <div className="border-t pt-2 space-y-1">
                <div className="font-medium text-blue-600">Foreign Key Reference</div>
                <div className="pl-2 space-y-0.5">
                  <div>
                    <span className="text-muted-foreground">Table:</span>{" "}
                    <button
                      className="text-blue-500 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (column.fk_reference) {
                          onNavigateToReference?.(
                            column.fk_reference.referenced_schema,
                            column.fk_reference.referenced_table
                          );
                        }
                      }}
                    >
                      {column.fk_reference.referenced_schema}.{column.fk_reference.referenced_table}
                    </button>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Column:</span>{" "}
                    {column.fk_reference.referenced_column}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ON DELETE: {column.fk_reference.on_delete}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ON UPDATE: {column.fk_reference.on_update}
                  </div>
                </div>
              </div>
            )}
            
            {/* Check constraint */}
            {column.check_constraint && (
              <div className="border-t pt-2">
                <div className="font-medium">Check Constraint</div>
                <code className="text-xs bg-muted p-1 rounded block mt-1">
                  {column.check_constraint}
                </code>
              </div>
            )}
            
            {/* Column comment */}
            {column.comment && (
              <div className="border-t pt-2 italic text-muted-foreground">
                {column.comment}
              </div>
            )}
            
            {/* Metadata badges */}
            <div className="flex flex-wrap gap-1 pt-2 border-t">
              {column.is_pk && (
                <Badge variant="outline" className="text-xs">Primary Key</Badge>
              )}
              {column.is_fk && (
                <Badge variant="outline" className="text-xs">Foreign Key</Badge>
              )}
              {column.is_unique && !column.is_pk && (
                <Badge variant="outline" className="text-xs">Unique</Badge>
              )}
              {column.is_indexed && !column.is_pk && !column.is_unique && (
                <Badge variant="outline" className="text-xs">Indexed</Badge>
              )}
              {!column.nullable && (
                <Badge variant="destructive" className="text-xs">Required</Badge>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}