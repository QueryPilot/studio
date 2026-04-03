import { DbType } from "@/types/connection";
import { SqlAdapter } from "../base/SqlAdapter";
import type {
  ColumnInfo,
  ObjectDefinitionType,
  QueryPayload,
  SelectOptions,
  TableRef,
  WhereClause,
} from "../types";
import type {
  ColumnDefinitionInput,
  ConstraintDefinitionInput,
  IndexDefinitionInput,
  SequenceDefinitionInput,
  TriggerDefinitionInput,
  ViewDefinitionInput,
} from "@/types/crud";
import { quoteIdentifier as sharedQuoteIdentifier } from "../formatting";

const ORACLE_SYSTEM_SCHEMAS = [
  "ANONYMOUS",
  "APPQOSSYS",
  "AUDSYS",
  "CTXSYS",
  "DBSNMP",
  "DIP",
  "DVF",
  "DVSYS",
  "GGSYS",
  "GSMADMIN_INTERNAL",
  "LBACSYS",
  "MDSYS",
  "OJVMSYS",
  "OLAPSYS",
  "ORDDATA",
  "ORDPLUGINS",
  "ORDSYS",
  "OUTLN",
  "REMOTE_SCHEDULER_AGENT",
  "SI_INFORMTN_SCHEMA",
  "SYS",
  "SYS$UMF",
  "SYSBACKUP",
  "SYSDG",
  "SYSKM",
  "SYSRAC",
  "SYSTEM",
  "WMSYS",
  "XDB",
  "XS$NULL",
];

const ORACLE_STANDARD_COLUMN_TYPES = [
  "NUMBER",
  "BINARY_FLOAT",
  "BINARY_DOUBLE",
  "FLOAT",
  "VARCHAR2",
  "NVARCHAR2",
  "CHAR",
  "NCHAR",
  "CLOB",
  "NCLOB",
  "BLOB",
  "RAW",
  "DATE",
  "TIMESTAMP",
  "TIMESTAMP WITH TIME ZONE",
  "TIMESTAMP WITH LOCAL TIME ZONE",
  "INTERVAL DAY TO SECOND",
  "INTERVAL YEAR TO MONTH",
  "XMLTYPE",
  "JSON",
];

export const ORACLE_ROWID_ALIAS = "__qp_rowid";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function formatTimestampLiteral(value: string): string {
  const normalized = value.trim().replace("T", " ").replace(/Z$/, "");
  return `TIMESTAMP '${normalized}'`;
}

function wrapExecuteImmediate(sql: string, ignoredCodes: number[] = []): string {
  const ignoreClause =
    ignoredCodes.length > 0
      ? `\n  IF SQLCODE NOT IN (${ignoredCodes.join(", ")}) THEN\n    RAISE;\n  END IF;`
      : "\n  RAISE;";

  return `BEGIN
  EXECUTE IMMEDIATE q'{${sql}}';
EXCEPTION
  WHEN OTHERS THEN${ignoreClause}
END;`;
}

export class OracleAdapter extends SqlAdapter {
  readonly dbType = DbType.Oracle;

  private getSyntheticRowIdSelection(options?: SelectOptions): {
    includeSyntheticRowId: boolean;
    selectedColumns?: string[];
  } {
    const columns = options?.columns;
    if (!columns || columns.length === 0) {
      return { includeSyntheticRowId: false, selectedColumns: undefined };
    }

    const includeSyntheticRowId = columns.includes(ORACLE_ROWID_ALIAS);
    const selectedColumns = columns.filter((column) => column !== ORACLE_ROWID_ALIAS);

    return {
      includeSyntheticRowId,
      selectedColumns: selectedColumns.length > 0 ? selectedColumns : undefined,
    };
  }

  private buildSelectProjection(
    selectedColumns: string[] | undefined,
    includeSyntheticRowId: boolean,
    fallbackProjection: string,
    tableAlias?: string,
  ): string {
    const projection =
      selectedColumns?.map((column) => this.quoteIdentifier(column)).join(", ") ??
      fallbackProjection;

    if (!includeSyntheticRowId) {
      return projection;
    }

    const rowidRef = tableAlias ? `${tableAlias}.ROWID` : "ROWID";
    return `${rowidRef} AS ${this.quoteIdentifier(ORACLE_ROWID_ALIAS)}, ${projection}`;
  }

  private resolveFallbackOrderByColumn(
    options: SelectOptions | undefined,
    selectedColumns: string[] | undefined,
    includeSyntheticRowId: boolean,
  ): string | undefined {
    if (includeSyntheticRowId && (!selectedColumns || selectedColumns.length === 0)) {
      return "ROWID";
    }

    return this.getFallbackOrderByColumn(
      selectedColumns ? { ...options, columns: selectedColumns } : options,
    );
  }

  private formatOrderByColumn(column: string): string {
    return column === "ROWID" ? "ROWID" : this.quoteIdentifier(column);
  }

