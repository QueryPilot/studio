import { memo } from "react";

interface TableTriggersProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableTriggers = memo(function TableTriggers({
  connectionId,
  database,
  table,
  schema,
}: TableTriggersProps) {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="text-muted-foreground">
        Table triggers view coming soon...
      </div>
    </div>
  );
});