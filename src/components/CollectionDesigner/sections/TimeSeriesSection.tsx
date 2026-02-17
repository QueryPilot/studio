import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeatureSection } from "./FeatureSection";
import type {
  CollectionDesignerState,
  CollectionDesignerAction,
  TimeSeriesGranularity,
} from "../types";

interface TimeSeriesSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
  supported?: boolean;
}

export const TimeSeriesSection: React.FC<TimeSeriesSectionProps> = ({
  state,
  dispatch,
  supported = true,
}) => {
  const disabled = !supported || state.cappedEnabled;
  const disabledReason = !supported
    ? "Requires MongoDB 5.0+"
    : state.cappedEnabled
      ? "Cannot combine with Capped"
      : undefined;

  return (
    <FeatureSection
      id="time-series"
      label="Time Series"
      description="Optimized storage for time-stamped data."
      enabled={state.timeSeriesEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_TIME_SERIES", enabled }); }}
      disabled={disabled}
      disabledReason={disabledReason}
      badge="5.0+"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ts-time-field">
            Time field <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ts-time-field"
            value={state.timeField}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "timeField",
                value: e.target.value,
              });
            }}
            placeholder="timestamp"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-meta-field">Meta field</Label>
          <Input
            id="ts-meta-field"
            value={state.metaField}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "metaField",
                value: e.target.value,
              });
            }}
            placeholder="optional"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-granularity">Granularity</Label>
          <Select
            value={state.granularity}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "granularity",
                  value: value as TimeSeriesGranularity,
                });
              }
            }}
          >
            <SelectTrigger id="ts-granularity" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seconds">seconds</SelectItem>
              <SelectItem value="minutes">minutes</SelectItem>
              <SelectItem value="hours">hours</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-expire">Expire after (seconds)</Label>
          <Input
            id="ts-expire"
            value={state.expireAfterSeconds}
            onChange={(e) => {
              dispatch({
                type: "SET_FIELD",
                field: "expireAfterSeconds",
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
