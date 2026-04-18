import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ERDPanel } from "@/components/Erd/ERDPanel";
import { databaseService } from "@/services/databaseService";
import { erdCache } from "@/services/erdCache";
import { useErdStore } from "@/stores/erdStore";

vi.mock("@/services/databaseService");

// Mock ERDVisualizer to render simple DOM so we can check tables/edges
vi.mock("@/components/Erd/ERDVisualizer", () => ({
  ERDVisualizer: vi.fn(({ tables, relationships }: any) => (
    <div data-testid="erd-visualizer">
      {tables.map((t: any) => (
        <div key={`${t.schema}.${t.name}`} className="react-flow__node" data-id={`${t.schema}.${t.name}`}>
          {t.name}
        </div>
      ))}
      {relationships.map((r: any, i: number) => (
        <div key={i} className="react-flow__edge" data-id={r.id} />
      ))}
    </div>
  )),
}));

// Mock Worker — not available in jsdom
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private listeners: Map<string, ((e: MessageEvent) => void)[]> = new Map();
  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(type, handlers.filter((h) => h !== handler));
  }
  postMessage(_data: unknown) {
    // No-op: the DBML parse worker is not exercised in these tests.
  }
  terminate() {}
}
(global as any).Worker = MockWorker;

const tablesByScheme: Record<string, any[]> = {
  public: [{ schema: "public", name: "users", kind: "Table" }],
  reporting: [{ schema: "reporting", name: "events", kind: "Table" }],
};
const col = (name: string, db_type: string, is_pk = false) => ({
  name,
  db_type,
  is_pk,
  is_fk: false,
  nullable: true,
  default: null,
  ordinal: 0,
  precision: null,
  scale: null,
  comment: null,
});

const structureByKey: Record<string, any> = {
  "public.users": {
    schema: "public",
    name: "users",
    columns: [col("id", "int", true)],
    foreignKeys: [],
    indexes: [],
    constraints: [],
    triggers: [],
    primaryKeys: ["id"],
    database: "db",
  },
  "reporting.events": {
    schema: "reporting",
    name: "events",
    columns: [col("id", "int", true), col("user_id", "int")],
    foreignKeys: [
      {
        name: "fk_user",
        columns: ["user_id"],
        foreignSchema: "public",
        foreignTable: "users",
        foreignColumns: ["id"],
      },
    ],
    indexes: [],
    constraints: [],
    triggers: [],
    primaryKeys: ["id"],
    database: "db",
  },
};

describe("ERDPanel multi-schema rendering", () => {
  beforeEach(() => {
    erdCache.clear();
    useErdStore.setState({ views: {}, connectionViewIds: {}, activeViewId: null });
    (databaseService.listTables as any).mockImplementation(
      (_c: string, _db: string, schema: string) => Promise.resolve(tablesByScheme[schema] ?? []),
    );
    (databaseService.getTableStructure as any).mockImplementation(
      (_c: string, _db: string, schema: string, name: string) =>
        Promise.resolve(structureByKey[`${schema}.${name}`]),
    );
    (databaseService.listSchemas as any).mockResolvedValue(["public", "reporting", "analytics"]);
  });

  it("renders tables from all selectedSchemas", async () => {
    render(
      <ERDPanel
        connectionId="c1"
        tabId="t1"
        database="db"
        schemas={["public", "reporting"]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.getByText("events")).toBeInTheDocument();
    });
  });

  it("draws a cross-schema FK edge from reporting.events to public.users", async () => {
    const { container } = render(
      <ERDPanel
        connectionId="c1"
        tabId="t1"
        database="db"
        schemas={["public", "reporting"]}
      />,
    );
    await waitFor(() => {
      const edges = container.querySelectorAll(".react-flow__edge");
      expect(edges.length).toBeGreaterThan(0);
    });
  });

  it("narrowing via toolbar to [public] removes reporting nodes on re-fetch", async () => {
    render(
      <ERDPanel
        connectionId="c1"
        tabId="t1"
        database="db"
        schemas={["public", "reporting"]}
      />,
    );
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());

    // Simulate toolbar narrowing to [public] only.
    fireEvent.click(screen.getByRole("button", { name: /public/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /reporting/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() =>
      expect(screen.queryByText("events")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("users")).toBeInTheDocument();
  });
});
