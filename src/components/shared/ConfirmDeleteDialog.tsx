import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ReactNode } from "react";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  entityName?: string;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "default";
  extraContent?: ReactNode;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  entityName,
  onConfirm,
  confirmLabel = "Delete",
  confirmVariant = "destructive",
  extraContent,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            {entityName && (
              <span className="block mt-2 font-mono text-xs text-foreground">
                {entityName}
              </span>
            )}
          </AlertDialogDescription>
          {extraContent && <div className="mt-3 w-full">{extraContent}</div>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              confirmVariant === "destructive"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