  quoteIdentifier(name: string): string {
    return sharedQuoteIdentifier(name, DbType.Oracle);
  }

  quoteString(value: string): string {
    return `'${this.escapeString(value)}'`;
  }

  formatValue(value: unknown, column: ColumnInfo): string {
    if (value === null || value === undefined) {
      return "NULL";
    }

    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number value: ${value}`);
      }
      return String(value);
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (value instanceof Date) {
      const dbType = column.dbType?.toLowerCase() ?? "";
      if (dbType === "date") {
        return `DATE '${value.toISOString().slice(0, 10)}'`;
      }
      return formatTimestampLiteral(value.toISOString().slice(0, 23));
    }

    if (Array.isArray(value) || typeof value === "object") {
      return this.quoteString(JSON.stringify(value));
    }

    const dbType = column.dbType?.toLowerCase() ?? "";
    const strValue = String(value);

    if (
      ["number", "float", "binary_float", "binary_double"].some((type) =>
        dbType.includes(type),
      ) &&
      /^-?\d+(\.\d+)?$/.test(strValue)
    ) {
      return strValue;
    }

    if (dbType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
      return `DATE '${strValue}'`;
    }

    if (
      (dbType.includes("timestamp") || dbType.includes("time")) &&
      /^\d{4}-\d{2}-\d{2}[ tT]\d{2}:\d{2}:\d{2}/.test(strValue)
    ) {
      return formatTimestampLiteral(strValue);
    }

    return this.quoteString(strValue);
  }

  protected supportsReturning(): boolean {
    return false;
  }

  /**
   * Oracle transactions start implicitly — no BEGIN statement needed.
   * Just emit the statements followed by COMMIT.
   */
  transaction(operations: QueryPayload[]): string {
    const statements = operations.filter(
      (op): op is string => typeof op === "string",
    );

    if (statements.length === 0) {
      return "";
    }

    return `${statements.join(";\n")};\nCOMMIT;`;
  }

  protected formatLimit(limit: number, offset?: number): string {
    if (offset !== undefined && offset > 0) {
      return ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    }
    return ` FETCH FIRST ${limit} ROWS ONLY`;
  }

  select(target: TableRef, options?: SelectOptions): string {
    const table = this.formatTableRef(target);
    const tableAlias = "t";
    const { includeSyntheticRowId, selectedColumns } =
      this.getSyntheticRowIdSelection(options);
    const fallback = includeSyntheticRowId ? `${tableAlias}.*` : "*";
    const projection = this.buildSelectProjection(
      selectedColumns,
      includeSyntheticRowId,
      fallback,
      includeSyntheticRowId ? tableAlias : undefined,
    );

    let sql = includeSyntheticRowId
      ? `SELECT ${projection} FROM ${table} ${tableAlias}`
      : `SELECT ${projection} FROM ${table}`;

    if (options?.rawWhere) {
      sql += ` WHERE ${options.rawWhere}`;
    } else if (options?.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    const orderBy = options?.orderBy ? [...options.orderBy] : [];
    const hasOffset = options?.offset !== undefined && options.offset > 0;
    const needsDefaultOrder =
      orderBy.length === 0 && (hasOffset || options?.limit !== undefined);
    if (needsDefaultOrder) {
      const fallbackColumn = this.resolveFallbackOrderByColumn(
        options,
        selectedColumns,
        includeSyntheticRowId,
      );
      if (fallbackColumn) {
        orderBy.push({
          column: fallbackColumn,
          direction: "ASC",
        });
      }
    }

    if (orderBy.length > 0) {
      sql += ` ORDER BY ${orderBy
        .map(
          (item) => `${this.formatOrderByColumn(item.column)} ${item.direction}`,
        )
        .join(", ")}`;
    }

    if (options?.limit !== undefined) {
      sql += this.formatLimit(options.limit, options.offset);
    }

    return sql;
  }

  addColumn(target: TableRef, column: ColumnDefinitionInput): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} ADD (${this.formatColumnDefinition(column)})`;
  }

  modifyColumn(
    target: TableRef,
    columnName: string,
    changes: Partial<ColumnDefinitionInput>,
  ): string {
    const table = this.formatTableRef(target);
    const colName = this.quoteIdentifier(columnName);
    const statements: string[] = [];
    const parts: string[] = [colName];

    if (changes.dataType) {
      parts.push(changes.dataType);
    }

    if (changes.defaultValue !== undefined) {
      if (changes.defaultValue === null) {
        parts.push("DEFAULT NULL");
      } else {
        parts.push(`DEFAULT ${changes.defaultValue}`);
      }
    }

    if (changes.nullable !== undefined) {
      parts.push(changes.nullable ? "NULL" : "NOT NULL");
    }

    if (parts.length > 1) {
      statements.push(`ALTER TABLE ${table} MODIFY (${parts.join(" ")})`);
    }

    if (changes.comment !== undefined) {
      const fullColumn = `${table}.${colName}`;
      if (changes.comment === null || changes.comment === "") {
        statements.push(`COMMENT ON COLUMN ${fullColumn} IS ''`);
      } else {
        statements.push(
          `COMMENT ON COLUMN ${fullColumn} IS ${this.quoteString(changes.comment)}`,
        );
      }
    }

    if (changes.checkExpression) {
      const constraintName = `${target.table}_${columnName}_check`;
      statements.push(
        `ALTER TABLE ${table} ADD CONSTRAINT ${this.quoteIdentifier(constraintName)} CHECK (${changes.checkExpression})`,
      );
    }

    return statements.join(";\n");
  }

