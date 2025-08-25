import { memo } from "react";
import { cn } from "@/lib/utils";
import { FileText, Download } from "lucide-react";
import type { CellRendererProps } from "../types";

export const BinaryCell = memo(function BinaryCell({
  value,
  isSelected,
  isHovered,
}: CellRendererProps) {
  const binaryValue = value?.value_type === "Binary" ? value.value : null;

  const formatSize = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getSize = (): number => {
    if (!binaryValue) return 0;

    if (typeof binaryValue === "string") {
      return binaryValue.length;
    }

    if (binaryValue instanceof Uint8Array) {
      return binaryValue.byteLength;
    }

    if (Array.isArray(binaryValue)) {
      return binaryValue.length;
    }

    return 0;
  };

  const toHex = (data: any): string => {
    if (!data) return "";

    let bytes: number[] = [];

    if (typeof data === "string") {
      for (let i = 0; i < Math.min(data.length, 32); i++) {
        bytes.push(data.charCodeAt(i));
      }
    } else if (data instanceof Uint8Array) {
      bytes = Array.from(data.slice(0, 32));
    } else if (Array.isArray(data)) {
      bytes = data.slice(0, 32);
    }

    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    return (Array.isArray(data) || typeof data === "string") && data.length > 32
      ? `${hex}...`
      : hex;
  };

  const handleDownload = () => {
    if (!binaryValue) return;

    let blobPart: BlobPart;
    if (binaryValue instanceof Uint8Array) {
      blobPart = new Uint8Array(binaryValue); // BlobPart
    } else if (typeof binaryValue === "string") {
      blobPart = binaryValue; // Blob accepts string
    } else if (Array.isArray(binaryValue)) {
      blobPart = new Uint8Array(binaryValue); // BlobPart
    } else {
      blobPart = new Uint8Array([]);
    }

    const blob = new Blob([blobPart]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `data_${Date.now()}.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const size = getSize();
  const hexPreview = toHex(binaryValue);

  return (
    <div
      className={cn(
        "px-2 py-1 text-sm flex items-center gap-1 cursor-default group",
        isSelected && "bg-accent/50",
        isHovered && !isSelected && "bg-muted/50",
      )}
      title={`Binary data (${formatSize(size)})`}
    >
      {binaryValue !== null ? (
        <>
          <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 flex flex-col min-w-0">
            <span className="text-xs text-muted-foreground">
              {formatSize(size)}
            </span>
            <span className="font-mono text-xs truncate text-muted-foreground">
              {hexPreview}
            </span>
          </div>
          <button
            onClick={handleDownload}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
            title="Download"
          >
            <Download className="h-3 w-3" />
          </button>
        </>
      ) : (
        <span className="text-muted-foreground">NULL</span>
      )}
    </div>
  );
});
