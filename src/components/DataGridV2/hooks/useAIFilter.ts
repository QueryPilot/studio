import { useState, useCallback } from "react";
import { textToSQL } from "@/services/aiService";
import { useAIChatStore } from "@/stores/aiChatStore";
import type { ColumnMeta } from "@/utils/filterParser";

interface UseAIFilterResult {
  generateFilter: (
    prompt: string
  ) => Promise<{ clause: string; explanation?: string } | { error: string }>;
  isLoading: boolean;
  reset: () => void;
}

export function useAIFilter(
  columns: ColumnMeta[],
  tableName: string,
  dialect: "postgresql" | "mysql" | "sqlite" | "mssql"
): UseAIFilterResult {
  const [isLoading, setIsLoading] = useState(false);
  const { selectedProvider, selectedModel } = useAIChatStore();

  const generateFilter = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) {
        return { error: "Prompt is required" };
      }

      setIsLoading(true);

      try {
        // Use defaults if not configured
        const provider = selectedProvider || "openai";
        const model = selectedModel || "gpt-4o-mini";

        const response = await textToSQL({
          prompt,
          columns: columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            nullable: c.nullable ?? true,
            enumValues: c.enumValues,
          })),
          tableName,
          dialect,
          provider,
          model,
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
    [columns, tableName, dialect, selectedProvider, selectedModel]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
  }, []);

  return { generateFilter, isLoading, reset };
}
