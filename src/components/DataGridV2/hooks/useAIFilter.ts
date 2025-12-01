import { useState, useCallback } from "react";
import { textToSQL } from "@/services/aiService";
import { useAIChatStore } from "@/stores/aiChatStore";
import type { FilterColumnInfo } from "@/utils/filterParser";

interface UseAIFilterOptions {
  connectionId?: string;
  schema?: string;
  enableCrossTable?: boolean;
}

interface UseAIFilterResult {
  generateFilter: (
    prompt: string
  ) => Promise<{ clause: string; explanation?: string; usedSubquery?: boolean } | { error: string }>;
  isLoading: boolean;
  reset: () => void;
}

// Detect if prompt likely references related tables
function shouldEnableCrossTable(prompt: string, columns: FilterColumnInfo[]): boolean {
  const lowerPrompt = prompt.toLowerCase();

  // Keywords that suggest cross-table filtering
  const crossTableKeywords = [
    /\bby\s+\w+/i,           // "by John", "by Admin"
    /\bfrom\s+\w+/i,         // "from Sales", "from Org X"
    /\bbelongs?\s+to/i,      // "belongs to", "belong to"
    /\bin\s+\w+\s+(team|org|group|department)/i,
    /\b(user|author|owner|creator|assignee)\s+\w+/i,
    /\b(category|type|status)\s+\w+/i,
  ];

  const hasCrossTableKeyword = crossTableKeywords.some(kw => kw.test(lowerPrompt));
  if (!hasCrossTableKeyword) return false;

  // Check if we have FK-like columns that could benefit from cross-table
  const hasFKColumns = columns.some(c =>
    c.name.endsWith("_id") || c.name.endsWith("_by") || c.name.includes("_ref")
  );

  return hasFKColumns;
}

export function useAIFilter(
  columns: FilterColumnInfo[],
  tableName: string,
  dialect: "postgresql" | "mysql" | "sqlite" | "mssql",
  options: UseAIFilterOptions = {}
): UseAIFilterResult {
  const [isLoading, setIsLoading] = useState(false);
  const { selectedProvider, selectedModel } = useAIChatStore();
  const { connectionId, schema = "public", enableCrossTable } = options;

  const generateFilter = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) {
        return { error: "Prompt is required" };
      }

      setIsLoading(true);

      try {
        const provider = selectedProvider || "openai";
        const model = selectedModel || "gpt-4o-mini";

        // Auto-detect cross-table need if not explicitly set
        const useCrossTable = enableCrossTable ?? (
          connectionId ? shouldEnableCrossTable(prompt, columns) : false
        );

        const response = await textToSQL({
          prompt,
          columns: columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable ?? true,
            enumValues: c.enumValues,
            isPrimaryKey: c.isPrimaryKey,
            isForeignKey: c.isForeignKey,
            foreignTable: c.foreignTable,
            foreignColumn: c.foreignColumn,
          })),
          tableName,
          schema,
          dialect,
          provider,
          model,
          connectionId,
          enableCrossTable: useCrossTable,
        });

        if (response.error) {
          return { error: response.error };
        }

        if (!response.whereClause) {
          return { error: "No filter generated" };
        }

        return {
          clause: response.whereClause,
          explanation: response.explanation,
          usedSubquery: response.usedSubquery,
        };
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "Failed to generate filter",
        };
      } finally {
        setIsLoading(false);
      }
    },
    [columns, tableName, schema, dialect, selectedProvider, selectedModel, connectionId, enableCrossTable]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
  }, []);

  return { generateFilter, isLoading, reset };
}
