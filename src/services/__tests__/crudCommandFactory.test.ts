import { describe, expect, it } from "vitest";
import { CrudCommandFactory } from "../crudCommandFactory";
import type { CrudCommandTarget } from "@/types/crud";

describe("CrudCommandFactory destructive object commands", () => {
  const target: CrudCommandTarget = {
    connectionId: "conn-1",
    database: "todoapp",
    schema: "public",
    table: "orders",
  };

  it("creates table.drop command", () => {
    const command = CrudCommandFactory.createTableDropCommand({
      target,
      tableName: "orders",
      cascade: true,
      ifExists: true,
    });

    expect(command.type).toBe("table.drop");
    expect(command.payload.tableName).toBe("orders");
    expect(command.payload.cascade).toBe(true);
    expect(command.payload.ifExists).toBe(true);
  });

  it("creates table.truncate command", () => {
    const command = CrudCommandFactory.createTableTruncateCommand({
      target,
      tableName: "orders",
      restartIdentity: true,
      cascade: false,
    });

    expect(command.type).toBe("table.truncate");
    expect(command.payload.tableName).toBe("orders");
    expect(command.payload.restartIdentity).toBe(true);
    expect(command.payload.cascade).toBe(false);
  });

  it("creates table.duplicate command", () => {
    const command = CrudCommandFactory.createTableDuplicateCommand({
      target,
      sourceTableName: "orders",
      newTableName: "orders_copy",
      includeData: true,
      includeIndexes: true,
      includeConstraints: true,
      includeTriggers: false,
    });

    expect(command.type).toBe("table.duplicate");
    expect(command.payload.sourceTableName).toBe("orders");
    expect(command.payload.newTableName).toBe("orders_copy");
    expect(command.payload.includeData).toBe(true);
    expect(command.payload.includeIndexes).toBe(true);
    expect(command.payload.includeConstraints).toBe(true);
    expect(command.payload.includeTriggers).toBe(false);
  });

  it("creates view.drop command", () => {
    const command = CrudCommandFactory.createViewDropCommand({
      target: {
        ...target,
        table: "sales_view",
      },
      viewName: "sales_view",
      ifExists: true,
      cascade: true,
      isMaterialized: false,
    });

    expect(command.type).toBe("view.drop");
    expect(command.payload.viewName).toBe("sales_view");
    expect(command.payload.ifExists).toBe(true);
    expect(command.payload.cascade).toBe(true);
    expect(command.payload.isMaterialized).toBe(false);
  });
});
