import { memo } from "react";
import { DollarSign, Euro, Banknote } from "lucide-react";

interface MoneyCellProps {
  value: string | number;
  currency?: string;
}

export const MoneyCell = memo(function MoneyCell({
  value,
  currency,
}: MoneyCellProps) {
  // PostgreSQL money type returns as string like "$1,234.56"
  // Remove various currency symbols if present in the value
  const cleanValue =
    typeof value === "string" ? 
      value.replace(/[€$£¥₹₽¢₩₪₨₦₫₡₤₧₩₱₲₱₵₴₸₼₾₿¤]/g, "").replace(/[,\s]/g, "") : 
      value;

  // Format the number
  const numericValue = parseFloat(String(cleanValue));
  const formatted = isNaN(numericValue)
    ? value
    : numericValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

  // Determine which icon to show based on currency symbol
  const getCurrencyIcon = () => {
    if (!currency) {
      return <DollarSign className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />;
    }
    
    switch (currency) {
      case "€":
        return <Euro className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />;
      case "$":
        return <DollarSign className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />;
      default:
        return <Banknote className="h-3 w-3 text-green-600 dark:text-green-500 opacity-70" />;
    }
  };

  // Show currency symbol in the text if available, otherwise format normally
  const displayValue = currency ? `${currency}${formatted}` : formatted;

  return (
    <div className="flex items-center gap-0.5 text-right justify-end">
      {getCurrencyIcon()}
      <span className="text-xs font-mono text-foreground/80 dark:text-foreground/65">
        {displayValue}
      </span>
    </div>
  );
});
