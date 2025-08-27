import { useState, useCallback, useRef } from "react";

interface UseCopyReturn {
  copy: (text: string) => Promise<void>;
  isCopied: boolean;
}

export function useCopy(resetDelay = 3000): UseCopyReturn {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const copy = useCallback(
    async (text: string) => {
      try {
        console.log("Attempting to copy:", text);
        await navigator.clipboard.writeText(text);
        console.log("Copy successful");
        setIsCopied(true);

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Reset after delay
        timeoutRef.current = setTimeout(() => {
          setIsCopied(false);
          timeoutRef.current = null;
        }, resetDelay);
      } catch (error) {
        console.error("Failed to copy:", error);
        console.error("Error details:", {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
      }
    },
    [resetDelay]
  );

  return { copy, isCopied };
}