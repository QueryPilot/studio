import { logger } from "@/lib/logger";
import type {
  ForeignKeyRelationship,
  TableRelationshipGraph,
  JoinSuggestion,
} from "@/types/relationships";
import { type Constraint, ConstraintType } from "./backend";
import type { TableMeta } from "./databaseService";
import { IntrospectionService } from "./introspectionService";

/**
 * Service to manage foreign key relationships and provide smart JOIN suggestions
 */
class RelationshipService {
  private static instance?: RelationshipService;

  private constructor() {}

  static getInstance(): RelationshipService {
    if (!this.instance) {
      this.instance = new RelationshipService();
    }
    return this.instance;
  }

  /**
   * Parse a foreign key constraint definition to extract column mappings
   * Handles formats like:
   * - PostgreSQL: "FOREIGN KEY (user_id) REFERENCES users(id)"
   * - MySQL: "FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)"
   */
  private parseForeignKeyDefinition(
    definition: string,
  ): {
    sourceColumn: string;
    targetColumn: string;
    sourceColumns: string[];
    targetColumns: string[];
  } | null {
    // Remove extra whitespace and newlines
    const cleaned = definition.replace(/\s+/g, " ").trim();

    // Match pattern: FOREIGN KEY (col) REFERENCES [schema.]table(col)
    // Note: [^\s."`)]+  handles identifiers with hyphens (e.g. "lvcet-lms")
    const match = cleaned.match(
      /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:["`]?[^\s."`)]+["`]?\.)?\s*["`]?([^\s("`)]+)["`]?\s*\(([^)]+)\)/i,
    );

    if (!match) {
      return null;
    }

    const sourceColumns = this.parseIdentifierList(match[1] ?? "");
    const targetColumns = this.parseIdentifierList(match[3] ?? "");

    if (sourceColumns.length === 0 || targetColumns.length === 0) {
      return null;
    }

    return {
      sourceColumn: sourceColumns[0] ?? "",
      targetColumn: targetColumns[0] ?? "",
      sourceColumns,
      targetColumns,
    };
  }

  private parseIdentifierList(rawColumns: string): string[] {
    return rawColumns
      .split(",")
      .map((column) => column.replace(/["`[\]]/g, "").trim())
      .filter(Boolean);
  }

  private buildJoinCondition(
    leftQualifier: string,
    leftColumns: string[] | undefined,
    leftFallbackColumn: string,
    rightQualifier: string,
    rightColumns: string[] | undefined,
    rightFallbackColumn: string,
  ): string {
    const sourceColumns =
      leftColumns && leftColumns.length > 0 ? leftColumns : [leftFallbackColumn];
    const targetColumns =
      rightColumns && rightColumns.length > 0
        ? rightColumns
        : [rightFallbackColumn];
    const pairCount = Math.min(sourceColumns.length, targetColumns.length);

    return Array.from({ length: pairCount }, (_, index) => {
      const leftColumn = sourceColumns[index];
      const rightColumn = targetColumns[index];
      return `${leftQualifier}.${leftColumn} = ${rightQualifier}.${rightColumn}`;
    }).join(" AND ");
  }

  /**
   * Extract ON DELETE and ON UPDATE actions from constraint definition
   */
  private parseConstraintActions(definition: string): {
    onDelete?: string;
    onUpdate?: string;
  } {
    const onDeleteMatch = definition.match(/ON\s+DELETE\s+([A-Z\s]+)/i);
    const onUpdateMatch = definition.match(/ON\s+UPDATE\s+([A-Z\s]+)/i);

    return {
      onDelete: onDeleteMatch?.[1]?.trim(),
      onUpdate: onUpdateMatch?.[1]?.trim(),
    };
  }

  /**
   * Build relationship graph for a schema by fetching constraints for all tables
   */
  async buildRelationshipGraph(
    connectionId: string,
    schema: string,
    tables: TableMeta[],
  ): Promise<TableRelationshipGraph> {
    const relationships = new Map<string, ForeignKeyRelationship[]>();
    const reverseRelationships = new Map<string, ForeignKeyRelationship[]>();

    // Fetch constraints for all tables (in parallel with concurrency limit)
    const constraintPromises = tables.map(async (table) => {
      try {
        const constraints = await IntrospectionService.getConstraints(
          connectionId,
          schema,
          table.name,
        );
        return { table: table.name, constraints };
      } catch (error) {
        logger.debug(
          `Failed to fetch constraints for table ${table.name}:`,
          error,
        );
        return { table: table.name, constraints: [] };
      }
    });

    // Process in batches to avoid overwhelming the backend
    const batchSize = 5;
    const results: Array<{ table: string; constraints: Constraint[] }> = [];

    for (let i = 0; i < constraintPromises.length; i += batchSize) {
      const batch = constraintPromises.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }

    // Parse FK constraints and build relationships
    for (const { table, constraints } of results) {
      const fkConstraints = constraints.filter(
        (c) => c.constraint_type === ConstraintType.ForeignKey,
      );

      for (const constraint of fkConstraints) {
        const parsed = this.parseForeignKeyDefinition(constraint.definition);
        if (!parsed || !constraint.foreign_table) {
          continue;
        }

        const actions = this.parseConstraintActions(constraint.definition);

        // Extract target table name (remove schema prefix if present)
        const targetTable = constraint.foreign_table.includes(".")
          ? constraint.foreign_table.split(".")[1] ?? constraint.foreign_table
          : constraint.foreign_table;

        const relationship: ForeignKeyRelationship = {
          sourceTable: table,
          sourceSchema: schema,
          sourceColumn: parsed.sourceColumn || "",
          sourceColumns: parsed.sourceColumns,
          targetTable: targetTable,
          targetSchema: schema, // Assume same schema for now
          targetColumn: parsed.targetColumn || "",
          targetColumns: parsed.targetColumns,
          constraintName: constraint.name,
          onDelete: actions.onDelete,
          onUpdate: actions.onUpdate,
        };

        // Add to forward relationships
        const existing = relationships.get(table) || [];
        existing.push(relationship);
        relationships.set(table, existing);

        // Add to reverse relationships
        const reverseExisting = reverseRelationships.get(targetTable) || [];
        reverseExisting.push(relationship);
        reverseRelationships.set(targetTable, reverseExisting);
      }
    }

    return { relationships, reverseRelationships };
  }

  /**
   * Get smart JOIN suggestions based on tables already in scope
   */
  getJoinSuggestions(
    relationshipGraph: TableRelationshipGraph,
    tablesInScope: Array<{ table: string; alias?: string }>,
    _currentSchema: string,
  ): JoinSuggestion[] {
    const suggestions: JoinSuggestion[] = [];
    const suggestedTables = new Set<string>();

    // For each table in scope, find tables it can join with
    for (const tableRef of tablesInScope) {
      const table = tableRef.table;
      const tableIdentifier = tableRef.alias || table;

      // Get outgoing relationships (this table references others)
      const outgoing = relationshipGraph.relationships.get(table) || [];
      for (const rel of outgoing) {
        if (suggestedTables.has(rel.targetTable)) continue;
        if (tablesInScope.some((t) => t.table === rel.targetTable)) continue;

        suggestions.push({
          table: rel.targetTable,
          schema: rel.targetSchema,
          onCondition: this.buildJoinCondition(
            tableIdentifier,
            rel.sourceColumns,
            rel.sourceColumn,
            rel.targetTable,
            rel.targetColumns,
            rel.targetColumn,
          ),
          relationshipType: "many-to-one",
          score: 100,
          description: `${tableIdentifier} references ${rel.targetTable}`,
        });

        suggestedTables.add(rel.targetTable);
      }

      // Get incoming relationships (other tables reference this one)
      const incoming = relationshipGraph.reverseRelationships.get(table) || [];
      for (const rel of incoming) {
        if (suggestedTables.has(rel.sourceTable)) continue;
        if (tablesInScope.some((t) => t.table === rel.sourceTable)) continue;

        suggestions.push({
          table: rel.sourceTable,
          schema: rel.sourceSchema,
          onCondition: this.buildJoinCondition(
            rel.sourceTable,
            rel.sourceColumns,
            rel.sourceColumn,
            tableIdentifier,
            rel.targetColumns,
            rel.targetColumn,
          ),
          relationshipType: "one-to-many",
          score: 95,
          description: `${rel.sourceTable} references ${tableIdentifier}`,
        });

        suggestedTables.add(rel.sourceTable);
      }
    }

    // Sort by score (highest first)
    return suggestions.sort((a, b) => b.score - a.score);
  }

  /**
   * Get the ON condition for joining two specific tables
   */
  getJoinCondition(
    relationshipGraph: TableRelationshipGraph,
    sourceTableRef: { table: string; alias?: string },
    targetTable: string,
  ): string | null {
    const sourceTable = sourceTableRef.table;
    const sourceIdentifier = sourceTableRef.alias || sourceTable;

    // Check forward relationship
    const outgoing = relationshipGraph.relationships.get(sourceTable) || [];
    const forwardRel = outgoing.find((r) => r.targetTable === targetTable);
    if (forwardRel) {
      return this.buildJoinCondition(
        sourceIdentifier,
        forwardRel.sourceColumns,
        forwardRel.sourceColumn,
        targetTable,
        forwardRel.targetColumns,
        forwardRel.targetColumn,
      );
    }

    // Check reverse relationship
    const incoming =
      relationshipGraph.reverseRelationships.get(sourceTable) || [];
    const reverseRel = incoming.find((r) => r.sourceTable === targetTable);
    if (reverseRel) {
      return this.buildJoinCondition(
        targetTable,
        reverseRel.sourceColumns,
        reverseRel.sourceColumn,
        sourceIdentifier,
        reverseRel.targetColumns,
        reverseRel.targetColumn,
      );
    }

    return null;
  }
}

export const relationshipService = RelationshipService.getInstance();
