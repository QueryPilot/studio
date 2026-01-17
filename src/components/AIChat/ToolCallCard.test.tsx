/**
 * Tool Call Card Tests
 *
 * Tests for friendly tool call visualization component.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallCard } from "./ToolCallCard";

describe("ToolCallCard", () => {
  it("should display friendly tool name", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: ["users", "posts"] }}
      />
    );

    expect(screen.getByText("List Tables")).toBeInTheDocument();
    expect(screen.queryByText("list_tables")).not.toBeInTheDocument();
  });

  it("should show pending state", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="pending"
        input={{ schema: "public" }}
      />
    );

    expect(screen.getByText("List Tables")).toBeInTheDocument();
    // Should show loading indicator
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Executing List Tables.../i)).toBeInTheDocument();
  });

  it("should show success state with summary", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: ["users", "posts"] }}
        summary="Found 2 tables in schema public"
      />
    );

    expect(screen.getByText(/Found 2 tables/i)).toBeInTheDocument();
  });

  it("should show error state", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="error"
        input={{ schema: "public" }}
        error="Connection timeout"
      />
    );

    expect(screen.getByText(/Connection timeout/i)).toBeInTheDocument();
  });

  it("should expand to show details", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: [{ name: "users" }, { name: "posts" }] }}
      />
    );

    const expandButton = screen.getByRole("button", { name: /details/i });
    await user.click(expandButton);

    // Details should be visible after expanding
    expect(screen.getByText(/users/i)).toBeInTheDocument();
    expect(screen.getByText(/posts/i)).toBeInTheDocument();
  });

  it("should collapse details when clicked again", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public" }}
        output={{ tables: [{ name: "users" }] }}
      />
    );

    const expandButton = screen.getByRole("button", { name: /details/i });

    // Expand
    await user.click(expandButton);
    let detailsElement = screen.queryByTestId("tool-details");
    expect(detailsElement).toBeInTheDocument();

    // Collapse
    await user.click(expandButton);
    // Details should not be in the document when collapsed
    detailsElement = screen.queryByTestId("tool-details");
    expect(detailsElement).not.toBeInTheDocument();
  });

  it("should display input parameters", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="success"
        input={{ schema: "public", database: "mydb" }}
        output={{ tables: [] }}
      />
    );

    const expandButton = screen.getByRole("button", { name: /details/i });
    await user.click(expandButton);

    expect(screen.getByText(/public/i)).toBeInTheDocument();
    expect(screen.getByText(/mydb/i)).toBeInTheDocument();
  });

  it("should not show expand button for pending status", () => {
    render(
      <ToolCallCard
        toolName="list_tables"
        friendlyName="List Tables"
        status="pending"
        input={{ schema: "public" }}
      />
    );

    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
  });

  it("should display different icons for different statuses", () => {
    const { rerender } = render(
      <ToolCallCard
        toolName="test"
        friendlyName="Test"
        status="pending"
        input={{}}
      />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <ToolCallCard
        toolName="test"
        friendlyName="Test"
        status="success"
        input={{}}
        output={{}}
      />
    );
    expect(screen.getByTestId("success-icon")).toBeInTheDocument();

    rerender(
      <ToolCallCard
        toolName="test"
        friendlyName="Test"
        status="error"
        input={{}}
        error="Error"
      />
    );
    expect(screen.getByTestId("error-icon")).toBeInTheDocument();
  });
});
