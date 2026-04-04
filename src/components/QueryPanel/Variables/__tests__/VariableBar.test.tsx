import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariableBar } from "../VariableBar";
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

describe("VariableBar", () => {
  it("renders variable chips for each variable", () => {
    const vars = makeVars([
      ["region", { name: "region", value: "US West" }],
      ["date", { name: "date", value: "2024-01-01", type: "date" }],
    ]);

    render(
      <VariableBar
        variables={vars}
        hasPositionalVariables={false}
        scope="global"
        onScopeChange={vi.fn()}
        onValueChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("date")).toBeInTheDocument();
    expect(screen.getByText("US West")).toBeInTheDocument();
  });

  it("returns null when no variables", () => {
    const { container } = render(
      <VariableBar
        variables={{}}
        hasPositionalVariables={false}
        scope="global"
        onScopeChange={vi.fn()}
        onValueChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows scope toggle when positional variables exist", () => {
    const vars = makeVars([
      ["#1", { name: "#1", syntax: "question_mark" }],
    ]);

    render(
      <VariableBar
        variables={vars}
        hasPositionalVariables={true}
        scope="global"
        onScopeChange={vi.fn()}
        onValueChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Per-stmt")).toBeInTheDocument();
  });

  it("hides scope toggle when no positional variables", () => {
    const vars = makeVars([
      ["region", { name: "region" }],
    ]);

    render(
      <VariableBar
        variables={vars}
        hasPositionalVariables={false}
        scope="global"
        onScopeChange={vi.fn()}
        onValueChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Global")).not.toBeInTheDocument();
    expect(screen.queryByText("Per-stmt")).not.toBeInTheDocument();
  });

  it("highlights empty variables with amber styling", () => {
    const vars = makeVars([
      ["region", { name: "region", value: "" }],
    ]);

    render(
      <VariableBar
        variables={vars}
        hasPositionalVariables={false}
        scope="global"
        onScopeChange={vi.fn()}
        onValueChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    );

    const chip = screen.getByTitle("region: (empty)");
    expect(chip.className).toContain("amber");
  });
});
