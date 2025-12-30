import type {
  ColumnAddPayload,
  ColumnDefinitionInput,
  ColumnDropPayload,
  ColumnModifyPayload,
  ColumnRenamePayload,
  CommitResult,
  CrudCommandFor,
  CrudCommandPayloadMap,
  CrudCommandState,
  CrudCommandTarget,
  CrudPrimitive,
  DataDeletePayload,
  DataInsertPayload,
  DataUpdatePayload,
  ForeignKeyAddPayload,
  ForeignKeyDefinitionInput,
  ForeignKeyDropPayload,
  IndexCreatePayload,
  IndexDefinitionInput,
  IndexDropPayload,
  IndexRenamePayload,
  JsonValue,
  TableRenamePayload,
  TriggerCreatePayload,
  TriggerDefinitionInput,
  TriggerDropPayload,
  TriggerTogglePayload,
} from "@/types/crud";

type OperationType = keyof CrudCommandPayloadMap;

interface CommandBuildOptions {
  readonly description?: string;
  readonly userId?: string;
  readonly source?: string;
  readonly affectedRows?: number;
  readonly tags?: string[];
  readonly state?: CrudCommandState;
  readonly id?: string;
}

interface DataUpdateParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly column: string;
  readonly columnType?: string; // PostgreSQL type for explicit casting (e.g., "money", "inet")
  readonly primaryKeys: Record<string, CrudPrimitive>;
  readonly oldValue?: unknown;
  readonly newValue: unknown;
}

interface DataInsertParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly values: Record<string, unknown>;
  readonly columnTypes?: Record<string, string>; // PostgreSQL types for explicit casting
  readonly primaryKeys?: Record<string, CrudPrimitive>;
  readonly tempId?: string;
}

interface DataDeleteParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly primaryKeys: Record<string, CrudPrimitive>;
}

interface ColumnAddParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly column: ColumnDefinitionInput;
}

interface ColumnModifyParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly columnName: string;
  readonly newDefinition: ColumnDefinitionInput;
}

interface ColumnDropParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly columnName: string;
  readonly cascade?: boolean;
}

interface ColumnRenameParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly columnName: string;
  readonly newName: string;
}

interface TableRenameParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly newName: string;
}

interface IndexCreateParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly definition: IndexDefinitionInput;
}

interface IndexDropParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly indexName: string;
  readonly ifExists?: boolean;
}

interface IndexRenameParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly indexName: string;
  readonly newName: string;
}

interface TriggerCreateParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly definition: TriggerDefinitionInput;
}

interface TriggerDropParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly triggerName: string;
  readonly ifExists?: boolean;
}

interface TriggerToggleParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly triggerName: string;
  readonly enable: boolean;
}

interface ForeignKeyAddParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly definition: ForeignKeyDefinitionInput;
}

interface ForeignKeyDropParams extends CommandBuildOptions {
  readonly target: CrudCommandTarget;
  readonly constraintName: string;
  readonly cascade?: boolean;
}

const generateCommandId = (length = 16): string => {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID().replace(/-/g, "").slice(0, length);
  }

  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
};

const ensureTargetHasTable = (
  target: CrudCommandTarget,
  type: OperationType,
): void => {
  if (!target.connectionId) {
    throw new Error(`CrudCommandFactory: Missing connectionId for ${type}`);
  }
  if (!target.table) {
    throw new Error(`CrudCommandFactory: Missing table for ${type}`);
  }
};

const assertNonEmpty = (value: unknown, message: string): void => {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new Error(message);
  }
  if (Array.isArray(value) && value.length === 0) {
    throw new Error(message);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(message);
    }
  }
};

const normalizeJsonValue = (value: unknown, path?: string): JsonValue => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `CrudCommandFactory: Invalid numeric value${
          path ? ` at ${path}` : ""
        } (non-finite)`,
      );
    }
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeJsonValue(item, `${path ?? "value"}[${index}]`),
    );
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).map(([key, val]) => [
      key,
      normalizeJsonValue(val, `${path ?? "value"}.${key}`),
    ]);
    return Object.fromEntries(entries);
  }

  throw new Error(
    `CrudCommandFactory: Unsupported value type${
      path ? ` at ${path}` : ""
    }: ${typeof value}`,
  );
};

const normalizeJsonRecord = (
  record: Record<string, unknown>,
): Record<string, JsonValue> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      normalizeJsonValue(value, key),
    ]),
  );

