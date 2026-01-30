/**
 * Code Block Component
 *
 * Displays code with syntax highlighting and copy functionality.
 * Replaces Vercel AI Elements code-block component.
 */

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import type { CodeBlockProps } from "./types";

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  }, [code]);

  const lines = code.split("\n");

  return (
    <div
      data-slot="code-block"
      className={cn(
        "group relative rounded-md border bg-muted/50 text-xs",
        className
      )}
    >
      {/* Header */}
      {language && (
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            {language}
          </span>
          <CopyButton copied={copied} onClick={handleCopy} />
        </div>
      )}

      {/* Code Content */}
      <div className="relative overflow-x-auto p-3">
        {!language && (
          <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton copied={copied} onClick={handleCopy} />
          </div>
        )}

        <pre className="font-mono text-[11px] leading-relaxed">
          {showLineNumbers ? (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="w-8 select-none pr-3 text-right text-muted-foreground/50">
                      {i + 1}
                    </td>
                    <td className="whitespace-pre">{line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    </div>
  );
}

// ============ Sub-components ============

interface CopyButtonProps {
  copied: boolean;
  onClick: () => void;
}

function CopyButton({ copied, onClick }: CopyButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      className="h-5 w-5"
    >
      {copied ? (
        <IconCheck className="h-3 w-3 text-green-500" />
      ) : (
        <IconCopy className="h-3 w-3" />
      )}
    </Button>
  );
}
