import type React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeatureSection } from "./FeatureSection";
import {
  type CollectionDesignerState,
  type CollectionDesignerAction,
  type CollationCaseFirst,
  type CollationAlternate,
  type CollationMaxVariable,
  COLLATION_LOCALES,
} from "../types";

interface CollationSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
}

export const CollationSection: React.FC<CollationSectionProps> = ({
  state,
  dispatch,
}) => {
  return (
    <FeatureSection
      id="collation"
      label="Collation"
      description="Language-specific string comparison rules."
      enabled={state.collationEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_COLLATION", enabled }); }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {/* Locale */}
        <div className="space-y-1.5">
          <Label htmlFor="collation-locale">Locale</Label>
          <Select
            value={state.collationLocale}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationLocale",
                  value,
                });
              }
            }}
          >
            <SelectTrigger
              id="collation-locale"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLLATION_LOCALES.map((loc) => (
                <SelectItem key={loc} value={loc}>
                  {loc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Strength */}
        <div className="space-y-1.5">
          <Label htmlFor="collation-strength">Strength</Label>
          <Select
            value={state.collationStrength}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationStrength",
                  value,
                });
              }
            }}
          >
            <SelectTrigger
              id="collation-strength"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 - Primary</SelectItem>
              <SelectItem value="2">2 - Secondary</SelectItem>
              <SelectItem value="3">3 - Tertiary</SelectItem>
              <SelectItem value="4">4 - Quaternary</SelectItem>
              <SelectItem value="5">5 - Identical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Case First */}
        <div className="space-y-1.5">
          <Label htmlFor="collation-case-first">Case first</Label>
          <Select
            value={state.collationCaseFirst}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationCaseFirst",
                  value: value as CollationCaseFirst,
                });
              }
            }}
          >
            <SelectTrigger
              id="collation-case-first"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">off</SelectItem>
              <SelectItem value="upper">upper</SelectItem>
              <SelectItem value="lower">lower</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alternate */}
        <div className="space-y-1.5">
          <Label htmlFor="collation-alternate">Alternate</Label>
          <Select
            value={state.collationAlternate}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationAlternate",
                  value: value as CollationAlternate,
                });
              }
            }}
          >
            <SelectTrigger
              id="collation-alternate"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="non-ignorable">non-ignorable</SelectItem>
              <SelectItem value="shifted">shifted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Max Variable */}
        <div className="space-y-1.5">
          <Label htmlFor="collation-max-variable">Max variable</Label>
          <Select
            value={state.collationMaxVariable}
            onValueChange={(value) => {
              if (value != null) {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationMaxVariable",
                  value: value as CollationMaxVariable,
                });
              }
            }}
          >
            <SelectTrigger
              id="collation-max-variable"
              className="h-8 w-full text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="punct">punct</SelectItem>
              <SelectItem value="space">space</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Empty cell for grid alignment */}
        <div />

        {/* Boolean toggles */}
        <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="collation-case-level"
              checked={state.collationCaseLevel}
              onCheckedChange={(checked) => {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationCaseLevel",
                  value: checked,
                });
              }}
            />
            <Label htmlFor="collation-case-level" className="text-xs">
              Case level
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="collation-numeric-ordering"
              checked={state.collationNumericOrdering}
              onCheckedChange={(checked) => {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationNumericOrdering",
                  value: checked,
                });
              }}
            />
            <Label htmlFor="collation-numeric-ordering" className="text-xs">
              Numeric ordering
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="collation-backwards"
              checked={state.collationBackwards}
              onCheckedChange={(checked) => {
                dispatch({
                  type: "SET_FIELD",
                  field: "collationBackwards",
                  value: checked,
                });
              }}
            />
            <Label htmlFor="collation-backwards" className="text-xs">
              Backwards
            </Label>
          </div>
        </div>
      </div>
    </FeatureSection>
  );
};
