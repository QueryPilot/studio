import { render, screen } from "@testing-library/react";
import { DocumentEditor } from "./index";
import { describe, it, expect, vi } from "vitest";
import React from "react";

// Mock the UI components to avoid rendering issues in test environment if needed
// For now, we rely on standard rendering

describe("DocumentEditor", () => {
  const defaultProps = {
    document: { a: { b: 1 } },
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  it("shows breadcrumb path", () => {
    render(<DocumentEditor {...defaultProps} />);
    // Expect "root" to be visible as part of breadcrumbs
    expect(screen.getByText("root")).toBeInTheDocument();
  });

  it("renders tree view structure", () => {
    render(<DocumentEditor {...defaultProps} />);
    // Should show keys
    expect(screen.getByText("a:")).toBeInTheDocument();
    expect(screen.getByText("b:")).toBeInTheDocument();
    // Should show value
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
