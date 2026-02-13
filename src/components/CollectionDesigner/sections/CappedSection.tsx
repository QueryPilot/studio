import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FeatureSection } from "./FeatureSection";
import type {
  CollectionDesignerState,
  CollectionDesignerAction,
} from "../types";

interface CappedSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
}

export const CappedSection: React.FC<CappedSectionProps> = ({
  state,
  dispatch,
}) => {
  const disabled = state.timeSeriesEnabled || state.clusteredEnabled;
  const disabledReason = state.timeSeriesEnabled
    ? "Cannot combine with Time Series"
    : state.clusteredEnabled
      ? "Cannot combine with Clustered Index"
      : undefined;

  return (
    <FeatureSection
      id="capped"
      label="Capped collection"
      description="Limit collection by size and optional document count."
      enabled={state.cappedEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_CAPPED", enabled }); }}
      disabled={disabled}
      disabledReason={disabledReason}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="capped-size">Size (bytes)</Label>
          <Input
            id="capped-size"
            value={state.cappedSize}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "cappedSize",
                value: e.target.value,
              });
            }}
            placeholder="1048576"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capped-max">Max documents</Label>
          <Input
            id="capped-max"
            value={state.cappedMax}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "cappedMax",
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
