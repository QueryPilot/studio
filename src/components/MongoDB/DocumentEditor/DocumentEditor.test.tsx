import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TreeView, TreeNode } from "./TreeView";
import { Breadcrumb } from "./Breadcrumb";
import { DocumentEditor } from "./index";

describe("TreeView", () => {
  it("renders simple object properties", () => {
    const data = { name: "John", age: 30 };
    const onNavigate = vi.fn();

    render(
      <TreeView data={data} currentPath={[]} onNavigate={onNavigate} />
    );

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText('"John"')).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders nested objects with expand/collapse", () => {
    const data = {
      user: { name: "Alice", email: "alice@test.com" },
    };
    const onNavigate = vi.fn();

    render(
      <TreeView data={data} currentPath={[]} onNavigate={onNavigate} />
    );

    expect(screen.getByText("user")).toBeInTheDocument();
  });

  it("renders arrays with indices", () => {
    const data = { items: ["apple", "banana", "cherry"] };
    const onNavigate = vi.fn();

    render(
      <TreeView data={data} currentPath={[]} onNavigate={onNavigate} />
    );

    expect(screen.getByText("items")).toBeInTheDocument();
    expect(screen.getByText("Array(3)")).toBeInTheDocument();
  });

  it("displays correct type colors", () => {
    const data = {
      str: "text",
      num: 42,
      bool: true,
      nil: null,
    };
    const onNavigate = vi.fn();

    render(
      <TreeView data={data} currentPath={[]} onNavigate={onNavigate} />
    );

    expect(screen.getByText('"text"')).toHaveClass("text-green-600");
    expect(screen.getByText("42")).toHaveClass("text-blue-600");
    expect(screen.getByText("true")).toHaveClass("text-purple-600");
    expect(screen.getByText("null")).toHaveClass("text-gray-500");
  });
});

describe("TreeNode", () => {
  it("shows expand icon for nested objects", () => {
    const onNavigate = vi.fn();

    render(
      <TreeNode
        name="parent"
        value={{ child: "value" }}
        path={["parent"]}
        depth={0}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByText("parent")).toBeInTheDocument();
    expect(screen.getByText("{1 keys}")).toBeInTheDocument();
  });

  it("does not show expand icon for primitives", () => {
    const onNavigate = vi.fn();

    const { container } = render(
      <TreeNode
        name="field"
        value="simple"
        path={["field"]}
        depth={0}
        onNavigate={onNavigate}
      />
    );

    const toggleSpan = container.querySelector(".opacity-0");
    expect(toggleSpan).toBeInTheDocument();
  });
});

describe("Breadcrumb", () => {
  it("renders root when path is empty", () => {
    const onNavigate = vi.fn();

    render(<Breadcrumb path={[]} onNavigate={onNavigate} />);

    expect(screen.getByText("root")).toBeInTheDocument();
  });

  it("renders path segments", () => {
    const onNavigate = vi.fn();

    render(
      <Breadcrumb path={["users", "0", "profile"]} onNavigate={onNavigate} />
    );

    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("profile")).toBeInTheDocument();
  });

  it("navigates to root when root clicked", () => {
    const onNavigate = vi.fn();

    render(<Breadcrumb path={["a", "b"]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("root"));

    expect(onNavigate).toHaveBeenCalledWith([]);
  });

  it("navigates to segment when clicked", () => {
    const onNavigate = vi.fn();

    render(<Breadcrumb path={["a", "b", "c"]} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("b"));

    expect(onNavigate).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("DocumentEditor", () => {
  it("renders with tree view by default", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <DocumentEditor
        document={{ _id: "123", name: "Test" }}
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    expect(screen.getByText("Edit Document")).toBeInTheDocument();
    expect(screen.getByText("Tree")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
  });

  it("shows 'New Document' for documents without _id", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <DocumentEditor
        document={{ name: "Test" }}
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    expect(screen.getByText("New Document")).toBeInTheDocument();
  });

  it("can toggle between tree and JSON view", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <DocumentEditor
        document={{ name: "Test" }}
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    const jsonButton = screen.getByText("JSON");
    fireEvent.click(jsonButton);

    expect(screen.getByPlaceholderText('{"field": "value"}')).toBeInTheDocument();
  });
});
