import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlEditorRef } from "@/components/CodeEditor/SqlEditor";
import { useDuckDbFileDrop } from "../useDuckDbFileDrop";
import { useDuckDbSidebarDrop } from "../useDuckDbSidebarDrop";

const { onDragDropEventMock } = vi.hoisted(() => ({
  onDragDropEventMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: onDragDropEventMock,
  }),
}));

type NativeDropPayload =
  | {
      type: "enter";
      paths: string[];
      position: { x: number; y: number };
    }
  | {
      type: "over";
      position: { x: number; y: number };
    }
  | {
      type: "drop";
      paths: string[];
      position: { x: number; y: number };
    }
  | {
      type: "leave";
    };

type NativeDropHandler = (event: { payload: NativeDropPayload }) => void;

function makeDomStringListTypes(types: string[]): DataTransfer["types"] {
  return {
    length: types.length,
    contains: (type: string) => types.includes(type),
    item: (index: number) => types[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* types;
    },
  } as unknown as DataTransfer["types"];
}

function makeFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    },
  } as FileList & Record<number, File>;

  files.forEach((file, index) => {
    fileList[index] = file;
  });

  return fileList;
}

function makeFile(name: string, path: string): File {
  const file = new File(["id,name\n1,Ada"], name, { type: "text/csv" });
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  });
  return file;
}

function makeDataTransfer({
  types,
  files = [],
  data = {},
}: {
  types: string[];
  files?: File[];
  data?: Record<string, string>;
}): DataTransfer {
  return {
    dropEffect: "none",
    files: makeFileList(files),
    getData: (type: string) => data[type] ?? "",
    types: makeDomStringListTypes(types),
  } as unknown as DataTransfer;
}

function setDropZoneRect(element: HTMLElement, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    top: 0,
    right: 200,
    bottom: 200,
    left: 0,
    toJSON: () => ({}),
    ...rect,
  })) as HTMLElement["getBoundingClientRect"];
}

function dispatchDragEvent(
  target: HTMLElement,
  type: "dragenter" | "drop",
  dataTransfer: DataTransfer,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: dataTransfer,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  onDragDropEventMock.mockReset();
  onDragDropEventMock.mockResolvedValue(() => undefined);
});

