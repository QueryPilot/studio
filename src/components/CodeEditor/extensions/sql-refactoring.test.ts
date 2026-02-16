import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { RefactorAction } from "../languages/sql/refactor-service";
import { executeRefactorAction } from "./sql-refactoring";

const startRenameMock = vi.hoisted(() => vi.fn());
const getRefactorActionsMock = vi.hoisted(() => vi.fn());

vi.mock("./inline-rename", () => ({
  startRename: (...args: unknown[]) => startRenameMock(...args),
  createInlineRenameExtension: () => [],
}));

vi.mock("../languages/sql/refactor-service", async () => {
  const actual = await vi.importActual("../languages/sql/refactor-service");
  return {
    ...actual,
    getRefactorActions: (...args: unknown[]) => getRefactorActionsMock(...args),
  };
});

function createMockView(params?: {
  sql?: string;
  cursorOffset?: number;
}): { view: EditorView; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const sql = params?.sql ?? "SELECT 1";
  const cursorOffset = params?.cursorOffset ?? 0;
  const view = {
    dispatch,
    state: {
      doc: {
        toString: () => sql,
        length: sql.length,
      },
      selection: {
        main: { from: cursorOffset },
      },
    },
  } as unknown as EditorView;
  return { view, dispatch };
}

describe("executeRefactorAction", () => {
  beforeEach(() => {
    startRenameMock.mockReset();
    getRefactorActionsMock.mockReset();
  });

  it("calls onExtractCte when extract_cte action is executed", async () => {
    const action: RefactorAction = {
      kind: "extract_cte",
      label: "Extract to CTE",
      symbol: null,
      span: { start: 10, end: 20 },
      enabled: true,
      disabled_reason: null,
    };
    const { view } = createMockView({
      sql: "SELECT * FROM users WHERE active = true",
      cursorOffset: 12,
    });
    const onExtractCte = vi.fn();
    getRefactorActionsMock.mockResolvedValue([action]);

    await executeRefactorAction(view, action, "postgresql", { onExtractCte });

    expect(onExtractCte).toHaveBeenCalledWith({ start: 10, end: 20 });
  });

  it("positions the cursor and starts rename for rename action", async () => {
    const action: RefactorAction = {
      kind: "rename",
      label: "Rename",
      symbol: "u",
      span: { start: 5, end: 6 },
      enabled: true,
      disabled_reason: null,
    };
    const { view, dispatch } = createMockView({
      sql: "SELECT * FROM users u",
      cursorOffset: 5,
    });
    getRefactorActionsMock.mockResolvedValue([action]);

    await executeRefactorAction(view, action, "postgresql");

    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 5 },
    });
    expect(startRenameMock).toHaveBeenCalledWith(view, "postgresql");
  });

  it("re-resolves and executes the latest matching action span", async () => {
    const staleAction: RefactorAction = {
      kind: "rename",
      label: "Rename",
      symbol: "u",
      span: { start: 5, end: 6 },
      enabled: true,
      disabled_reason: null,
    };
    const refreshedAction: RefactorAction = {
      ...staleAction,
      span: { start: 15, end: 16 },
    };
    const { view, dispatch } = createMockView({
      sql: "SELECT * FROM users AS u",
      cursorOffset: 15,
    });
    getRefactorActionsMock.mockResolvedValue([refreshedAction]);

    await executeRefactorAction(view, staleAction, "postgresql", {
      sourceCursorOffset: staleAction.span.start,
    });

    expect(getRefactorActionsMock).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 15 },
    });
    expect(startRenameMock).toHaveBeenCalledWith(view, "postgresql");
  });

  it("skips execution when action is no longer valid in current state", async () => {
    const staleAction: RefactorAction = {
      kind: "extract_cte",
      label: "Extract to CTE",
      symbol: null,
      span: { start: 10, end: 20 },
      enabled: true,
      disabled_reason: null,
    };
    const { view, dispatch } = createMockView({
      sql: "SELECT * FROM users",
      cursorOffset: 5,
    });
    const onExtractCte = vi.fn();
    getRefactorActionsMock.mockResolvedValue([]);

    await executeRefactorAction(view, staleAction, "postgresql", {
      onExtractCte,
      sourceCursorOffset: staleAction.span.start,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onExtractCte).not.toHaveBeenCalled();
    expect(startRenameMock).not.toHaveBeenCalled();
  });
});
