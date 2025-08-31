import { memo } from "react";
import { GlideTableDataGrid } from "./glide/GlideTableDataGrid";

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export const TableStructure = memo(function TableStructure({
  connectionId,
  database,
  table,
  schema,
}: TableStructureProps) {
  // For now, just show the table data grid
  // TODO: Implement proper table structure view showing columns, types, constraints
  return (
    <div className="h-full w-full">
      <GlideTableDataGrid
        connectionId={connectionId}
        database={database}
        table={table}
        schema={schema}
      />
    </div>
  );
});