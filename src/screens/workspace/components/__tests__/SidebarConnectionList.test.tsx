import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DbType } from "@/types/connection";
import { useWorkspaceBundleStore } from "@/stores/workspaceBundleStore";
import { SidebarConnectionList } from "../SidebarConnectionList";

const { refreshConnectionDataMock } = vi.hoisted(() => ({
  refreshConnectionDataMock: vi.fn(),
}));

vi.mock("@/lib/refreshConnectionData", () => ({
  refreshConnectionData: refreshConnectionDataMock,
}));

vi.mock("../ConnectionSection", () => ({
  ConnectionSection: ({ connection }: { connection: { id: string } }) => (
    <div data-testid={`connection-${connection.id}`}>{connection.id}</div>
  ),
}));

describe("SidebarConnectionList refresh button", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useWorkspaceBundleStore.setState({
      activeWorkspace: {
        focusedConnectionId: "conn-1",
        connections: new Map([
          [
            "conn-1",
            {
              id: "conn-1",
              status: "connected",
              database: "todoapp",
              schema: "public",
              profile: {
                id: "conn-1",
                name: "todoapp",
                db_type: DbType.PostgreSQL,
                host: "localhost",
                port: 5432,
                database: "todoapp",
                username: "postgres",
                options: {},
              },
            },
          ],
        ]),
        config: {
          id: "workspace-1",
          name: "Workspace",
          connectionIds: ["conn-1"],
          connectionStates: {
            "conn-1": {
              database: "todoapp",
              schema: "public",
            },
          },
          createdAt: "2026-03-08T00:00:00.000Z",
          updatedAt: "2026-03-08T00:00:00.000Z",
        },
      },
      reconnectDisconnectedConnections: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("refreshes sidebar data and retries disconnected connections", async () => {
    const user = userEvent.setup();

    render(<SidebarConnectionList />);

    await user.click(screen.getByRole("button", { name: "Refresh All" }));

    await waitFor(() => {
      expect(refreshConnectionDataMock).toHaveBeenCalledTimes(1);
    });
    expect(refreshConnectionDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conn-1",
      }),
    );
    expect(
      useWorkspaceBundleStore.getState().reconnectDisconnectedConnections,
    ).toHaveBeenCalledTimes(1);
  });
});
