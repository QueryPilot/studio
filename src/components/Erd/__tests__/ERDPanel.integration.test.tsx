import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ERDPanel } from "@/components/Erd/ERDPanel";
import { databaseService } from "@/services/databaseService";
import { erdCache } from "@/services/erdCache";
import { useErdStore } from "@/stores/erdStore";

vi.mock("@/services/databaseService");

// Mock ERDVisualizer to render simple DOM
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
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() {}
}
(global as any).Worker = MockWorker;

const col = (name: string, db_type: string, is_pk = false) => ({
  name, db_type, is_pk, is_fk: false, nullable: true, default: null, ordinal: 0,
  precision: null, scale: null, comment: null,
});

describe("ERD integration — multi-schema narrow", () => {
  beforeEach(() => {
    erdCache.clear();
    useErdStore.setState({ views: {}, connectionViewIds: {}, activeViewId: null });
    (databaseService.listSchemas as any).mockResolvedValue(["public", "reporting"]);
    (databaseService.listTables as any).mockImplementation(
      (_c: string, _db: string, schema: string) =>
        Promise.resolve(
          schema === "public"
            ? [{ schema: "public", name: "users", kind: "Table" }]
            : [{ schema: "reporting", name: "events", kind: "Table" }],
        ),
    );
    (databaseService.getTableStructure as any).mockImplementation(
      (_c: string, _db: string, schema: string, name: string) =>
        Promise.resolve(
          schema === "reporting"
            ? {
                schema,
                name,
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
              }
            : {
                schema,
                name,
                columns: [col("id", "int", true)],
                foreignKeys: [],
                indexes: [],
                constraints: [],
                triggers: [],
                primaryKeys: ["id"],
                database: "db",
              },
        ),
    );
  });

  it("opens with 2 schemas, cross-schema edge appears, narrowing to 1 removes it", async () => {
    const { container } = render(
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

    const edgesBefore = container.querySelectorAll(".react-flow__edge");
    expect(edgesBefore.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /public/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /reporting/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() =>
      expect(screen.queryByText("events")).not.toBeInTheDocument(),
    );
    const edgesAfter = container.querySelectorAll(".react-flow__edge");
    expect(edgesAfter.length).toBe(0);
  });
});
