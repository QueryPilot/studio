import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useClipboardBridge, writeTextToClipboard } from "../useClipboardBridge";
import type { GridSelection } from "@glideapps/glide-data-grid";
import { CompactSelection } from "@glideapps/glide-data-grid";

describe("useClipboardBridge", () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  const createSelection = (): GridSelection => ({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
    current: undefined,
  });

  it("should copy selection as text", async () => {
    const selection = createSelection();
    const toText = vi.fn(() => "col1\tcol2\nval1\tval2");
    const toJson = vi.fn();
    const onCopySuccess = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson, onCopySuccess }),
    );

    await act(async () => {
      await result.current.copySelection(selection, "text");
    });

    expect(toText).toHaveBeenCalledWith(selection);
    expect(toJson).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("col1\tcol2\nval1\tval2");
    expect(onCopySuccess).toHaveBeenCalledWith("text");
    expect(result.current.lastCopyMode).toBe("text");
  });

  it("should copy selection as JSON", async () => {
    const selection = createSelection();
    const toText = vi.fn();
    const toJson = vi.fn(() => [{ col1: "val1", col2: "val2" }]);
    const onCopySuccess = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson, onCopySuccess }),
    );

    await act(async () => {
      await result.current.copySelection(selection, "json");
    });

    expect(toJson).toHaveBeenCalledWith(selection);
    expect(toText).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(JSON.parse(written)).toEqual([{ col1: "val1", col2: "val2" }]);
    expect(onCopySuccess).toHaveBeenCalledWith("json");
    expect(result.current.lastCopyMode).toBe("json");
  });

  it("should handle copy errors", async () => {
    const selection = createSelection();
    const toText = vi.fn(() => "");
    const toJson = vi.fn();
    const onCopyError = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson, onCopyError }),
    );

    await expect(async () => {
      await act(async () => {
        await result.current.copySelection(selection, "text");
      });
    }).rejects.toThrow("Clipboard payload is empty");

    expect(onCopyError).toHaveBeenCalledWith("text", expect.any(Error));
  });

  it("should handle keyboard copy (Cmd/Ctrl+C)", async () => {
    const selection = createSelection();
    const toText = vi.fn(() => "data");
    const toJson = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson }),
    );

    const event = {
      key: "c",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as any;

    let handled = false;
    await act(async () => {
      handled = await result.current.handleKeyboardCopy(event, selection);
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(toText).toHaveBeenCalled();
    expect(result.current.lastCopyMode).toBe("text");
  });

  it("should handle keyboard copy as JSON (Cmd/Ctrl+Shift+C)", async () => {
    const selection = createSelection();
    const toText = vi.fn();
    const toJson = vi.fn(() => [{ data: "test" }]);

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson }),
    );

    const event = {
      key: "C",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
    } as any;

    let handled = false;
    await act(async () => {
      handled = await result.current.handleKeyboardCopy(event, selection);
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(toJson).toHaveBeenCalled();
    expect(result.current.lastCopyMode).toBe("json");
  });

  it("should not handle non-copy keyboard events", async () => {
    const selection = createSelection();
    const toText = vi.fn();
    const toJson = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson }),
    );

    const event = {
      key: "v",
      metaKey: true,
      preventDefault: vi.fn(),
    } as any;

    let handled = false;
    await act(async () => {
      handled = await result.current.handleKeyboardCopy(event, selection);
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(toText).not.toHaveBeenCalled();
  });

  it("should handle undefined selection gracefully", async () => {
    const toText = vi.fn();
    const toJson = vi.fn();

    const { result } = renderHook(() =>
      useClipboardBridge({ toText, toJson }),
    );

    const event = {
      key: "c",
      metaKey: true,
      preventDefault: vi.fn(),
    } as any;

    let handled = false;
    await act(async () => {
      handled = await result.current.handleKeyboardCopy(event, undefined);
    });

    expect(handled).toBe(false);
    expect(toText).not.toHaveBeenCalled();
  });
});

describe("writeTextToClipboard", () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  it("should write text using navigator.clipboard", async () => {
    await writeTextToClipboard("test text");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test text");
  });

  it("should use fallback when clipboard API fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("Permission denied"));

    // Mock document.execCommand
    document.execCommand = vi.fn().mockReturnValue(true);

    await writeTextToClipboard("test text");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});
