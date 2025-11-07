import { CrudCommandFactory } from "./crudCommandFactory";
import { useCrudStore } from "@/stores/crudStore";
import type {
  CrudCommand,
  CrudCommandFor,
  CrudCommandTarget,
  CrudPrimitive,
} from "@/types/crud";

interface BaseOperationParams {
  readonly target: CrudCommandTarget;
  readonly userId?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly stage?: boolean;
}

export interface InsertRowParams extends BaseOperationParams {
  readonly values: Record<string, unknown>;
  readonly primaryKeys?: Record<string, CrudPrimitive>;
  readonly tempId?: string;
}

export interface UpdateCellParams extends BaseOperationParams {
  readonly column: string;
  readonly primaryKeys: Record<string, CrudPrimitive>;
  readonly oldValue?: unknown;
  readonly newValue: unknown;
  readonly affectedRows?: number;
}

export interface DeleteRowsParams extends BaseOperationParams {
  readonly rows: Array<{
    readonly primaryKeys: Record<string, CrudPrimitive>;
    readonly description?: string;
  }>;
  readonly affectedRows?: number;
}

const stageCommand = (command: CrudCommand, shouldStage = true): void => {
  if (!shouldStage) {
    return;
  }

  useCrudStore.getState().stageCommand(command);
};

const stageCommands = (commands: CrudCommand[], shouldStage = true): void => {
  if (!shouldStage) {
    return;
  }

  const { stageCommands: stageMany } = useCrudStore.getState();
  stageMany(commands);
};

export const DataOperationsService = {
  insertRow(params: InsertRowParams): CrudCommandFor<"data.insert"> {
    const command = CrudCommandFactory.createDataInsertCommand({
      target: params.target,
      values: params.values,
      primaryKeys: params.primaryKeys,
      tempId: params.tempId,
      userId: params.userId,
      description: params.description,
      tags: params.tags,
    });

    stageCommand(command, params.stage !== false);
    return command;
  },

  updateCell(params: UpdateCellParams): CrudCommandFor<"data.update"> {
    const command = CrudCommandFactory.createDataUpdateCommand({
      target: params.target,
      column: params.column,
      primaryKeys: params.primaryKeys,
      oldValue: params.oldValue,
      newValue: params.newValue,
      userId: params.userId,
      description: params.description,
      tags: params.tags,
      affectedRows: params.affectedRows,
    });

    stageCommand(command, params.stage !== false);
    return command;
  },

  deleteRows(params: DeleteRowsParams): CrudCommandFor<"data.delete">[] {
    if (params.rows.length === 0) {
      throw new Error(
        "DataOperationsService.deleteRows requires at least one row",
      );
    }

    const commands = params.rows.map((row, index) =>
      CrudCommandFactory.createDataDeleteCommand({
        target: params.target,
        primaryKeys: row.primaryKeys,
        userId: params.userId,
        description:
          row.description ??
          params.description ??
          `Delete row ${index + 1} from ${params.target.table ?? "table"}`,
        tags: params.tags,
        affectedRows: params.affectedRows,
      }),
    );

    stageCommands(commands, params.stage !== false);
    return commands;
  },
};

export const dataOperationsService = DataOperationsService;
