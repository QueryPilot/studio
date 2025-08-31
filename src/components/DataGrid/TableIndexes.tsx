import { memo } from "react";

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
}: TableIndexesProps) {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="text-muted-foreground">
        Table indexes view coming soon...
      </div>
    </div>
  );
});