const normalizePrimaryKeys = (
  primaryKeys: Record<string, CrudPrimitive>,
): Record<string, CrudPrimitive> =>
  Object.fromEntries(
    Object.entries(primaryKeys).map(([key, value]) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (value === undefined || value === null) {
        return [key, null];
      }
      if (typeof value === "string" || typeof value === "boolean") {
        return [key, value];
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error(
            `CrudCommandFactory: Invalid numeric primary key value at ${key} (non-finite)`,
          );
        }
        return [key, value];
      }
      if (typeof value === "bigint") {
        return [key, (value as any).toString()];
      }
      return [key, String(value)];
    }),
  );

const buildMetadata = (options: CommandBuildOptions) => ({
  timestamp: new Date().toISOString(),
  description: options.description,
  affectedRows: options.affectedRows,
  userId: options.userId,
  source: options.source ?? "ui",
  tags: options.tags,
});

const buildTarget = (
  target: CrudCommandTarget,
  entityName?: string,
): CrudCommandTarget =>
  entityName ? { ...target, entityName } : { ...target };

const buildCommand = <TType extends OperationType>(
  type: TType,
  target: CrudCommandTarget,
  payload: CrudCommandPayloadMap[TType],
  options: CommandBuildOptions = {},
): CrudCommandFor<TType> => ({
  id: options.id ?? generateCommandId(),
  type,
  target,
  payload,
  metadata: buildMetadata(options),
  state: options.state ?? "staged",
});

