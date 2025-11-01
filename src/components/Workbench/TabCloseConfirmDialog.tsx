import { memo } from "react";

interface TabCloseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  metadata: unknown;
  connectionId: string;
}

export const TabCloseConfirmDialog = memo(function TabCloseConfirmDialog(
  _props: TabCloseConfirmDialogProps,
) {
  // Table editing has been removed, so tab closing never requires confirmation.
  return null;
});
