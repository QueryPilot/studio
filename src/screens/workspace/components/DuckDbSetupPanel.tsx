import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DuckDbExtensionsPanel } from "./DuckDbExtensionsPanel";
import { DuckDbSecretsPanel } from "./DuckDbSecretsPanel";
import { DuckDbAttachmentsPanel } from "./DuckDbAttachmentsPanel";

interface DuckDbSetupPanelProps {
  connectionId: string;
  onClose?: () => void;
}

/**
 * Phase 3: Consolidated DuckDB setup panel with three tabs:
 * Extensions, Attachments, Secrets.
 */
export function DuckDbSetupPanel({ connectionId, onClose }: DuckDbSetupPanelProps) {
  const [extensionsPanelOpen, setExtensionsPanelOpen] = useState(true);
  const [secretsPanelOpen, setSecretsPanelOpen] = useState(true);

  const handleClose = () => {
    onClose?.();
  };

  return (
    <Tabs defaultValue="extensions" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="extensions" className="flex-1">
          Extensions
        </TabsTrigger>
        <TabsTrigger value="attachments" className="flex-1">
          Attachments
        </TabsTrigger>
        <TabsTrigger value="secrets" className="flex-1">
          Secrets
        </TabsTrigger>
      </TabsList>
      <TabsContent value="extensions">
        <DuckDbExtensionsPanel
          connectionId={connectionId}
          open={extensionsPanelOpen}
          onClose={() => { setExtensionsPanelOpen(false); handleClose(); }}
        />
      </TabsContent>
      <TabsContent value="attachments">
        <DuckDbAttachmentsPanel connectionId={connectionId} />
      </TabsContent>
      <TabsContent value="secrets">
        <DuckDbSecretsPanel
          connectionId={connectionId}
          open={secretsPanelOpen}
          onClose={() => { setSecretsPanelOpen(false); handleClose(); }}
        />
      </TabsContent>
    </Tabs>
  );
}