export const CrudCommandFactory = {
  createDataUpdateCommand(
    params: DataUpdateParams,
  ): CrudCommandFor<"data.update"> {
    ensureTargetHasTable(params.target, "data.update");
    assertNonEmpty(
      params.column,
      "CrudCommandFactory: column is required for data.update",
    );
    assertNonEmpty(
      params.primaryKeys,
      "CrudCommandFactory: primary keys are required for data.update",
    );

    const payload: DataUpdatePayload = {
      column: params.column,
      columnType: params.columnType,
      primaryKeys: normalizePrimaryKeys(params.primaryKeys),
      oldValue:
        params.oldValue === undefined
          ? undefined
          : normalizeJsonValue(params.oldValue, `${params.column}.oldValue`),
      newValue: normalizeJsonValue(
        params.newValue,
        `${params.column}.newValue`,
      ),
    };

    const description =
      params.description ?? `Update ${params.column} on ${params.target.table}`;

    return buildCommand("data.update", params.target, payload, {
      ...params,
      description,
      affectedRows: params.affectedRows ?? 1,
    });
  },

  createDataInsertCommand(
    params: DataInsertParams,
  ): CrudCommandFor<"data.insert"> {
    ensureTargetHasTable(params.target, "data.insert");
    assertNonEmpty(
      params.values,
      "CrudCommandFactory: values are required for data.insert",
    );

    const tempId = params.tempId ?? generateCommandId(11);

    const payload: DataInsertPayload = {
      tempId,
      values: normalizeJsonRecord(params.values),
      columnTypes: params.columnTypes,
      primaryKeys: params.primaryKeys
        ? normalizePrimaryKeys(params.primaryKeys)
        : undefined,
    };

    const description =
      params.description ?? `Insert row into ${params.target.table}`;

    return buildCommand("data.insert", params.target, payload, {
      ...params,
      description,
      affectedRows: params.affectedRows ?? 1,
    });
  },

  createDataDeleteCommand(
    params: DataDeleteParams,
  ): CrudCommandFor<"data.delete"> {
    ensureTargetHasTable(params.target, "data.delete");
    assertNonEmpty(
      params.primaryKeys,
      "CrudCommandFactory: primary keys are required for data.delete",
    );

    const payload: DataDeletePayload = {
      primaryKeys: normalizePrimaryKeys(params.primaryKeys),
    };

    const description =
      params.description ?? `Delete row from ${params.target.table}`;

    return buildCommand("data.delete", params.target, payload, {
      ...params,
      description,
      affectedRows: params.affectedRows ?? 1,
    });
  },

  createColumnAddCommand(
    params: ColumnAddParams,
  ): CrudCommandFor<"column.add"> {
    ensureTargetHasTable(params.target, "column.add");
    assertNonEmpty(
      params.column.name,
      "CrudCommandFactory: column name is required",
    );

    const payload: ColumnAddPayload = {
      column: params.column,
    };

    const description =
      params.description ??
      `Add column ${params.column.name} to ${params.target.table}`;

    return buildCommand(
      "column.add",
      buildTarget(params.target, params.column.name),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createColumnModifyCommand(
    params: ColumnModifyParams,
  ): CrudCommandFor<"column.modify"> {
    ensureTargetHasTable(params.target, "column.modify");
    assertNonEmpty(
      params.columnName,
      "CrudCommandFactory: columnName is required for column.modify",
    );

    const payload: ColumnModifyPayload = {
      columnName: params.columnName,
      newDefinition: params.newDefinition,
    };

    const description =
      params.description ??
      `Modify column ${params.columnName} on ${params.target.table}`;

    return buildCommand(
      "column.modify",
      buildTarget(params.target, params.columnName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createColumnDropCommand(
    params: ColumnDropParams,
  ): CrudCommandFor<"column.drop"> {
    ensureTargetHasTable(params.target, "column.drop");
    assertNonEmpty(
      params.columnName,
      "CrudCommandFactory: columnName is required for column.drop",
    );

    const payload: ColumnDropPayload = {
      columnName: params.columnName,
      cascade: params.cascade,
    };

    const description =
      params.description ??
      `Drop column ${params.columnName} from ${params.target.table}`;

    return buildCommand(
      "column.drop",
      buildTarget(params.target, params.columnName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createColumnRenameCommand(
    params: ColumnRenameParams,
  ): CrudCommandFor<"column.rename"> {
    ensureTargetHasTable(params.target, "column.rename");
    assertNonEmpty(
      params.columnName,
      "CrudCommandFactory: columnName is required for column.rename",
    );
    assertNonEmpty(
      params.newName,
      "CrudCommandFactory: newName is required for column.rename",
    );

    const payload: ColumnRenamePayload = {
      columnName: params.columnName,
      newName: params.newName,
    };

    const description =
      params.description ??
      `Rename column ${params.columnName} to ${params.newName} on ${params.target.table}`;

    return buildCommand(
      "column.rename",
      buildTarget(params.target, params.newName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createTableRenameCommand(
    params: TableRenameParams,
  ): CrudCommandFor<"table.rename"> {
    ensureTargetHasTable(params.target, "table.rename");
    assertNonEmpty(
      params.newName,
      "CrudCommandFactory: newName is required for table.rename",
    );

    const payload: TableRenamePayload = {
      newName: params.newName,
    };

    const description =
      params.description ??
      `Rename table ${params.target.table} to ${params.newName}`;

    return buildCommand(
      "table.rename",
      buildTarget(params.target, params.newName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createIndexCreateCommand(
    params: IndexCreateParams,
  ): CrudCommandFor<"index.create"> {
    ensureTargetHasTable(params.target, "index.create");
    assertNonEmpty(
      params.definition.name,
      "CrudCommandFactory: index name is required for index.create",
    );
    assertNonEmpty(
      params.definition.columns,
      "CrudCommandFactory: columns are required for index.create",
    );

    const payload: IndexCreatePayload = {
      definition: params.definition,
    };

    const description =
      params.description ??
      `Create index ${params.definition.name} on ${params.target.table}`;

    return buildCommand(
      "index.create",
      buildTarget(params.target, params.definition.name),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createIndexDropCommand(
    params: IndexDropParams,
  ): CrudCommandFor<"index.drop"> {
    ensureTargetHasTable(params.target, "index.drop");
    assertNonEmpty(
      params.indexName,
      "CrudCommandFactory: indexName is required for index.drop",
    );

    const payload: IndexDropPayload = {
      indexName: params.indexName,
      ifExists: params.ifExists,
    };

    const description =
      params.description ??
      `Drop index ${params.indexName} on ${params.target.table}`;

    return buildCommand(
      "index.drop",
      buildTarget(params.target, params.indexName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createIndexRenameCommand(
    params: IndexRenameParams,
  ): CrudCommandFor<"index.rename"> {
    ensureTargetHasTable(params.target, "index.rename");
    assertNonEmpty(
      params.indexName,
      "CrudCommandFactory: indexName is required for index.rename",
    );
    assertNonEmpty(
      params.newName,
      "CrudCommandFactory: newName is required for index.rename",
    );

    const payload: IndexRenamePayload = {
      indexName: params.indexName,
      newName: params.newName,
    };

    const description =
      params.description ??
      `Rename index ${params.indexName} to ${params.newName} on ${params.target.table}`;

    return buildCommand(
      "index.rename",
      buildTarget(params.target, params.newName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createTriggerCreateCommand(
    params: TriggerCreateParams,
  ): CrudCommandFor<"trigger.create"> {
    ensureTargetHasTable(params.target, "trigger.create");
    assertNonEmpty(
      params.definition.name,
      "CrudCommandFactory: trigger name is required for trigger.create",
    );
    assertNonEmpty(
      params.definition.events,
      "CrudCommandFactory: trigger events are required for trigger.create",
    );

    const payload: TriggerCreatePayload = {
      definition: params.definition,
    };

    const description =
      params.description ??
      `Create trigger ${params.definition.name} on ${params.target.table}`;

    return buildCommand(
      "trigger.create",
      buildTarget(params.target, params.definition.name),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createTriggerDropCommand(
    params: TriggerDropParams,
  ): CrudCommandFor<"trigger.drop"> {
    ensureTargetHasTable(params.target, "trigger.drop");
    assertNonEmpty(
      params.triggerName,
      "CrudCommandFactory: triggerName is required for trigger.drop",
    );

    const payload: TriggerDropPayload = {
      triggerName: params.triggerName,
      ifExists: params.ifExists,
    };

    const description =
      params.description ??
      `Drop trigger ${params.triggerName} on ${params.target.table}`;

    return buildCommand(
      "trigger.drop",
      buildTarget(params.target, params.triggerName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createTriggerToggleCommand(
    params: TriggerToggleParams,
  ): CrudCommandFor<"trigger.enable" | "trigger.disable"> {
    ensureTargetHasTable(
      params.target,
      params.enable ? "trigger.enable" : "trigger.disable",
    );
    assertNonEmpty(
      params.triggerName,
      "CrudCommandFactory: triggerName is required for trigger toggle",
    );

    const type = params.enable ? "trigger.enable" : "trigger.disable";
    const payload: TriggerTogglePayload = {
      triggerName: params.triggerName,
      enable: params.enable,
    };

    const description =
      params.description ??
      `${params.enable ? "Enable" : "Disable"} trigger ${params.triggerName}`;

    return buildCommand(
      type,
      buildTarget(params.target, params.triggerName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createForeignKeyAddCommand(
    params: ForeignKeyAddParams,
  ): CrudCommandFor<"fk.add"> {
    ensureTargetHasTable(params.target, "fk.add");
    assertNonEmpty(
      params.definition.name,
      "CrudCommandFactory: constraint name is required for fk.add",
    );
    assertNonEmpty(
      params.definition.columns,
      "CrudCommandFactory: columns are required for fk.add",
    );
    assertNonEmpty(
      params.definition.referenceColumns,
      "CrudCommandFactory: referenceColumns are required for fk.add",
    );

    const payload: ForeignKeyAddPayload = {
      definition: params.definition,
    };

    const description =
      params.description ??
      `Add foreign key ${params.definition.name} on ${params.target.table}`;

    return buildCommand(
      "fk.add",
      buildTarget(params.target, params.definition.name),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  createForeignKeyDropCommand(
    params: ForeignKeyDropParams,
  ): CrudCommandFor<"fk.drop"> {
    ensureTargetHasTable(params.target, "fk.drop");
    assertNonEmpty(
      params.constraintName,
      "CrudCommandFactory: constraintName is required for fk.drop",
    );

    const payload: ForeignKeyDropPayload = {
      constraintName: params.constraintName,
      cascade: params.cascade,
    };

    const description =
      params.description ??
      `Drop foreign key ${params.constraintName} on ${params.target.table}`;

    return buildCommand(
      "fk.drop",
      buildTarget(params.target, params.constraintName),
      payload,
      {
        ...params,
        description,
      },
    );
  },

  cloneWithState<TType extends OperationType>(
    command: CrudCommandFor<TType>,
    state: CrudCommandState,
  ): CrudCommandFor<TType> {
    return {
      ...command,
      state,
    };
  },

  withCommitResult<TType extends OperationType>(
    command: CrudCommandFor<TType>,
    result: CommitResult,
  ): CrudCommandFor<TType> {
    return {
      ...command,
      metadata: {
        ...command.metadata,
        affectedRows:
          result.committed.find((entry) => entry.id === command.id)
            ?.affectedRows ?? command.metadata.affectedRows,
      },
    };
  },
};

export const crudCommandFactory = CrudCommandFactory;
