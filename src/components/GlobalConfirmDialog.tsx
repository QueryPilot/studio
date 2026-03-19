import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useDialogStore } from "@/stores/ui/dialogStore";
import { IconAlertTriangle } from "@tabler/icons-react";

export function GlobalConfirmDialog() {
  const { confirmDialog, resolveConfirm } = useDialogStore();

  return (
    <AlertDialog
      open={confirmDialog !== null}
      onOpenChange={(open) => {
        if (!open) { resolveConfirm(false); }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <IconAlertTriangle className="size-4" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {confirmDialog?.title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmDialog?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { resolveConfirm(false); }}>
            {confirmDialog?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmDialog?.variant ?? "destructive"}
            onClick={() => { resolveConfirm(true); }}
          >
            {confirmDialog?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