describe("useDuckDbSidebarDrop", () => {
  it("handles file drags when DataTransfer.types is DOMStringList-like", async () => {
    const onFilesDropped = vi.fn();
    const dropZone = document.createElement("div");
    document.body.appendChild(dropZone);

    const { result, unmount } = renderHook(() =>
      useDuckDbSidebarDrop({
        enabled: true,
        onFilesDropped,
        onUrlDropped: vi.fn(),
      }),
    );

    act(() => {
      result.current.dropZoneRef(dropZone);
    });

    const dataTransfer = makeDataTransfer({
      types: ["Files"],
      files: [makeFile("people.csv", "/tmp/people.csv")],
    });

    dispatchDragEvent(dropZone, "dragenter", dataTransfer);

    await waitFor(() => {
      expect(result.current.isDragOver).toBe(true);
    });

    dispatchDragEvent(dropZone, "drop", dataTransfer);

    expect(onFilesDropped).toHaveBeenCalledWith([
      { name: "people.csv", path: "/tmp/people.csv" },
    ]);

    await waitFor(() => {
      expect(result.current.isDragOver).toBe(false);
    });

    unmount();
    dropZone.remove();
  });

  it("sees file drags before nested sidebar rows can stop propagation", async () => {
    const onFilesDropped = vi.fn();
    const dropZone = document.createElement("div");
    const row = document.createElement("div");
    row.addEventListener("dragenter", (event) => {
      event.stopPropagation();
    });
    dropZone.appendChild(row);
    document.body.appendChild(dropZone);

    const { result, unmount } = renderHook(() =>
      useDuckDbSidebarDrop({
        enabled: true,
        onFilesDropped,
        onUrlDropped: vi.fn(),
      }),
    );

    act(() => {
      result.current.dropZoneRef(dropZone);
    });

    dispatchDragEvent(
      row,
      "dragenter",
      makeDataTransfer({
        types: ["Files"],
        files: [makeFile("people.csv", "/tmp/people.csv")],
      }),
    );

    await waitFor(() => {
      expect(result.current.isDragOver).toBe(true);
    });

    unmount();
    dropZone.remove();
  });

  it("routes URL drops from uri-list payloads", () => {
    const onUrlDropped = vi.fn();
    const dropZone = document.createElement("div");
    document.body.appendChild(dropZone);

    const { result, unmount } = renderHook(() =>
      useDuckDbSidebarDrop({
        enabled: true,
        onFilesDropped: vi.fn(),
        onUrlDropped,
      }),
    );

    act(() => {
      result.current.dropZoneRef(dropZone);
    });

    dispatchDragEvent(
      dropZone,
      "drop",
      makeDataTransfer({
        types: ["text/uri-list"],
        data: {
          "text/uri-list":
            "# dragged link\nhttps://example.com/downloads/events.parquet",
        },
      }),
    );

    expect(onUrlDropped).toHaveBeenCalledWith(
      "https://example.com/downloads/events.parquet",
    );

    unmount();
    dropZone.remove();
  });

  it("passes pathless file drops to the caller for error handling", () => {
    const onFilesDropped = vi.fn();
    const dropZone = document.createElement("div");
    document.body.appendChild(dropZone);

    const { result, unmount } = renderHook(() =>
      useDuckDbSidebarDrop({
        enabled: true,
        onFilesDropped,
        onUrlDropped: vi.fn(),
      }),
    );

    act(() => {
      result.current.dropZoneRef(dropZone);
    });

    dispatchDragEvent(
      dropZone,
      "drop",
      makeDataTransfer({
        types: ["Files"],
        files: [new File(["id,name\n1,Ada"], "people.csv")],
      }),
    );

    expect(onFilesDropped).toHaveBeenCalledWith([{ name: "people.csv" }]);

    unmount();
    dropZone.remove();
  });

  it("handles native Tauri Finder drops over the drop zone", async () => {
    const onFilesDropped = vi.fn();
    const dropZone = document.createElement("div");
    setDropZoneRect(dropZone, {});
    document.body.appendChild(dropZone);

    const { result, unmount } = renderHook(() =>
      useDuckDbSidebarDrop({
        enabled: true,
        onFilesDropped,
        onUrlDropped: vi.fn(),
      }),
    );

    act(() => {
      result.current.dropZoneRef(dropZone);
    });

    await waitFor(() => {
      expect(onDragDropEventMock).toHaveBeenCalled();
    });

    const handler = onDragDropEventMock.mock.calls[0]?.[0] as NativeDropHandler;

    act(() => {
      handler({
        payload: {
          type: "enter",
          paths: ["/tmp/people.csv"],
          position: { x: 20, y: 20 },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.isDragOver).toBe(true);
    });

    act(() => {
      handler({
        payload: {
          type: "drop",
          paths: ["/tmp/people.csv"],
          position: { x: 20, y: 20 },
        },
      });
    });

    expect(onFilesDropped).toHaveBeenCalledWith([
      { name: "people.csv", path: "/tmp/people.csv" },
    ]);

    await waitFor(() => {
      expect(result.current.isDragOver).toBe(false);
    });

    unmount();
    dropZone.remove();
  });
});

describe("useDuckDbFileDrop", () => {
  function EditorDropZone({
    editorRef,
  }: {
    editorRef: RefObject<SqlEditorRef | null>;
  }) {
    const { dropZoneRef, isFileDragOver } = useDuckDbFileDrop(
      editorRef,
      "duckdb",
    );

    return (
      <div
        ref={dropZoneRef}
        data-testid="editor-drop-zone"
        data-over={String(isFileDragOver)}
      />
    );
  }

  it("keeps editor file drop working with DOMStringList-like types", async () => {
    const replaceSelection = vi.fn();
    const focus = vi.fn();
    const editorRef = {
      current: {
        replaceSelection,
        focus,
      } as unknown as SqlEditorRef,
    };

    render(<EditorDropZone editorRef={editorRef} />);

    const dropZone = screen.getByTestId("editor-drop-zone");
    const dataTransfer = makeDataTransfer({
      types: ["Files"],
      files: [makeFile("people.csv", "/tmp/people.csv")],
    });

    dispatchDragEvent(dropZone, "dragenter", dataTransfer);

    await waitFor(() => {
      expect(dropZone).toHaveAttribute("data-over", "true");
    });

    dispatchDragEvent(dropZone, "drop", dataTransfer);

    expect(replaceSelection).toHaveBeenCalledWith(
      "SELECT * FROM read_csv_auto('/tmp/people.csv');",
    );
    expect(focus).toHaveBeenCalled();

    await waitFor(() => {
      expect(dropZone).toHaveAttribute("data-over", "false");
    });
  });
});
