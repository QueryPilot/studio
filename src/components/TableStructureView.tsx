/**
 * Component to display comprehensive table structure
 */
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Key, 
  Database, 
  FileText, 
  Zap, 
  BarChart3,
  RefreshCw,
  Loader2 
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TableStructureViewProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
}

export function TableStructureView({
  connectionId,
  database,
  table,
  schema = "public",
}: TableStructureViewProps) {
  const { structure, isLoading, error, refresh } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Error Loading Table Structure</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!structure) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Header with table info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                {structure.schema}.{structure.name}
              </CardTitle>
              <CardDescription>
                {structure.comment || "No description available"}
              </CardDescription>
            </div>
            <Button
              onClick={() => void refresh()}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          
          {/* Table statistics */}
          <div className="flex gap-4 mt-4 text-sm">
            {structure.rowCount !== undefined && (
              <Badge variant="secondary">
                {structure.rowCount.toLocaleString()} rows
              </Badge>
            )}
            {structure.size && (
              <Badge variant="secondary">
                Size: {structure.size}
              </Badge>
            )}
            {structure.owner && (
              <Badge variant="secondary">
                Owner: {structure.owner}
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Tabbed view of structure details */}
      <Tabs defaultValue="columns" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="columns" className="gap-2">
            <FileText className="h-4 w-4" />
            Columns ({structure.columns.length})
          </TabsTrigger>
          <TabsTrigger value="indexes" className="gap-2">
            <Zap className="h-4 w-4" />
            Indexes ({structure.indexes.length})
          </TabsTrigger>
          <TabsTrigger value="constraints" className="gap-2">
            <Key className="h-4 w-4" />
            Constraints ({structure.constraints.length})
          </TabsTrigger>
          <TabsTrigger value="triggers" className="gap-2">
            <Database className="h-4 w-4" />
            Triggers ({structure.triggers.length})
          </TabsTrigger>
          <TabsTrigger value="statistics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Statistics
          </TabsTrigger>
        </TabsList>

        {/* Columns Tab */}
        <TabsContent value="columns">
          <Card>
            <CardHeader>
              <CardTitle>Table Columns</CardTitle>
              <CardDescription>
                Column definitions and data types
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Nullable</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead>Constraints</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {structure.columns.map((column) => (
                    <TableRow key={column.name}>
                      <TableCell className="font-mono">
                        {column.name}
                        {structure.primaryKeys.includes(column.name) && (
                          <Badge variant="default" className="ml-2">PK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {column.db_type}
                      </TableCell>
                      <TableCell>
                        {column.nullable ? "Yes" : "No"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {column.default || "-"}
                      </TableCell>
                      <TableCell>
                        {column.is_pk && <Badge variant="outline">Primary Key</Badge>}
                        {column.is_fk && <Badge variant="outline">Foreign Key</Badge>}
                        {column.is_unique && <Badge variant="outline">Unique</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Indexes Tab */}
        <TabsContent value="indexes">
          <Card>
            <CardHeader>
              <CardTitle>Table Indexes</CardTitle>
              <CardDescription>
                Performance optimization indexes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Columns</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Unique</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {structure.indexes.map((index) => (
                    <TableRow key={index.name}>
                      <TableCell className="font-mono">
                        {index.name}
                        {index.is_primary && (
                          <Badge variant="default" className="ml-2">PRIMARY</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {index.columns.join(", ")}
                      </TableCell>
                      <TableCell>
                        {index.is_partial ? "Partial" : "Full"}
                      </TableCell>
                      <TableCell>
                        {index.is_unique ? "Yes" : "No"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Constraints Tab */}
        <TabsContent value="constraints">
          <Card>
            <CardHeader>
              <CardTitle>Table Constraints</CardTitle>
              <CardDescription>
                Data integrity constraints
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Foreign Keys */}
                {structure.foreignKeys.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Foreign Keys</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Columns</TableHead>
                          <TableHead>References</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {structure.foreignKeys.map((fk) => (
                          <TableRow key={fk.name}>
                            <TableCell className="font-mono text-sm">
                              {fk.name}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {fk.columns.join(", ")}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {fk.foreignSchema}.{fk.foreignTable}({fk.foreignColumns.join(", ")})
                            </TableCell>
                            <TableCell className="text-sm">
                              {fk.onDelete && <Badge variant="outline">ON DELETE {fk.onDelete}</Badge>}
                              {fk.onUpdate && <Badge variant="outline">ON UPDATE {fk.onUpdate}</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Other Constraints */}
                <div>
                  <h4 className="font-semibold mb-2">All Constraints</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Definition</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {structure.constraints.map((constraint) => (
                        <TableRow key={constraint.name}>
                          <TableCell className="font-mono text-sm">
                            {constraint.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {constraint.constraint_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {constraint.definition}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Triggers Tab */}
        <TabsContent value="triggers">
          <Card>
            <CardHeader>
              <CardTitle>Table Triggers</CardTitle>
              <CardDescription>
                Automated actions on data changes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Timing</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {structure.triggers.map((trigger) => (
                    <TableRow key={trigger.name}>
                      <TableCell className="font-mono">
                        {trigger.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{trigger.event}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{trigger.timing}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {trigger.function}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trigger.enabled ? "default" : "secondary"}>
                          {trigger.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Statistics Tab */}
        <TabsContent value="statistics">
          <Card>
            <CardHeader>
              <CardTitle>Table Statistics</CardTitle>
              <CardDescription>
                Performance and storage metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              {structure.stats ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Rows</p>
                    <p className="text-2xl font-bold">
                      {structure.stats.totalRows.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Table Size</p>
                    <p className="text-2xl font-bold">{structure.stats.tableSize}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Index Size</p>
                    <p className="text-2xl font-bold">{structure.stats.indexSize}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Size</p>
                    <p className="text-2xl font-bold">{structure.stats.totalSize}</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No statistics available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}