  dropColumn(target: TableRef, columnName: string, _cascade?: boolean): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} DROP COLUMN ${this.quoteIdentifier(columnName)}`;
  }

  renameColumn(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  selectWithEmbeddedFK(target: TableRef, options: SelectOptions): string {
    const embeddedFKs = options.embeddedFKs;
    if (!embeddedFKs || embeddedFKs.length === 0) {
      return this.select(target, options);
    }

    const { includeSyntheticRowId, selectedColumns } =
      this.getSyntheticRowIdSelection(options);
    const mainTable = this.formatTableRef(target);
    const mainAlias = this.quoteIdentifier("t0");
    const selectColumns: string[] = [
      this.buildSelectProjection(
        selectedColumns,
        includeSyntheticRowId,
        `${mainAlias}.*`,
        mainAlias,
      ),
    ];
    const joinClauses: string[] = [];

    embeddedFKs.forEach((fk, index) => {
      const alias = `t${index + 1}`;
      const refTable = this.formatTableRef({
        schema: fk.refSchema,
        table: fk.refTable,
      });
      for (const displayCol of fk.refDisplayColumns) {
        const aliasName = `__qp_fk__${fk.fkColumn}__${displayCol}`;
        selectColumns.push(
          `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(displayCol)} AS ${this.quoteIdentifier(aliasName)}`,
        );
      }
      joinClauses.push(
        `LEFT JOIN ${refTable} ${this.quoteIdentifier(alias)} ON ${mainAlias}.${this.quoteIdentifier(fk.fkColumn)} = ${this.quoteIdentifier(alias)}.${this.quoteIdentifier(fk.refPkColumn)}`,
      );
    });

    let sql = `SELECT ${selectColumns.join(", ")} FROM ${mainTable} ${mainAlias} ${joinClauses.join(" ")}`;

    if (options.rawWhere) {
      sql += ` WHERE ${options.rawWhere}`;
    } else if (options.where && Object.keys(options.where).length > 0) {
      sql += ` WHERE ${this.buildWhereClause(options.where)}`;
    }

    const orderBy = options.orderBy ? [...options.orderBy] : [];
    if (orderBy.length > 0) {
      sql += ` ORDER BY ${orderBy
        .map(
          (item) =>
            `${mainAlias}.${this.quoteIdentifier(item.column)} ${item.direction}`,
        )
        .join(", ")}`;
    } else if (options.limit !== undefined || (options.offset ?? 0) > 0) {
      const fallbackColumn = this.resolveFallbackOrderByColumn(
        options,
        selectedColumns,
        includeSyntheticRowId,
      );
      if (fallbackColumn) {
        if (fallbackColumn === "ROWID") {
          sql += ` ORDER BY ${mainAlias}.ROWID ASC`;
        } else {
          sql += ` ORDER BY ${mainAlias}.${this.quoteIdentifier(fallbackColumn)} ASC`;
        }
      }
    }

    if (options.limit !== undefined) {
      sql += this.formatLimit(options.limit, options.offset);
    }

    return sql;
  }

  protected buildWhereClause(
    where: WhereClause,
    columnInfos?: ColumnInfo[],
  ): string {
    const conditions = Object.entries(where).map(([column, value]) => {
      const quotedColumn =
        column === ORACLE_ROWID_ALIAS ? "ROWID" : this.quoteIdentifier(column);
      if (value === null) {
        return `${quotedColumn} IS NULL`;
      }
      return `${quotedColumn} = ${this.formatValue(
        value,
        this.findColumnInfo(column, columnInfos),
      )}`;
    });

    return conditions.join(" AND ");
  }

  createIndex(target: TableRef, definition: IndexDefinitionInput): string {
    if (definition.where) {
      throw new Error("Oracle does not support partial indexes with a WHERE clause");
    }
    if (definition.includeColumns?.length) {
      throw new Error("Oracle does not support INCLUDE columns on indexes");
    }

    const table = this.formatTableRef(target);
    const indexName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(definition.name)}`
      : this.quoteIdentifier(definition.name);
    const uniqueClause = definition.unique ? "UNIQUE " : "";
    const indexType =
      definition.using && definition.using.toUpperCase() === "BITMAP"
        ? "BITMAP "
        : "";
    const columns = definition.columns
      .map((column) => this.quoteIdentifier(column))
      .join(", ");

    return `CREATE ${uniqueClause}${indexType}INDEX ${indexName} ON ${table} (${columns})`;
  }

  dropIndex(target: TableRef, indexName: string, ifExists?: boolean): string {
    const qualifiedName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(indexName)}`
      : this.quoteIdentifier(indexName);
    const sql = `DROP INDEX ${qualifiedName}`;
    return ifExists ? wrapExecuteImmediate(sql, [-1418]) : sql;
  }

  renameIndex(target: TableRef, oldName: string, newName: string): string {
    const qualifiedOldName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(oldName)}`
      : this.quoteIdentifier(oldName);
    return `ALTER INDEX ${qualifiedOldName} RENAME TO ${this.quoteIdentifier(newName)}`;
  }

  createTrigger(target: TableRef, definition: TriggerDefinitionInput): string {
    const table = this.formatTableRef(target);
    const triggerName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(definition.name)}`
      : this.quoteIdentifier(definition.name);
    const events = definition.events.join(" OR ");
    const level = definition.level === "STATEMENT" ? "" : "\nFOR EACH ROW";
    const condition = definition.condition
      ? `\nWHEN (${definition.condition})`
      : "";
    const routineName = definition.functionName.includes(".")
      ? definition.functionName
          .split(".")
          .map((part) => this.quoteIdentifier(part))
          .join(".")
      : this.quoteIdentifier(definition.functionName);

    return `CREATE OR REPLACE TRIGGER ${triggerName}
