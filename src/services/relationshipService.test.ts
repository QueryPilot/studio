import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConstraintType, type Constraint } from "./backend";
import { type TableMeta } from "./databaseService";
import { IntrospectionService } from "./introspectionService";
import { relationshipService } from "./relationshipService";

describe("relationshipService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds multi-column join conditions for composite foreign keys", async () => {
    vi.spyOn(IntrospectionService, "getConstraints").mockImplementation(
      (_connectionId: string, _schema: string, table: string) => {
        if (table !== "order_items") {
          return Promise.resolve([]);
        }

        const constraints: Constraint[] = [
          {
            name: "order_items_orders_fkey",
            table_name: "order_items",
            constraint_type: ConstraintType.ForeignKey,
            definition:
              'FOREIGN KEY ("order_id", "order_created_at") REFERENCES public.orders ("id", "created_at")',
            foreign_table: "public.orders",
          },
        ];

        return Promise.resolve(constraints);
      },
    );

    const tables: TableMeta[] = [
      { schema: "public", name: "order_items", kind: "Table" },
      { schema: "public", name: "orders", kind: "Table" },
    ];

    const graph = await relationshipService.buildRelationshipGraph(
      "conn-1",
      "public",
      tables,
    );

    expect(
      relationshipService.getJoinCondition(
        graph,
        { table: "order_items", alias: "oi" },
        "orders",
      ),
    ).toBe(
      "oi.order_id = orders.id AND oi.order_created_at = orders.created_at",
    );
  });
});
