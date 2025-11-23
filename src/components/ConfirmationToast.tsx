import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from '@tabler/icons-react';

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
    <div className="flex gap-3 w-full">
      <IconAlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
      <div className="flex flex-col gap-3 flex-1">
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
    </div>
  );
}
