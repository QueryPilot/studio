import { memo } from "react";
import { DollarSign } from "lucide-react";

interface MoneyCellProps {
  value: string | number;
  currency?: string;
}

export const MoneyCell = memo(function MoneyCell({ 
  value, 
  currency = "$" 
}: MoneyCellProps) {
  // PostgreSQL money type returns as string like "$1,234.56"
  // Remove currency symbol if present in the value
  const cleanValue = typeof value === "string" 
    ? value.replace(/[$,]/g, "") 
    : value;
  
  // Format the number
  const numericValue = parseFloat(String(cleanValue));
  const formatted = isNaN(numericValue) 
    ? value 
    : numericValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
  
  return (
    <div className="flex items-center gap-0.5 text-right justify-end">
      <DollarSign className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />
      <span className="text-xs font-mono text-foreground/80 dark:text-foreground/65">
        {formatted}
      </span>
    </div>
  );
});