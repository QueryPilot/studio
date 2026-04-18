type SchemaNameLike = string | { name: string };

export function schemaNamesForAttachedDatabase(
  schemas: SchemaNameLike[],
  dbName: string,
): string[] {
  const prefix = `${dbName}.`;
  return Array.from(
    new Set(
      schemas
        .map((schema) => (typeof schema === "string" ? schema : schema.name))
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}