${definition.timing} ${events} ON ${table}${level}${condition}
BEGIN
  ${routineName}();
END;`;
  }

  dropTrigger(target: TableRef, triggerName: string, ifExists?: boolean): string {
    const qualifiedName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(triggerName)}`
      : this.quoteIdentifier(triggerName);
    const sql = `DROP TRIGGER ${qualifiedName}`;
    return ifExists ? wrapExecuteImmediate(sql, [-4080]) : sql;
  }

  renameTrigger(target: TableRef, triggerName: string, newName: string): string {
    const qualifiedName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(triggerName)}`
      : this.quoteIdentifier(triggerName);
    return `ALTER TRIGGER ${qualifiedName} RENAME TO ${this.quoteIdentifier(newName)}`;
  }

  toggleTrigger(target: TableRef, triggerName: string, enable: boolean): string {
    const qualifiedName = target.schema
      ? `${this.quoteIdentifier(target.schema)}.${this.quoteIdentifier(triggerName)}`
      : this.quoteIdentifier(triggerName);
    return `ALTER TRIGGER ${qualifiedName} ${enable ? "ENABLE" : "DISABLE"}`;
  }

  createView(schema: string, definition: ViewDefinitionInput): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    if (definition.isMaterialized) {
      return `CREATE MATERIALIZED VIEW ${qualifiedName} AS\n${definition.definition}`;
    }

    let sql = `CREATE OR REPLACE VIEW ${qualifiedName} AS\n${definition.definition}`;
    if (definition.checkOption) {
      sql += `\nWITH ${definition.checkOption} CHECK OPTION`;
    }
    return sql;
  }

  dropView(
    schema: string,
    viewName: string,
    ifExists?: boolean,
    cascade?: boolean,
    isMaterialized?: boolean,
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    const baseSql = isMaterialized
      ? `DROP MATERIALIZED VIEW ${qualifiedName}`
      : `DROP VIEW ${qualifiedName}${cascade ? " CASCADE CONSTRAINTS" : ""}`;

    if (!ifExists) {
      return baseSql;
    }

    return wrapExecuteImmediate(baseSql, [isMaterialized ? -12003 : -942]);
  }

  replaceView(
    schema: string,
    viewName: string,
    definition: string,
    isMaterialized?: boolean,
  ): string {
    if (isMaterialized) {
      throw new Error("Oracle does not support CREATE OR REPLACE MATERIALIZED VIEW");
    }

    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(viewName)}`;
    return `CREATE OR REPLACE VIEW ${qualifiedName} AS\n${definition}`;
  }

  renameView(
    _schema: string,
    oldName: string,
    newName: string,
    _isMaterialized?: boolean,
  ): string {
    return `RENAME ${oldName} TO ${newName}`;
  }

  addConstraint(target: TableRef, definition: ConstraintDefinitionInput): string {
    const table = this.formatTableRef(target);
    const constraintName = this.quoteIdentifier(definition.name);

    switch (definition.type) {
      case "primary_key":
        if (!definition.columns?.length) {
          throw new Error("Primary key constraint requires columns");
        }
        return `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} PRIMARY KEY (${definition.columns
          .map((column) => this.quoteIdentifier(column))
          .join(", ")})`;
      case "unique":
        if (!definition.columns?.length) {
          throw new Error("Unique constraint requires columns");
        }
        return `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} UNIQUE (${definition.columns
          .map((column) => this.quoteIdentifier(column))
          .join(", ")})`;
      case "check":
        if (!definition.expression) {
          throw new Error("Check constraint requires an expression");
        }
        return `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} CHECK (${definition.expression})`;
      case "exclusion":
        throw new Error("Oracle does not support exclusion constraints");
    }
  }

  dropConstraint(
    target: TableRef,
    constraintName: string,
    cascade?: boolean,
    ifExists?: boolean,
  ): string {
    const table = this.formatTableRef(target);
    const sql = `ALTER TABLE ${table} DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}${cascade ? " CASCADE" : ""}`;
    return ifExists ? wrapExecuteImmediate(sql, [-2443]) : sql;
  }

  renameConstraint(target: TableRef, oldName: string, newName: string): string {
    const table = this.formatTableRef(target);
    return `ALTER TABLE ${table} RENAME CONSTRAINT ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName)}`;
  }

  createSequence(schema: string, definition: SequenceDefinitionInput): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(definition.name)}`;
    const parts = [`CREATE SEQUENCE ${qualifiedName}`];

    if (definition.startValue !== undefined) {
      parts.push(`START WITH ${definition.startValue}`);
    }
    if (definition.increment !== undefined) {
      parts.push(`INCREMENT BY ${definition.increment}`);
    }
    if (definition.minValue !== undefined) {
      parts.push(`MINVALUE ${definition.minValue}`);
    }
    if (definition.maxValue !== undefined) {
      parts.push(`MAXVALUE ${definition.maxValue}`);
    }
    if (definition.cache !== undefined) {
      parts.push(`CACHE ${definition.cache}`);
    }
    if (definition.cycle !== undefined) {
      parts.push(definition.cycle ? "CYCLE" : "NOCYCLE");
    }

    return parts.join(" ");
  }

  alterSequence(
    schema: string,
    sequenceName: string,
    changes: Partial<SequenceDefinitionInput>,
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(sequenceName)}`;
    const parts = [`ALTER SEQUENCE ${qualifiedName}`];

    if (changes.increment !== undefined) {
      parts.push(`INCREMENT BY ${changes.increment}`);
    }
    if (changes.minValue !== undefined) {
      parts.push(`MINVALUE ${changes.minValue}`);
    }
    if (changes.maxValue !== undefined) {
      parts.push(`MAXVALUE ${changes.maxValue}`);
    }
    if (changes.cache !== undefined) {
      parts.push(`CACHE ${changes.cache}`);
    }
    if (changes.cycle !== undefined) {
      parts.push(changes.cycle ? "CYCLE" : "NOCYCLE");
    }

    return parts.join(" ");
  }

  dropSequence(
    schema: string,
    sequenceName: string,
    ifExists?: boolean,
    _cascade?: boolean,
  ): string {
    const qualifiedName = `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(sequenceName)}`;
    const sql = `DROP SEQUENCE ${qualifiedName}`;
    return ifExists ? wrapExecuteImmediate(sql, [-2289]) : sql;
  }

  renameSequence(
    _schema: string,
    oldName: string,
    newName: string,
  ): string {
    return `RENAME ${oldName} TO ${newName}`;
  }

  getDatabasesQuery(): string {
    return `
SELECT
    SYS_CONTEXT('USERENV', 'DB_NAME') as name,
    NULL as owner,
    NULL as encoding,
    NULL as collation,
    NULL as "size"
FROM dual`;
  }

  getSchemasQuery(): string {
    const hidden = ORACLE_SYSTEM_SCHEMAS.map((schema) => `'${schema}'`).join(", ");
    return `
SELECT
    username as name,
    NULL as owner
FROM all_users
WHERE username NOT IN (${hidden})
ORDER BY username`;
  }

  getTablesQuery(schema: string): string {
    return `
SELECT
    t.owner as schema_name,
    t.table_name as table_name,
    CASE
        WHEN t.temporary = 'Y' THEN 'temporary'
        ELSE 'regular'
    END as kind,
    t.owner as owner,
    NULL as "size",
    t.num_rows as row_count,
    c.comments as "comment"
FROM all_tables t
LEFT JOIN all_tab_comments c
    ON c.owner = t.owner
    AND c.table_name = t.table_name
WHERE t.owner = UPPER('${escapeSqlString(schema)}')
    AND t.nested = 'NO'
    AND t.secondary = 'N'
ORDER BY t.table_name`;
  }

  getViewsQuery(schema: string): string {
    return `
SELECT
    v.schema_name,
    v.view_name,
    v.owner,
    NULL as definition,
    v.is_materialized,
    c.comments as "comment"
FROM (
    SELECT owner as schema_name, view_name, owner, 0 as is_materialized
    FROM all_views
    WHERE owner = UPPER('${escapeSqlString(schema)}')
    UNION ALL
    SELECT owner as schema_name, mview_name as view_name, owner, 1 as is_materialized
    FROM all_mviews
    WHERE owner = UPPER('${escapeSqlString(schema)}')
) v
LEFT JOIN all_tab_comments c
    ON c.owner = v.schema_name
    AND c.table_name = v.view_name
ORDER BY v.view_name`;
  }

  getFunctionsQuery(schema: string): string {
    return `
SELECT
    p.owner as schema_name,
    p.object_name as function_name,
    COALESCE((
        SELECT LISTAGG(
            CASE
                WHEN a.argument_name IS NULL THEN a.data_type
                ELSE a.argument_name || ' ' || a.in_out || ' ' || a.data_type
            END,
            ', '
        ) WITHIN GROUP (ORDER BY a.position)
        FROM all_arguments a
        WHERE a.owner = p.owner
            AND a.object_name = p.object_name
            AND a.package_name IS NULL
            AND a.subprogram_id = p.subprogram_id
            AND NVL(a.position, 0) > 0
    ), '') as arguments,
    CASE
        WHEN p.object_type = 'PROCEDURE' THEN 'void'
        ELSE COALESCE((
            SELECT a.data_type
            FROM all_arguments a
            WHERE a.owner = p.owner
                AND a.object_name = p.object_name
                AND a.package_name IS NULL
                AND a.subprogram_id = p.subprogram_id
                AND NVL(a.position, 0) = 0
                AND ROWNUM = 1
        ), 'void')
    END as return_type,
    'PL/SQL' as language,
    0 as is_aggregate,
    0 as is_window,
    0 as is_trigger,
    NULL as source,
    p.object_type as routine_type,
    0 as is_extension
FROM all_procedures p
WHERE p.owner = UPPER('${escapeSqlString(schema)}')
    AND p.object_type IN ('FUNCTION', 'PROCEDURE')
    AND p.object_name IS NOT NULL
ORDER BY p.object_name`;
  }

  getIndexesQuery(schema: string, table: string): string {
    const s = escapeSqlString(schema);
    const t = escapeSqlString(table);
    return `
SELECT
    i.index_name as index_name,
    i.table_name as table_name,
    LISTAGG(c.column_name, ',') WITHIN GROUP (ORDER BY c.column_position) as columns,
    CASE WHEN i.uniqueness = 'UNIQUE' THEN 1 ELSE 0 END as is_unique,
    CASE WHEN pk.index_name IS NOT NULL THEN 1 ELSE 0 END as is_primary,
    0 as is_partial,
    i.index_type as definition,
    0 as is_foreign_key
FROM all_indexes i
JOIN all_ind_columns c
    ON c.index_owner = i.owner AND c.index_name = i.index_name
LEFT JOIN (
    SELECT owner, index_name FROM all_constraints
    WHERE constraint_type = 'P' AND owner = UPPER('${s}') AND table_name = UPPER('${t}')
) pk
    ON pk.owner = i.owner AND pk.index_name = i.index_name
WHERE i.table_owner = UPPER('${s}')
    AND i.table_name = UPPER('${t}')
GROUP BY i.owner, i.index_name, i.table_name, i.uniqueness, i.index_type, pk.index_name
ORDER BY i.index_name`;
  }

  getIndexUsageStatsQuery(_schema: string, _table: string): string {
    return `
SELECT
    NULL as index_name,
    NULL as scan_count,
    NULL as rows_read,
    NULL as rows_returned,
    NULL as size_pretty,
    NULL as size_bytes,
    0 as is_unused,
    NULL as cache_hit_ratio,
    NULL as last_used
FROM dual
WHERE 1 = 0`;
  }

  getConstraintsQuery(schema: string, table: string): string {
    return `
WITH constraint_columns AS (
    SELECT
        cc.owner,
        cc.constraint_name,
        LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) as columns_list
    FROM all_cons_columns cc
    WHERE cc.owner = UPPER('${escapeSqlString(schema)}')
        AND cc.table_name = UPPER('${escapeSqlString(table)}')
    GROUP BY cc.owner, cc.constraint_name
),
referenced_constraints AS (
    SELECT
        c.owner,
        c.constraint_name,
        r.owner as ref_owner,
        r.table_name as ref_table_name,
        LISTAGG(rcc.column_name, ', ') WITHIN GROUP (ORDER BY rcc.position) as ref_columns
    FROM all_constraints c
    JOIN all_constraints r
        ON r.owner = c.r_owner
        AND r.constraint_name = c.r_constraint_name
    JOIN all_cons_columns rcc
        ON rcc.owner = r.owner
        AND rcc.constraint_name = r.constraint_name
    WHERE c.owner = UPPER('${escapeSqlString(schema)}')
        AND c.table_name = UPPER('${escapeSqlString(table)}')
        AND c.constraint_type = 'R'
    GROUP BY c.owner, c.constraint_name, r.owner, r.table_name
)
SELECT
    c.constraint_name,
    c.table_name,
    CASE c.constraint_type
        WHEN 'P' THEN 'PRIMARY KEY'
        WHEN 'U' THEN 'UNIQUE'
        WHEN 'R' THEN 'FOREIGN KEY'
        WHEN 'C' THEN 'CHECK'
        ELSE c.constraint_type
    END as constraint_type,
    CASE c.constraint_type
        WHEN 'P' THEN 'PRIMARY KEY (' || cols.columns_list || ')'
        WHEN 'U' THEN 'UNIQUE (' || cols.columns_list || ')'
        WHEN 'R' THEN 'FOREIGN KEY (' || cols.columns_list || ') REFERENCES ' || ref.ref_owner || '.' || ref.ref_table_name || ' (' || ref.ref_columns || ')'
        WHEN 'C' THEN 'CHECK (' || c.search_condition_vc || ')'
        ELSE NULL
    END as definition,
    CASE
        WHEN c.constraint_type = 'R' THEN ref.ref_owner || '.' || ref.ref_table_name
        ELSE NULL
    END as foreign_table
FROM all_constraints c
LEFT JOIN constraint_columns cols
    ON cols.owner = c.owner
    AND cols.constraint_name = c.constraint_name
LEFT JOIN referenced_constraints ref
    ON ref.owner = c.owner
    AND ref.constraint_name = c.constraint_name
WHERE c.owner = UPPER('${escapeSqlString(schema)}')
    AND c.table_name = UPPER('${escapeSqlString(table)}')
    AND c.constraint_type IN ('P', 'U', 'R', 'C')
ORDER BY c.constraint_name`;
  }

  getColumnsQuery(schema: string, table: string): string {
    // Use a single JOIN to pk columns instead of a correlated EXISTS subquery per row
    const s = escapeSqlString(schema);
    const t = escapeSqlString(table);
    return `
SELECT
    c.column_name as column_name,
    CASE
        WHEN c.data_type IN ('CHAR', 'NCHAR', 'VARCHAR2', 'NVARCHAR2', 'RAW') THEN c.data_type || '(' || c.char_length || CASE WHEN c.char_used IS NOT NULL THEN ' ' || c.char_used ELSE '' END || ')'
        WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN c.data_type || '(' || c.data_precision || CASE WHEN c.data_scale IS NOT NULL THEN ',' || c.data_scale ELSE '' END || ')'
        WHEN c.data_type LIKE 'TIMESTAMP%' AND c.data_scale IS NOT NULL THEN c.data_type || '(' || c.data_scale || ')'
        ELSE c.data_type
    END as formatted_type,
    NULL as type_oid,
    CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END as nullable,
    CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as is_primary_key,
    c.data_default as default_value,
    cm.comments as "comment",
    c.data_type as type_category,
    NULL as enum_values,
    0 as is_computed,
    CASE WHEN c.identity_column = 'YES' THEN 1 ELSE 0 END as is_identity,
    NULL as character_set,
    NULL as collation,
    NULL as extra
FROM all_tab_columns c
LEFT JOIN all_col_comments cm
    ON cm.owner = c.owner
    AND cm.table_name = c.table_name
    AND cm.column_name = c.column_name
LEFT JOIN (
    SELECT cc.owner, cc.table_name, cc.column_name
    FROM all_cons_columns cc
    JOIN all_constraints con
        ON con.owner = cc.owner AND con.constraint_name = cc.constraint_name
    WHERE con.constraint_type = 'P'
        AND cc.owner = UPPER('${s}') AND cc.table_name = UPPER('${t}')
) pk
    ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name
WHERE c.owner = UPPER('${s}')
    AND c.table_name = UPPER('${t}')
ORDER BY c.column_id`;
  }

  getTriggersQuery(schema: string, table: string): string {
    return `
SELECT
    trigger_name,
    owner as schema_name,
    table_name,
    CASE
        WHEN trigger_type LIKE 'BEFORE%' THEN 'BEFORE'
        WHEN trigger_type LIKE 'AFTER%' THEN 'AFTER'
        ELSE 'INSTEAD OF'
    END as timing,
    REPLACE(triggering_event, ' OR ', ',') as event,
    CASE
        WHEN trigger_type LIKE '%EACH ROW' THEN 'ROW'
        ELSE 'STATEMENT'
    END as "level",
    NULL as function_body,
    CASE WHEN status = 'ENABLED' THEN 1 ELSE 0 END as enabled,
    when_clause as condition
FROM all_triggers
WHERE owner = UPPER('${escapeSqlString(schema)}')
    AND table_name = UPPER('${escapeSqlString(table)}')
ORDER BY trigger_name`;
  }

  getSupportedIndexTypesQuery(): string {
    return `
SELECT 'NORMAL' as name FROM dual
UNION ALL SELECT 'BITMAP' FROM dual
UNION ALL SELECT 'FUNCTION-BASED NORMAL' FROM dual
UNION ALL SELECT 'FUNCTION-BASED BITMAP' FROM dual`;
  }

  getSupportedColumnTypesQuery(): string {
    return ORACLE_STANDARD_COLUMN_TYPES.map(
      (type, index) =>
        `${index === 0 ? "SELECT" : "UNION ALL SELECT"} '${type}' as type_name FROM dual`,
    ).join("\n");
  }

  getTableCountQuery(schema: string, table: string, exact?: boolean): string {
    if (exact) {
      return `SELECT COUNT(*) as count FROM ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)}`;
    }

    return `
SELECT num_rows as count
FROM all_tables
WHERE owner = UPPER('${escapeSqlString(schema)}')
    AND table_name = UPPER('${escapeSqlString(table)}')`;
  }

  getTableStatsQuery(schema: string, table: string): string {
    return `
SELECT
    t.owner as owner,
    NULL as "size",
    t.num_rows as row_count,
    c.comments as "comment"
FROM all_tables t
LEFT JOIN all_tab_comments c
    ON c.owner = t.owner
    AND c.table_name = t.table_name
WHERE t.owner = UPPER('${escapeSqlString(schema)}')
    AND t.table_name = UPPER('${escapeSqlString(table)}')`;
  }

  getForeignKeyTargetsQuery(schema: string): string {
    return `
SELECT
    cc.table_name as table_name,
    cc.column_name as column_name,
    tc.data_type as data_type
FROM all_cons_columns cc
JOIN all_constraints con
    ON con.owner = cc.owner
    AND con.constraint_name = cc.constraint_name
JOIN all_tab_columns tc
    ON tc.owner = cc.owner
    AND tc.table_name = cc.table_name
    AND tc.column_name = cc.column_name
WHERE cc.owner = UPPER('${escapeSqlString(schema)}')
    AND con.constraint_type IN ('P', 'U')
ORDER BY cc.table_name, cc.position`;
  }

  getObjectDefinitionQuery(
    objectType: ObjectDefinitionType,
    schema: string,
    name: string,
  ): string {
    const schemaExpr = `UPPER('${escapeSqlString(schema)}')`;
    const nameExpr = `UPPER('${escapeSqlString(name)}')`;

    switch (objectType) {
      case "materialized_view":
        return `
SELECT DBMS_METADATA.GET_DDL('MATERIALIZED_VIEW', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "view":
        return `
SELECT DBMS_METADATA.GET_DDL('VIEW', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "function":
        return `
SELECT DBMS_METADATA.GET_DDL('FUNCTION', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "procedure":
        return `
SELECT DBMS_METADATA.GET_DDL('PROCEDURE', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "package":
        return `
SELECT
    DBMS_METADATA.GET_DDL('PACKAGE', ${nameExpr}, ${schemaExpr}) ||
    COALESCE((
        SELECT CHR(10) || CHR(10) || DBMS_METADATA.GET_DDL('PACKAGE_BODY', ${nameExpr}, ${schemaExpr})
        FROM all_objects
        WHERE owner = ${schemaExpr}
            AND object_name = ${nameExpr}
            AND object_type = 'PACKAGE BODY'
            AND ROWNUM = 1
    ), '') as definition
FROM dual`;
      case "package_body":
        return `
SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "sequence":
        return `
SELECT DBMS_METADATA.GET_DDL('SEQUENCE', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "synonym":
        return `
SELECT DBMS_METADATA.GET_DDL('SYNONYM', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "index":
        return `
SELECT DBMS_METADATA.GET_DDL('INDEX', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
      case "table":
      default:
        return `
SELECT DBMS_METADATA.GET_DDL('TABLE', ${nameExpr}, ${schemaExpr}) as definition
FROM dual`;
    }
  }

  getSequencesQuery(schema: string): string {
    return `
SELECT
    sequence_owner as schema_name,
    sequence_name,
    increment_by,
    min_value,
    max_value,
    last_number,
    cache_size,
    cycle_flag
FROM all_sequences
WHERE sequence_owner = UPPER('${escapeSqlString(schema)}')
  AND sequence_name NOT LIKE 'ISEQ$$%'
ORDER BY sequence_name`;
  }

  getPackagesQuery(schema: string): string {
    return `
SELECT
    owner as schema_name,
    object_name as package_name,
    MAX(CASE WHEN object_type = 'PACKAGE BODY' THEN 1 ELSE 0 END) as has_body
FROM all_objects
WHERE owner = UPPER('${escapeSqlString(schema)}')
    AND object_type IN ('PACKAGE', 'PACKAGE BODY')
GROUP BY owner, object_name
HAVING MAX(CASE WHEN object_type = 'PACKAGE' THEN 1 ELSE 0 END) = 1
ORDER BY object_name`;
  }

  getSynonymsQuery(schema: string): string {
    return `
SELECT
    owner as schema_name,
    synonym_name,
    table_owner,
    table_name,
    db_link
FROM all_synonyms
WHERE owner = UPPER('${escapeSqlString(schema)}')
ORDER BY synonym_name`;
  }
}
