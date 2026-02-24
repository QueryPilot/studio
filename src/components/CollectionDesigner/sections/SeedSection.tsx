import type React from "react";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/CodeEditor";
import { FeatureSection } from "./FeatureSection";
import type {
  CollectionDesignerState,
  CollectionDesignerAction,
} from "../types";

interface SeedSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
}

export const SeedSection: React.FC<SeedSectionProps> = ({
  state,
  dispatch,
}) => {
  return (
    <FeatureSection
      id="seed"
      label="Seed first document"
      description="Insert one document immediately after collection creation."
      enabled={state.seedEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_SEED", enabled }); }}
    >
      <div className="space-y-1.5">
        <Label>Seed document JSON</Label>
        <div className="rounded-md border overflow-hidden">
          <CodeEditor
            value={state.seedJson}
            onChange={(value) => {
              dispatch({
                type: "SET_FIELD",
                field: "seedJson",
                value,
              });
            }}
            language="json"
            minHeight="120px"
            maxHeight="240px"
            lineNumbers={false}
            placeholder='{"name":"example"}'
          />
        </div>
      </div>
    </FeatureSection>
  );
};
