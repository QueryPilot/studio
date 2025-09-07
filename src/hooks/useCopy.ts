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
        await navigator.clipboard.writeText(text);
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
        // Silently fail - clipboard access might be denied
      }
    },
    [resetDelay]
  );

  return { copy, isCopied };
}