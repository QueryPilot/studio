import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SqlEditor, type SqlEditorRef } from "./SqlEditor";

const diagnosticsStatusRef: { current: string } = { current: "idle" };
const createDialectLinterMock = vi.hoisted(() =>
  vi.fn(
    (
      _dialect: string,
      options?: { onDiagnosticsStatusChange?: (status: string) => void },
    ) => {
      if (options?.onDiagnosticsStatusChange) {
        queueMicrotask(() =>
          options.onDiagnosticsStatusChange?.(diagnosticsStatusRef.current),
        );
      }
      return [];
    },
  ),
);

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/components/KeyboardProvider", () => ({
  useKeyboardServicesOptional: () => null,
}));

vi.mock("@/hooks/useRustSchemaSync", () => ({
  useRustSchemaSync: () => undefined,
}));

vi.mock("./languages/sql/linter-strategy", () => ({
  createDialectLinter: (...args: Parameters<typeof createDialectLinterMock>) =>
    createDialectLinterMock(...args),
}));

describe("SqlEditor", () => {
  it("uses the injected destructive query confirmation before executing", async () => {
    const confirmDestructiveQuery = vi.fn().mockResolvedValue(false);
    const onExecute = vi.fn();
    const editorRef = createRef<SqlEditorRef>();

    render(
      <SqlEditor
        ref={editorRef}
        value="DROP TABLE users;"
        connectionId="conn-1"
        database="app"
        schema="public"
        onExecute={onExecute}
        confirmDestructiveQuery={confirmDestructiveQuery}
        autoFocus
      />,
    );

    const editor = editorRef.current?.view?.contentDOM ?? document.querySelector(".cm-content");
    expect(editor).not.toBeNull();

    act(() => {
      (editor as HTMLElement).focus();
      fireEvent.focus(editor as Element);
      fireEvent.keyDown(editor as Element, {
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
    });

    await waitFor(() => {
      expect(confirmDestructiveQuery).toHaveBeenCalledTimes(1);
    });
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("renders the diagnostics status surface from the lint lifecycle", async () => {
    diagnosticsStatusRef.current = "stale_schema";
    createDialectLinterMock.mockClear();

    render(
      <SqlEditor
        value="select 1"
        connectionId="conn-1"
        database="app"
        schema="public"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Editor diagnostics status")).toHaveTextContent(
        "Schema stale",
      );
    });
  });

  it("reconnects diagnostics status updates after the editor wakes", async () => {
    diagnosticsStatusRef.current = "stale_schema";
    createDialectLinterMock.mockClear();
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    render(
      <SqlEditor
        value="select 1"
        connectionId="conn-1"
        database="app"
        schema="public"
      />,
    );

    const editor = document.querySelector(".cm-content");
    expect(editor).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByLabelText("Editor diagnostics status")).toHaveTextContent(
        "Schema stale",
      );
    });

    const callCountBeforeWake = createDialectLinterMock.mock.calls.length;

    act(() => {
      fireEvent.focusIn(editor as Element);
      fireEvent.focusOut(editor as Element, { relatedTarget: outside });
    });

    diagnosticsStatusRef.current = "ready";

    act(() => {
      fireEvent.focusIn(editor as Element);
    });

    await waitFor(() => {
      expect(createDialectLinterMock.mock.calls.length).toBeGreaterThan(
        callCountBeforeWake,
      );
    });

    const wakeCall = createDialectLinterMock.mock.calls.at(-1);
    expect(wakeCall?.[1]).toMatchObject({
      onDiagnosticsStatusChange: expect.any(Function),
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Editor diagnostics status")).toHaveTextContent(
        "Schema ready",
      );
    });

    outside.remove();
  });
});
