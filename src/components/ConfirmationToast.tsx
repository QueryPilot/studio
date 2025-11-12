import { Button } from "@/components/ui/button";

interface ConfirmationToastProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationToast({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmationToastProps) {
  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-col gap-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <div className="flex gap-2 w-full pt-2">
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          size="xs"
          className="flex-1"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
