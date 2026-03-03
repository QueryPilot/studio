import type { TableStructure } from "@/types/tableStructure";

function sanitizeMermaidType(dbType: string): string {
  return dbType.replace(/[^a-zA-Z0-9_()]/g, "");
}

function sanitizeMermaidName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function generateMermaidERD(tables: TableStructure[]): string {
  const lines: string[] = ["erDiagram"];

  const tableSet = new Set(
    tables.map((t) => `${t.schema.toLowerCase()}.${t.name.toLowerCase()}`),
  );

  // Entity blocks
  for (const table of tables) {
    lines.push(`    ${sanitizeMermaidName(table.name)} {`);
    for (const col of table.columns) {
      const annotations: string[] = [];
      if (col.is_pk) annotations.push("PK");
      if (col.is_fk) annotations.push("FK");
      const suffix = annotations.length > 0 ? ` ${annotations.join(",")}` : "";
      lines.push(
        `        ${sanitizeMermaidType(col.db_type) || "unknown"} ${sanitizeMermaidName(col.name)}${suffix}`,
      );
    }
    lines.push("    }");
  }

  // Relationships from foreign keys
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      const targetSchema = fk.foreignSchema ?? table.schema;
      const targetKey = `${targetSchema.toLowerCase()}.${fk.foreignTable.toLowerCase()}`;
      if (!tableSet.has(targetKey)) continue;

      const from = sanitizeMermaidName(table.name);
      const to = sanitizeMermaidName(fk.foreignTable);
      const label = fk.columns.join(", ");
      lines.push(`    ${from} }o--|| ${to} : "${label}"`);
    }
  }

  return lines.join("\n");
}
