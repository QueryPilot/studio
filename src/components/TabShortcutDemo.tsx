/**
 * Demo component to test and showcase tab keyboard shortcuts
 *
 * Usage:
 * 1. Import and render this component anywhere in your app
 * 2. Click on a tab group to focus it
 * 3. Hold Cmd/Ctrl to see numbered shortcuts appear
 * 4. Press Cmd/Ctrl + Number (1-9) to switch tabs
 * 5. Try focusing different tab groups to see context-aware behavior
 */

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function TabShortcutDemo() {
  const [topTabValue, setTopTabValue] = useState('tab1');
  const [bottomTabValue, setBottomTabValue] = useState('tab1');

  return (
    <div className="p-8 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Tab Keyboard Shortcuts Demo</CardTitle>
          <CardDescription>
            Click a tab group to focus it, then hold Cmd/Ctrl and press 1-9 to switch tabs.
            Only the focused group will respond to shortcuts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* First Tab Group */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Tab Group 1 (Top)</h3>
            <Tabs
              value={topTabValue}
              onValueChange={setTopTabValue}
              enableShortcuts={true}
              tabGroupId="demo-top"
            >
              <TabsList>
                <TabsTrigger value="tab1" tabIndex={0}>
                  Dashboard
                </TabsTrigger>
                <TabsTrigger value="tab2" tabIndex={1}>
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="tab3" tabIndex={2}>
                  Reports
                </TabsTrigger>
                <TabsTrigger value="tab4" tabIndex={3}>
                  Settings
                </TabsTrigger>
                <TabsTrigger value="tab5" tabIndex={4}>
                  Users
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tab1" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Dashboard Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is the dashboard content. Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+1</kbd> to switch here.
                </p>
              </TabsContent>

              <TabsContent value="tab2" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Analytics Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is the analytics content. Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+2</kbd> to switch here.
                </p>
              </TabsContent>

              <TabsContent value="tab3" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Reports Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is the reports content. Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+3</kbd> to switch here.
                </p>
              </TabsContent>

              <TabsContent value="tab4" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Settings Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is the settings content. Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+4</kbd> to switch here.
                </p>
              </TabsContent>

              <TabsContent value="tab5" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Users Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is the users content. Press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+5</kbd> to switch here.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          {/* Second Tab Group */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Tab Group 2 (Bottom)</h3>
            <Tabs
              value={bottomTabValue}
              onValueChange={setBottomTabValue}
              enableShortcuts={true}
              tabGroupId="demo-bottom"
            >
              <TabsList>
                <TabsTrigger value="tab1" tabIndex={0}>
                  Overview
                </TabsTrigger>
                <TabsTrigger value="tab2" tabIndex={1}>
                  Details
                </TabsTrigger>
                <TabsTrigger value="tab3" tabIndex={2}>
                  History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tab1" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Overview Tab</h4>
                <p className="text-sm text-muted-foreground">
                  This is a different tab group. When focused, <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+1</kbd> switches here instead.
                </p>
              </TabsContent>

              <TabsContent value="tab2" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">Details Tab</h4>
                <p className="text-sm text-muted-foreground">
                  Focus this group and press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+2</kbd> to switch here.
                </p>
              </TabsContent>

              <TabsContent value="tab3" className="p-4 border rounded-md">
                <h4 className="font-semibold mb-2">History Tab</h4>
                <p className="text-sm text-muted-foreground">
                  Focus this group and press <kbd className="px-1.5 py-0.5 text-xs bg-muted border rounded">Cmd+3</kbd> to switch here.
                </p>
              </TabsContent>
            </Tabs>
          </div>

          {/* Instructions */}
          <div className="p-4 bg-muted rounded-md space-y-2">
            <h4 className="font-semibold text-sm">How to Test:</h4>
            <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
              <li>Click on any tab in either group to focus that tab group</li>
              <li>Hold down <kbd className="px-1.5 py-0.5 text-xs bg-background border rounded">Cmd</kbd> (macOS) or <kbd className="px-1.5 py-0.5 text-xs bg-background border rounded">Ctrl</kbd> (Windows/Linux)</li>
              <li>You should see numbered shortcuts (①, ②, ③...) appear on the focused tab group only</li>
              <li>While holding the modifier key, press a number (1-9) to switch tabs</li>
              <li>Try focusing different tab groups to verify context-aware behavior</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
