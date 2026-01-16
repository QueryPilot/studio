import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { ZSetEditor } from "./ZSetEditor";
import { StreamViewer } from "./StreamViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));


describe("ZSetEditor", () => {
  const defaultProps = {
    connectionId: "conn-1",
    database: 0,
    keyName: "my-zset",
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as any).mockResolvedValue([
      { member: "alice", score: "100" },
      { member: "bob", score: "85" },
      { member: "charlie", score: "92" },
    ]);
  });

  it("renders member/score grid", async () => {
    render(<ZSetEditor {...defaultProps} />);

    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("has add member form", () => {
    render(<ZSetEditor {...defaultProps} />);

    expect(screen.getByPlaceholderText("Member")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Score")).toBeInTheDocument();
    expect(screen.getByText("Add")).toBeInTheDocument();
  });

  it("allows entering new member values", () => {
    render(<ZSetEditor {...defaultProps} />);

    const memberInput = screen.getByPlaceholderText("Member");
    const scoreInput = screen.getByPlaceholderText("Score");

    fireEvent.change(memberInput, { target: { value: "david" } });
    fireEvent.change(scoreInput, { target: { value: "95" } });

    expect(memberInput).toHaveValue("david");
    expect(scoreInput).toHaveValue(95);
  });
});

describe("StreamViewer", () => {
  const singleEntryProps = {
    connectionId: "conn-1",
    keyName: "my-stream",
    value: [
      {
        id: "1704067200000-0",
        fields: { action: "login", user: "alice" },
      },
    ],
  };

  it("renders stream entries", () => {
    render(<StreamViewer {...singleEntryProps} />);

    expect(screen.getByText("1704067200000-0")).toBeInTheDocument();
    expect(screen.getByText("action")).toBeInTheDocument();
    expect(screen.getByText("login")).toBeInTheDocument();
  });

  it("shows entry fields as key-value pairs", () => {
    render(<StreamViewer {...singleEntryProps} />);

    expect(screen.getByText("user")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("shows read-only indicator", () => {
    render(<StreamViewer {...singleEntryProps} />);

    expect(screen.getByText("1 entry/entries (read-only view)")).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    const emptyProps = {
      connectionId: "conn-1",
      keyName: "my-stream",
      value: [],
    };
    render(<StreamViewer {...emptyProps} />);

    expect(screen.getByText("No entries")).toBeInTheDocument();
    expect(screen.getByText("0 entry/entries (read-only view)")).toBeInTheDocument();
  });
});
