import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useEffect } from "react";

export default function EditorPanel() {
  const { preferences, updatePreferences } = useAppStore();
  const { setUnsavedChanges } = usePreferencesStore();

  useEffect(() => {
    setUnsavedChanges(false);
  }, []);

  const handleFontSizeChange = (value: number[]) => {
    updatePreferences({ fontSize: value[0] });
    setUnsavedChanges(true);
  };

  const handleTabSizeChange = (value: string) => {
    updatePreferences({ tabSize: parseInt(value) });
    setUnsavedChanges(true);
  };

  return (
    <div className="max-w-3xl space-y-6 max-h-[calc(80vh-2rem)] overflow-y-scroll -mx-4 px-4">
      <div className="sticky top-0 bg-background z-10 pb-2">
        <h2 className="text-base font-semibold">Editor Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure the code editor preferences
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Font Size</Label>
            <span className="text-sm font-medium tabular-nums">
              {preferences.fontSize}px
            </span>
          </div>
          <Slider
            value={[preferences.fontSize]}
            onValueChange={handleFontSizeChange}
            min={10}
            max={24}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>10px</span>
            <span>14px</span>
            <span>18px</span>
            <span>24px</span>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-base">Tab Size</Label>
          <RadioGroup
            value={preferences.tabSize.toString()}
            onValueChange={handleTabSizeChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="2" id="tab-2" />
              <Label htmlFor="tab-2" className="font-normal cursor-pointer">
                2 spaces
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="4" id="tab-4" />
              <Label htmlFor="tab-4" className="font-normal cursor-pointer">
                4 spaces
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="8" id="tab-8" />
              <Label htmlFor="tab-8" className="font-normal cursor-pointer">
                8 spaces
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </div>
  );
}
