import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionForm } from "../ConnectionForm";

const clipboardMock = vi.hoisted(() => ({
  readText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: clipboardMock.readText,
}));

describe("ConnectionForm", () => {
  beforeEach(() => {
    clipboardMock.readText.mockReset();
    localStorage.clear();
  });

  it("keeps the parsed SQL Server port when pasting a config string", async () => {
    clipboardMock.readText.mockResolvedValue(
      "Server=localhost,11435;Database=todoapp;User Id=sa;Password=DevPass123;",
    );

    render(<ConnectionForm />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /paste config/i }));

    const portInput = screen.getByLabelText("Port");
    await waitFor(() => {
      expect(portInput).toHaveValue("11435");
    });
    expect(screen.queryByLabelText("SSL Key File")).not.toBeInTheDocument();
  });

  it("hydrates SSL key/cert/ca fields from pasted env config", async () => {
    clipboardMock.readText.mockResolvedValue(
      `DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=secret
DB_NAME=app
SSL_MODE=require
SSL_KEY_FILE=/tmp/client.key
SSL_CERT_FILE=/tmp/client.crt
SSL_CA_FILE=/tmp/ca.pem`,
    );

    render(<ConnectionForm />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /paste config/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("SSL Key File")).toHaveValue(
        "/tmp/client.key",
      );
      expect(screen.getByLabelText("SSL Cert File")).toHaveValue(
        "/tmp/client.crt",
      );
      expect(screen.getByLabelText("SSL CA File")).toHaveValue("/tmp/ca.pem");
    });
  });

  it("hydrates SSL key/cert/ca fields from pasted URI query params", async () => {
    clipboardMock.readText.mockResolvedValue(
      "postgresql://postgres:secret@localhost:5432/app?sslmode=require&sslkey=/tmp/client.key&sslcert=/tmp/client.crt&sslrootcert=/tmp/ca.pem",
    );

    render(<ConnectionForm />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /paste config/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("SSL Key File")).toHaveValue(
        "/tmp/client.key",
      );
      expect(screen.getByLabelText("SSL Cert File")).toHaveValue(
        "/tmp/client.crt",
      );
      expect(screen.getByLabelText("SSL CA File")).toHaveValue("/tmp/ca.pem");
    });
  });

  it("shows the full PostgreSQL SSL mode list", async () => {
    render(<ConnectionForm />);

    expect(await screen.findByText("Disable")).toBeInTheDocument();
    expect(await screen.findByText("Allow")).toBeInTheDocument();
    expect(await screen.findByText("Prefer")).toBeInTheDocument();
    expect(await screen.findByText("Require")).toBeInTheDocument();
    expect(await screen.findByText("Verify CA")).toBeInTheDocument();
    expect(await screen.findByText("Verify Full")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Browse SSL key file" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Browse SSL cert file" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Browse SSL CA cert file" }),
    ).toBeInTheDocument();
  });
});
