import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesStore } from "@/stores/preferencesStore";

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreferencesDialog({
  open,
  onOpenChange,
}: PreferencesDialogProps) {
  const { smartQueryLimit, setSmartQueryLimit } = usePreferencesStore();
  const limits = [100, 1000, 5000, 10000, 50000, 100000];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="query-limit">Default Query Limit</Label>
            <p className="text-xs text-muted-foreground">
              Automatically limit queries without LIMIT clause to prevent
              accidentally fetching too many rows
            </p>
            <Select
              value={smartQueryLimit?.toString() ?? "null"}
              onValueChange={(value) => {
                if (value === "null") {
                  setSmartQueryLimit(null);
                } else {
                  setSmartQueryLimit(Number(value));
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {limits.map((limit) => (
                  <SelectItem key={limit} value={limit.toString()}>
                    {limit.toLocaleString()} rows
                  </SelectItem>
                ))}
                <SelectItem value="null">No limit (not recommended)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Default: 10,000 rows. Use "No limit" with caution on large tables.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
