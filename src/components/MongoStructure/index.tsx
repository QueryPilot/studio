import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MongoDBAdapter } from "@/adapters/mongodb/MongoDBAdapter";
import type {
  DocumentSchemaSample,
  MongoCollectionMetadata,
} from "@/adapters/types/mongodb";
import type { MongoWorkbenchState } from "@/types/mongoWorkbench";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { structureColumns } from "./columns";
import {
  buildSchemaTree,
  flattenSchemaTree,
  formatPercent,
  formatSampleValues,
  formatTypes,
  type SchemaRow,
} from "./utils";
import {
  SchemaFieldCellRenderer,
  TypeDistributionCellRenderer,
} from "./SchemaFieldCell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyCell = CustomCell<Record<string, unknown>>;

interface MongoStructureViewProps {
  connectionId: string;
  database: string;
  collection: string;
  workbenchState: MongoWorkbenchState;
  onWorkbenchStateChange: (updates: Partial<MongoWorkbenchState>) => void;
}

// ---------------------------------------------------------------------------
// Stat card (inline)
// ---------------------------------------------------------------------------

function StatChip({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded border bg-muted/20 px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MongoStructureView = memo(function MongoStructureView({
  connectionId,
  database,
  collection,
  workbenchState,
  onWorkbenchStateChange,
}: MongoStructureViewProps) {
  const [sample, setSample] = useState<DocumentSchemaSample | null>(null);
  const [metadata, setMetadata] = useState<MongoCollectionMetadata | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const sampleSize = workbenchState.structureSampleSize ?? 500;
  const maxDepth = workbenchState.structureMaxDepth ?? 4;

  // ---- Data loading ----

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const adapter = new MongoDBAdapter(connectionId);
      const [nextMetadata, nextSample] = await Promise.all([
        adapter.getCollectionMetadata(collection, database),
        adapter.sampleCollectionSchema(
          collection,
          undefined,
          { sampleSize, maxDepth },
          database,
        ),
      ]);
      setMetadata(nextMetadata);
      setSample(nextSample);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [collection, connectionId, database, maxDepth, sampleSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Tree / rows ----

  const tree = useMemo(
    () => buildSchemaTree(sample, metadata),
    [metadata, sample],
  );

  const rows = useMemo(
    () => flattenSchemaTree(tree, expandedPaths),
    [tree, expandedPaths],
  );

  const scannedCount = sample?.scannedCount ?? 0;

  // ---- Column sizing ----

  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: structureColumns,
      initialWidths: {},
      onChange: () => {
        // No persistence needed for now
      },
    });

  // ---- Custom renderers ----

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      SchemaFieldCellRenderer as unknown as CustomRenderer<AnyCell>,
      TypeDistributionCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  // ---- Cell content ----

  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row: SchemaRow | undefined = rows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      const { node } = row;

      switch (column.field) {
        // Custom cell: tree-indented field name
        case "field":
          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "schema-field-cell" as const,
              field: row.field,
              depth: row.depth,
              hasChildren: row.hasChildren,
              isExpanded: row.isExpanded,
              isRequired: node.overlay?.required === true,
            },
            copyData: row.field,
            readonly: true,
            allowOverlay: false,
          } as const;

        // Custom cell: color-segmented type distribution bar
        case "typeDistribution": {
          const types = node.field?.types ?? [];

          // Build type distribution from the field stat.
          // DocumentFieldStat.types only lists type names without counts,
          // so we distribute evenly when there are multiple types.
          const typeEntries =
            types.length > 0
              ? types.map((t) => ({
                  type: t,
                  percentage: 100 / types.length,
                }))
              : [];

          // If there's no sampled field data but we have overlay types, show those
          if (typeEntries.length === 0 && node.overlay?.bsonType) {
            const overlayTypes = Array.isArray(node.overlay.bsonType)
              ? node.overlay.bsonType
              : [node.overlay.bsonType];
            for (const t of overlayTypes) {
              typeEntries.push({ type: t, percentage: 100 / overlayTypes.length });
            }
          }

          return {
            kind: GridCellKind.Custom,
            data: {
              kind: "type-distribution-cell" as const,
              types: typeEntries,
            },
            copyData: formatTypes(node.field, node.overlay),
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        // Text cell: present percentage
        case "present": {
          const value = node.field
            ? formatPercent(node.field.occurrences, scannedCount)
            : "";
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        // Text cell: null percentage
        case "nullPct": {
          const value = node.field
            ? formatPercent(node.field.nullCount, node.field.occurrences)
            : "";
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        // Text cell: sample values
        case "samples": {
          const value = node.field
            ? formatSampleValues(node.field.sampleValues)
            : node.overlay
              ? "Validator only"
              : "";
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        // Text cell: validator info
        case "validator": {
          const parts: string[] = [];
          if (node.overlay?.required) parts.push("required");
          if (node.overlay?.bsonType) {
            const bt = Array.isArray(node.overlay.bsonType)
              ? node.overlay.bsonType.join("|")
              : node.overlay.bsonType;
            parts.push(bt);
          }
          const value = parts.join(", ");
          return {
            kind: GridCellKind.Text,
            data: value,
            displayData: value,
            readonly: true,
            allowOverlay: false,
          } as const;
        }

        default: {
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
            readonly: true,
            allowOverlay: false,
          } as const;
        }
      }
    },
    [rows, sizedColumns, scannedCount],
  );

  // ---- Expand / Collapse ----

  const handleCellClicked = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row: SchemaRow | undefined = rows[rowIndex];

      if (!column || !row) return;

      // Only toggle on click in the field column, and only if the node has children
      if (column.field === "field" && row.hasChildren) {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(row.path)) {
            next.delete(row.path);
          } else {
            next.add(row.path);
          }
          return next;
        });
      }
    },
    [sizedColumns, rows],
  );

  // ---- Render ----

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-2 pb-1.5 pt-1">
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="mongo-structure-sample-size"
            className="text-xs whitespace-nowrap"
          >
            Sample size
          </Label>
          <Input
            id="mongo-structure-sample-size"
            type="number"
            min={50}
            max={5000}
            value={sampleSize}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureSampleSize: Number(event.target.value) || 500,
              });
            }}
            className="h-7 w-24 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="mongo-structure-max-depth"
            className="text-xs whitespace-nowrap"
          >
            Max depth
          </Label>
          <Input
            id="mongo-structure-max-depth"
            type="number"
            min={1}
            max={12}
            value={maxDepth}
            onChange={(event) => {
              onWorkbenchStateChange({
                structureMaxDepth: Number(event.target.value) || 4,
              });
            }}
            className="h-7 w-20 text-xs"
          />
        </div>

        <Button size="sm" variant="outline" className="h-7" onClick={() => void load()}>
          Refresh
        </Button>

        <div className="flex-1" />

        {/* Stat chips */}
        {metadata ? (
          <div className="flex items-center gap-2">
            <StatChip
              label="Docs sampled"
              value={sample ? sample.scannedCount.toLocaleString() : 0}
            />
            <StatChip
              label="Fields"
              value={sample ? sample.fields.length.toLocaleString() : 0}
            />
            <StatChip
              label="Validator"
              value={metadata.validator ? "Attached" : "None"}
            />
          </div>
        ) : null}
      </div>

      {/* Grid or status */}
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading structure...
          </div>
        ) : error ? (
          <div className="m-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No sampled fields were returned.
          </div>
        ) : (
          <DataGridBase
            columns={sizedColumns}
            rowCount={rows.length}
            getCellContent={getCellContent}
            customRenderers={customRenderers}
            rowSelect="none"
            columnSelect="none"
            onColumnResize={handleColumnResize}
            onColumnResizeEnd={handleColumnResizeEnd}
            onCellClicked={handleCellClicked}
          />
        )}
      </div>
    </div>
  );
});

