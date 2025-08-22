import { StringCell } from "./StringCell";
import { IntegerCell } from "./IntegerCell";
import { DecimalCell } from "./DecimalCell";
import { BooleanCell } from "./BooleanCell";
import { DateCell } from "./DateCell";
import { JsonCell } from "./JsonCell";
import { UuidCell } from "./UuidCell";
// import { NumericCell } from "./NumericCell"; // Keep existing NumericCell for backwards compatibility

export interface ColumnMeta {
  name: string;
  db_type: string;
  nullable?: boolean;
  precision?: number;
  scale?: number;
  character_maximum_length?: number;
}

interface DataCellProps {
  value: any;
  columnMeta: ColumnMeta;
  isEditing?: boolean;
  onChange?: (value: string) => void;
  onEditComplete?: () => void;
}

// Determine the appropriate cell component based on database type
function getCellType(dbType: string): string {
  const type = dbType.toLowerCase();
  
  // String/Text types
  if (type.includes("char") || 
      type.includes("text") || 
      type.includes("varchar") ||
      type.includes("string") ||
      type.includes("clob")) {
    return "string";
  }
  
  // Integer types
  if (type.includes("int") || 
      type.includes("serial") ||
      type.includes("bigserial")) {
    return "integer";
  }
  
  // Decimal/Float types
  if (type.includes("decimal") || 
      type.includes("numeric") ||
      type.includes("float") ||
      type.includes("double") ||
      type.includes("real") ||
      type.includes("money")) {
    return "decimal";
  }
  
  // Boolean types
  if (type.includes("bool") ||
      type.includes("bit")) {
    return "boolean";
  }
  
  // Date/Time types
  if (type.includes("date") ||
      type.includes("time") ||
      type.includes("timestamp") ||
      type.includes("datetime") ||
      type.includes("interval")) {
    return "date";
  }
  
  // JSON types
  if (type.includes("json") ||
      type.includes("jsonb")) {
    return "json";
  }
  
  // UUID types
  if (type.includes("uuid") ||
      type.includes("guid")) {
    return "uuid";
  }
  
  // Binary/Blob types (treated as string for now)
  if (type.includes("binary") ||
      type.includes("blob") ||
      type.includes("bytea")) {
    return "string";
  }
  
  // Enum types (treated as string)
  if (type.includes("enum")) {
    return "string";
  }
  
  // Array types (treated as JSON for now)
  if (type.includes("array") || type.includes("[]")) {
    return "json";
  }
  
  // Geometric types (PostgreSQL specific, treated as string)
  if (type.includes("point") ||
      type.includes("polygon") ||
      type.includes("circle") ||
      type.includes("line") ||
      type.includes("box") ||
      type.includes("path")) {
    return "string";
  }
  
  // Network types (PostgreSQL specific, treated as string)
  if (type.includes("inet") ||
      type.includes("cidr") ||
      type.includes("macaddr")) {
    return "string";
  }
  
  // Default to string for unknown types
  return "string";
}

export function DataCell({
  value,
  columnMeta,
  isEditing = false,
  onChange,
  onEditComplete,
}: DataCellProps) {
  const cellType = getCellType(columnMeta.db_type);
  
  const commonProps = {
    value,
    isEditing,
    onChange,
    onEditComplete,
    columnMeta,
  };
  
  switch (cellType) {
    case "integer":
      return <IntegerCell {...commonProps} />;
    
    case "decimal":
      return <DecimalCell {...commonProps} />;
    
    case "boolean":
      return <BooleanCell {...commonProps} />;
    
    case "date":
      return <DateCell {...commonProps} />;
    
    case "json":
      return <JsonCell {...commonProps} />;
    
    case "uuid":
      return <UuidCell {...commonProps} />;
    
    case "string":
    default:
      return <StringCell {...commonProps} />;
  }
}

// Export type detection function for use elsewhere
export { getCellType };