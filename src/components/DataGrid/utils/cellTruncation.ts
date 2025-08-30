import { useMemo } from "react";

// Memoized truncation function
export const truncateText = (text: string, maxChars: number): { truncated: string; isTruncated: boolean } => {
  if (!text || text.length <= maxChars) {
    return { truncated: text, isTruncated: false };
  }
  
  return { 
    truncated: text.slice(0, maxChars - 3) + "...", 
    isTruncated: true 
  };
};

// Calculate max characters based on column width
export const getMaxCharsForWidth = (width: number): number => {
  // Approximate: ~7 pixels per character for monospace font at 12px
  // Account for padding (16px total) and potential scrollbar
  const effectiveWidth = width - 20;
  return Math.max(10, Math.floor(effectiveWidth / 7));
};

// Format value for display (handles JSON, arrays, etc.)
export const formatCellValue = (value: any): string => {
  if (value === null || value === undefined) return "";
  
  if (typeof value === "object") {
    try {
      // For JSON/arrays, stringify without formatting
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  
  return String(value);
};

// Custom hook for memoized truncation
export const useTruncatedValue = (
  value: any, 
  columnWidth: number
): { displayValue: string; fullValue: string; isTruncated: boolean } => {
  return useMemo(() => {
    const fullValue = formatCellValue(value);
    const maxChars = getMaxCharsForWidth(columnWidth);
    const { truncated, isTruncated } = truncateText(fullValue, maxChars);
    
    return {
      displayValue: truncated,
      fullValue,
      isTruncated
    };
  }, [value, columnWidth]);
};