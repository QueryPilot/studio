import { useMemo } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CrudDiffSnapshot } from "@/types/crud";
import { cn } from "@/lib/cn";

import { DataDiff } from "./DataDiff";
import { ImpactSummary } from "./ImpactSummary";
import { SqlPreview } from "./SqlPreview";
import { StructureDiff } from "./StructureDiff";

interface DiffViewerProps {
  readonly snapshot: CrudDiffSnapshot;
  readonly defaultTab?: DiffViewerTab;
  readonly className?: string;
}

type DiffViewerTab = 'data' | 'structure' | 'sql' | 'impact';

const TABS: DiffViewerTab[] = ['data', 'structure', 'sql', 'impact'];

export function DiffViewer({ snapshot, defaultTab = 'data', className }: DiffViewerProps) {
  const summary = useMemo(() => buildSummary(snapshot), [snapshot]);

  return (
    <div className={cn("flex h-full flex-col gap-4", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/60 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Table Key</p>
          <p className="font-mono text-sm text-foreground">{snapshot.tableKey}</p>
        </div>
        <ul className="flex items-center gap-2 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">{summary.dataCount}</strong> data changes
          </li>
          <li>
            <strong className="text-foreground">{summary.structureCount}</strong> schema changes
          </li>
          <li>
            <strong className={summary.conflictCount > 0 ? 'text-destructive' : 'text-foreground'}>
              {summary.conflictCount}
            </strong>{" "}
            conflicts
          </li>
        </ul>
      </header>

      <Tabs defaultValue={defaultTab} className="flex-1">
        <TabsList className="w-full justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="capitalize">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="data" className="h-full">
          <DataDiff rows={snapshot.dataDiff} className="h-full" />
        </TabsContent>

        <TabsContent value="structure" className="h-full">
          <StructureDiff entries={snapshot.structureDiff} className="h-full" />
        </TabsContent>

        <TabsContent value="sql" className="h-full">
          <SqlPreview statements={snapshot.sqlStatements} className="h-full" />
        </TabsContent>

        <TabsContent value="impact" className="h-full">
          <ImpactSummary impacts={snapshot.impacts} conflicts={snapshot.conflicts} className="h-full" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function buildSummary(snapshot: CrudDiffSnapshot) {
  return {
    dataCount: snapshot.dataDiff.length,
    structureCount: snapshot.structureDiff.length,
    conflictCount: snapshot.conflicts.length,
  };
}

