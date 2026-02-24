import type React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "@/components/CodeEditor";
import { FeatureSection } from "./FeatureSection";
import type {
  CollectionDesignerState,
  CollectionDesignerAction,
  ValidationLevel,
  ValidationAction,
} from "../types";

interface ValidationSectionProps {
  state: CollectionDesignerState;
  dispatch: React.Dispatch<CollectionDesignerAction>;
}

export const ValidationSection: React.FC<ValidationSectionProps> = ({
  state,
  dispatch,
}) => {
  return (
    <FeatureSection
      id="validation"
      label="Document validation"
      description="Apply validator rules to incoming documents."
      enabled={state.validationEnabled}
      onToggle={(enabled) => { dispatch({ type: "TOGGLE_VALIDATION", enabled }); }}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Validator JSON</Label>
          <div className="rounded-md border overflow-hidden">
            <CodeEditor
              value={state.validatorJson}
              onChange={(value) => {
                dispatch({
                  type: "SET_FIELD",
                  field: "validatorJson",
                  value,
                });
              }}
              language="json"
              minHeight="120px"
              maxHeight="240px"
              lineNumbers={false}
              placeholder='{"$jsonSchema":{"bsonType":"object"}}'
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="validation-level">Validation level</Label>
            <Select
              value={state.validationLevel}
              onValueChange={(value) => {
                if (value != null) {
                  dispatch({
                    type: "SET_FIELD",
                    field: "validationLevel",
                    value: value as ValidationLevel,
                  });
                }
              }}
            >
              <SelectTrigger
                id="validation-level"
                className="h-8 w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">strict</SelectItem>
                <SelectItem value="moderate">moderate</SelectItem>
                <SelectItem value="off">off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="validation-action">Validation action</Label>
            <Select
              value={state.validationAction}
              onValueChange={(value) => {
                if (value != null) {
                  dispatch({
                    type: "SET_FIELD",
                    field: "validationAction",
                    value: value as ValidationAction,
                  });
                }
              }}
            >
              <SelectTrigger
                id="validation-action"
                className="h-8 w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="warn">warn</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </FeatureSection>
  );
};
