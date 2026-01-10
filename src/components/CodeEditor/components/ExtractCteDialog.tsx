/**
 * Extract to CTE Dialog
 *
 * Dialog for extracting a subquery to a Common Table Expression (CTE).
 * Prompts user for CTE name and validates it before applying the refactoring.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IconAlertCircle } from "@tabler/icons-react";

interface ExtractCteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (cteName: string) => void | Promise<void>;
  defaultName?: string;
}

/**
 * Validate CTE name (must be valid SQL identifier)
 */
function validateCteName(name: string): string | null {
  if (!name.trim()) {
    return "Name cannot be empty";
  }

  const trimmed = name.trim();

  // Must start with letter or underscore
  if (!/^[a-zA-Z_]/.test(trimmed)) {
    return "Name must start with letter or underscore";
  }

  // Must contain only alphanumeric and underscore
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return "Name can only contain letters, numbers, and underscores";
  }

  // Check reserved keywords (common ones)
  const reservedKeywords = [
    "select",
    "from",
    "where",
    "insert",
    "update",
    "delete",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "on",
    "and",
    "or",
    "not",
    "in",
    "exists",
    "between",
    "like",
    "is",
    "null",
    "true",
    "false",
    "case",
    "when",
    "then",
    "else",
    "end",
    "as",
    "table",
    "view",
    "index",
    "constraint",
  ];

  if (reservedKeywords.includes(trimmed.toLowerCase())) {
    return "Name cannot be a reserved keyword";
  }

  return null;
}

export function ExtractCteDialog({
  open,
  onOpenChange,
  onConfirm,
  defaultName = "cte_name",
}: ExtractCteDialogProps) {
  const [cteName, setCteName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateCteName(cteName);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await onConfirm(cteName.trim());
      onOpenChange(false);
      // Reset for next use
      setCteName(defaultName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract CTE");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    setError(null);
    setCteName(defaultName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Extract to CTE</DialogTitle>
            <DialogDescription>
              Extract the selected subquery into a Common Table Expression.
              Enter a name for the CTE.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="cte-name">CTE Name</Label>
              <Input
                id="cte-name"
                value={cteName}
                onChange={(e) => {
                  setCteName(e.target.value);
                  setError(null);
                }}
                placeholder="my_cte"
                autoFocus
                disabled={isSubmitting}
                className="font-mono"
              />
              {error && (
                <Alert variant="destructive" className="mt-2">
                  <IconAlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>CTE name rules:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Must start with a letter or underscore</li>
                <li>Can contain letters, numbers, and underscores</li>
                <li>Cannot be a SQL reserved keyword</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Extracting..." : "Extract"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
