import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FeatureSection } from "./FeatureSection";
import type {
  CollectionDesignerState,
  CollectionDesignerAction,
} from "../types";

interface ClusteredSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
}

export const ClusteredSection: React.FC<ClusteredSectionProps> = ({
  state,
  dispatch,
}) => {
  return (
    <FeatureSection
      id="clustered"
      label="Clustered Index"
      description="Store documents ordered by the clustered index key."
      enabled={state.clusteredEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_CLUSTERED", enabled }); }}
      disabled={state.cappedEnabled}
      disabledReason={
        state.cappedEnabled ? "Cannot combine with Capped" : undefined
      }
      badge="5.3+"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="clustered-key">Key</Label>
          <Input
            id="clustered-key"
            value='{ "_id": 1 }'
            readOnly
            className="font-mono text-xs bg-muted/30"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clustered-name">Index name</Label>
          <Input
            id="clustered-name"
            value={state.clusteredName}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "clusteredName",
                value: e.target.value,
              });
            }}
            placeholder="optional"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="clustered-expire">Expire after (seconds)</Label>
          <Input
            id="clustered-expire"
            value={state.clusteredExpireAfterSeconds}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "clusteredExpireAfterSeconds",
                value: e.target.value,
              });
            }}
            placeholder="optional"
            className="font-mono text-xs"
          />
        </div>
      </div>
    </FeatureSection>
  );
};
