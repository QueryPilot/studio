import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartViewer } from "../ChartViewer";

// Mock recharts to avoid canvas rendering in tests
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart" data-rows={data.length} />
  ),
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart" data-rows={data.length} />
  ),
  PieChart: () => <div data-testid="pie-chart" />,
  AreaChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="area-chart" data-rows={data.length} />
  ),
  ScatterChart: () => <div data-testid="scatter-chart" />,
  Bar: () => null,
  Line: () => null,
  Pie: () => null,
  Area: () => null,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Cell: () => null,
}));

describe("ChartViewer", () => {
  const numericResult = {
    columns: ["category", "revenue", "count"],
    rows: [
      ["Electronics", 50000, 120],
      ["Clothing", 35000, 85],
      ["Books", 12000, 200],
    ],
  };

  it("renders a chart when given valid data", () => {
    render(<ChartViewer result={numericResult} />);
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("shows empty state when result is null", () => {
    render(<ChartViewer result={null} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("shows empty state when rows are empty", () => {
    render(<ChartViewer result={{ columns: ["a"], rows: [] }} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("defaults to bar chart for categorical + numeric data", () => {
    render(<ChartViewer result={numericResult} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("allows switching chart type", async () => {
    render(<ChartViewer result={numericResult} />);
    const user = userEvent.setup();

    // Find and click the line chart option
    const lineButton = screen.getByRole("button", { name: /line/i });
    await user.click(lineButton);

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("handles string-encoded numbers from database (NUMERIC/DECIMAL)", () => {
    const stringNumericResult = {
      columns: ["category", "revenue"],
      rows: [
        ["Cameras", "682497.27"],
        ["Sports", "595697.41"],
        ["Laptops", "531345.27"],
      ],
    };
    render(<ChartViewer result={stringNumericResult} />);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("shows no-numeric-columns for all-string data", () => {
    const stringResult = {
      columns: ["first_name", "last_name", "email"],
      rows: [
        ["Alice", "Smith", "alice@example.com"],
        ["Bob", "Jones", "bob@example.com"],
      ],
    };
    render(<ChartViewer result={stringResult} />);
    expect(screen.getByText(/no numeric columns/i)).toBeInTheDocument();
  });

  it("detects date column and defaults to line chart", () => {
    const dateResult = {
      columns: ["date", "revenue"],
      rows: [
        ["2024-01-01", 50000],
        ["2024-02-01", 62000],
        ["2024-03-01", 58000],
      ],
    };
    render(<ChartViewer result={dateResult} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
