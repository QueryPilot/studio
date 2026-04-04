import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariablePanel } from "../VariablePanel";
import type { QueryVariable } from "@/lib/queryVariables/types";

function makeVars(entries: Array<[string, Partial<QueryVariable>]>): Record<string, QueryVariable> {
  const result: Record<string, QueryVariable> = {};
  for (const [key, partial] of entries) {
    result[key] = {
      name: partial.name ?? key,
      value: partial.value ?? "",
      type: partial.type ?? "text",
      syntax: partial.syntax ?? "mustache",
      ...partial,
    } as QueryVariable;
  }
  return result;
}

describe("VariablePanel", () => {
  const defaultProps = {
    scope: "global" as const,
    statementCount: 1,
    onScopeChange: vi.fn(),
    onValueChange: vi.fn(),
    onTypeChange: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders named variables section", () => {
    const vars = makeVars([
      ["region", { name: "region", syntax: "mustache" }],
      ["user_id", { name: "user_id", syntax: "colon", type: "number" }],
    ]);

    render(
      <VariablePanel
        {...defaultProps}
        variables={vars}
        hasPositionalVariables={false}
      />,
    );

    expect(screen.getByText("Named Variables")).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("user_id")).toBeInTheDocument();
  });

  it("renders positional parameters section", () => {
    const vars = makeVars([
      ["$1", { name: "$1", syntax: "dollar_num" }],
      ["#1", { name: "#1", syntax: "question_mark" }],
    ]);

    render(
      <VariablePanel
        {...defaultProps}
        variables={vars}
        hasPositionalVariables={true}
      />,
    );

    expect(screen.getByText("Positional Parameters")).toBeInTheDocument();
    expect(screen.getByText("$1")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("shows empty state when no variables", () => {
    render(
      <VariablePanel
        {...defaultProps}
        variables={{}}
        hasPositionalVariables={false}
      />,
    );

    expect(screen.getByText(/No variables detected/)).toBeInTheDocument();
  });

  it("shows scope toggle when positional variables exist", () => {
    const vars = makeVars([
      ["$1", { name: "$1", syntax: "dollar_num" }],
    ]);

    render(
      <VariablePanel
        {...defaultProps}
        variables={vars}
        hasPositionalVariables={true}
      />,
    );

    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Per-stmt")).toBeInTheDocument();
  });

  it("renders close button", () => {
    render(
      <VariablePanel
        {...defaultProps}
        variables={{}}
        hasPositionalVariables={false}
      />,
    );

    expect(screen.getByTitle("Close Variables")).toBeInTheDocument();
  });

  it("groups positional params by statement in per_statement mode", () => {
    const vars = makeVars([
      ["stmt:0:$1", { name: "$1", syntax: "dollar_num", statementIndex: 0 }],
      ["stmt:1:$1", { name: "$1", syntax: "dollar_num", statementIndex: 1 }],
    ]);

    render(
      <VariablePanel
        {...defaultProps}
        variables={vars}
        hasPositionalVariables={true}
        scope="per_statement"
        statementCount={2}
      />,
    );

    expect(screen.getByText("Statement 1")).toBeInTheDocument();
    expect(screen.getByText("Statement 2")).toBeInTheDocument();
  });
});
