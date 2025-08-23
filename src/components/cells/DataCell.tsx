import { StringCell } from "./StringCell";
import { IntegerCell } from "./IntegerCell";
import { DecimalCell } from "./DecimalCell";
import { BooleanCell } from "./BooleanCell";
import { DateCell } from "./DateCell";
import { JsonCell } from "./JsonCell";
import { UuidCell } from "./UuidCell";
import { 
  JsonRenderer, 
  SpatialRenderer, 
  XmlRenderer, 
  BinaryRenderer, 
  HierarchyRenderer 
} from "../DataViewer/renderers";
// import { NumericCell } from "./NumericCell"; // Keep existing NumericCell for backwards compatibility

export interface ColumnMeta {
  name: string;
  db_type: string;
  nullable?: boolean;
  precision?: number;
  scale?: number;
  character_maximum_length?: number;
  // MSSQL specific
  is_identity?: boolean;
  is_computed?: boolean;
  is_hierarchyid?: boolean;
  is_spatial?: boolean;
  // MySQL/MariaDB specific
  is_json?: boolean;
  enum_values?: string[];
  set_values?: string[];
  is_virtual?: boolean;
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
  // Check for special data types first
  if (value && typeof value === 'object') {
    // Handle special structured data from backend
    if (value.type === 'spatial') {
      return <SpatialRenderer value={value} className="inline-flex" />;
    }
    if (value.type === 'xml') {
      return <XmlRenderer value={value} className="inline-flex" />;
    }
    if (value.type === 'hierarchyid') {
      return <HierarchyRenderer value={value} className="inline-flex" />;
    }
    if (value.type === 'money') {
      return <StringCell value={`$${value.value}`} isEditing={isEditing} onChange={onChange} onEditComplete={onEditComplete} columnMeta={columnMeta} />;
    }
    if (value.type === 'bit') {
      return <StringCell value={value.binary || value.decimal?.toString()} isEditing={isEditing} onChange={onChange} onEditComplete={onEditComplete} columnMeta={columnMeta} />;
    }
    if (value.type === 'set') {
      return <JsonRenderer value={value.values} className="inline-flex" compact />;
    }
  }
  
  // Check column metadata for specific types (with null safety)
  if (columnMeta?.is_hierarchyid) {
    return <HierarchyRenderer value={value} className="inline-flex" />;
  }
  if (columnMeta?.is_spatial) {
    return <SpatialRenderer value={value} className="inline-flex" />;
  }
  if (columnMeta?.is_json) {
    return <JsonRenderer value={value} className="inline-flex" compact />;
  }
  
  // Check for binary data (base64 encoded strings)
  const dbType = columnMeta?.db_type?.toLowerCase() || '';
  if (dbType && (dbType.includes('binary') || dbType.includes('blob') || dbType.includes('image'))) {
    if (typeof value === 'string' && value.length > 0) {
      // Check if it looks like base64
      if (/^[A-Za-z0-9+/]+=*$/.test(value)) {
        return <BinaryRenderer value={value} className="inline-flex" />;
      }
    }
  }
  
  // Check for XML data
  if (dbType && dbType.includes('xml')) {
    return <XmlRenderer value={value} className="inline-flex" />;
  }
  
  // Fall back to standard cell type detection
  const cellType = getCellType(columnMeta?.db_type || 'text');
  
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