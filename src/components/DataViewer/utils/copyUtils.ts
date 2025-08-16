export const copyAsCSV = (rows: any[], columns: string[]) => {
  const headers = columns.filter(col => col !== "_rowIndex").join(",");
  const csvRows = rows.map(row => {
    return columns
      .filter(col => col !== "_rowIndex")
      .map(col => {
        const value = row[col];
        if (value === null) return "";
        if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",");
  });
  
  const csv = [headers, ...csvRows].join("\n");
  navigator.clipboard.writeText(csv);
};

export const copyAsJSON = (rows: any[]) => {
  const cleanRows = rows.map(row => {
    const cleanRow = { ...row };
    delete cleanRow._rowIndex;
    return cleanRow;
  });
  
  const json = JSON.stringify(cleanRows, null, 2);
  navigator.clipboard.writeText(json);
};

export const copyAsSQLValues = (rows: any[], columns: string[]) => {
  const valueRows = rows.map(row => {
    const values = columns
      .filter(col => col !== "_rowIndex")
      .map(col => {
        const value = row[col];
        if (value === null) return "NULL";
        if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
        if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
        if (value instanceof Date) return `'${value.toISOString()}'`;
        return value;
      });
    return `(${values.join(", ")})`;
  });
  
  const sql = valueRows.join(",\n");
  navigator.clipboard.writeText(sql);
};

export const copyAsInsertStatement = (
  rows: any[],
  columns: string[],
  tableName: string,
  schema?: string
) => {
  const table = schema ? `${schema}.${tableName}` : tableName;
  const cols = columns.filter(col => col !== "_rowIndex");
  
  const insertStatements = rows.map(row => {
    const values = cols.map(col => {
      const value = row[col];
      if (value === null) return "NULL";
      if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
      if (value instanceof Date) return `'${value.toISOString()}'`;
      return value;
    });
    
    return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values.join(", ")});`;
  });
  
  const sql = insertStatements.join("\n");
  navigator.clipboard.writeText(sql);
};