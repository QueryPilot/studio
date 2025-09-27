import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/appStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useEffect } from "react";

export default function GeneralPanel() {
  const {
    theme,
    setTheme,
    sidebarCollapsed,
    toggleSidebar,
    preferences,
    updatePreferences,
  } = useAppStore();
  const { setUnsavedChanges } = usePreferencesStore();

  useEffect(() => {
    setUnsavedChanges(false);
  }, []);

  const handleThemeChange = (value: string) => {
    setTheme(value as "light" | "dark" | "system");
    setUnsavedChanges(true);
  };

  const handleFontSizeChange = (value: number[]) => {
    updatePreferences({ fontSize: value[0] });
    setUnsavedChanges(true);
  };

  const handleSidebarToggle = (checked: boolean) => {
    if (checked !== sidebarCollapsed) {
      toggleSidebar();
      setUnsavedChanges(true);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the application appearance and behavior
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-base">Theme</Label>
          <RadioGroup
            value={theme}
            onValueChange={handleThemeChange}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="light" id="light" />
              <Label htmlFor="light" className="font-normal cursor-pointer">
                Light
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="dark" id="dark" />
              <Label htmlFor="dark" className="font-normal cursor-pointer">
                Dark
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="system" id="system" />
              <Label htmlFor="system" className="font-normal cursor-pointer">
                System
              </Label>
            </div>
          </RadioGroup>
        </div>

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
            min={12}
            max={20}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>12px</span>
            <span>16px</span>
            <span>20px</span>
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border rounded-lg px-4">
          <div className="space-y-0.5">
            <Label className="text-base">Sidebar Collapsed</Label>
            <p className="text-sm text-muted-foreground">
              Keep the sidebar collapsed by default
            </p>
          </div>
          <Switch
            checked={sidebarCollapsed}
            onCheckedChange={handleSidebarToggle}
          />
        </div>
      </div>
    </div>
  );
}
