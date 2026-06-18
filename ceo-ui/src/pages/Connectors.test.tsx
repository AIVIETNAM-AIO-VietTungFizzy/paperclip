// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connectors } from "./Connectors";

const mockConnectorsApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  testEndpoint: vi.fn(),
}));

vi.mock("../api/connectors", () => ({
  connectorsApi: mockConnectorsApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    pushToast: vi.fn(),
  }),
  useToastActions: () => ({
    pushToast: vi.fn(),
  }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("Connectors", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockConnectorsApi.list.mockResolvedValue([]);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the page title", async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <Connectors />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Connectors");
    expect(container.textContent).toContain("New Connector");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows empty state when no connectors exist", async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <Connectors />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("No connectors yet");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders connector list when data is available", async () => {
    mockConnectorsApi.list.mockResolvedValue([
      { id: "1", connectorKey: "deerflow", connectorName: "DeerFlow", description: null, endpointUrl: null, hostingMode: "remote", authType: null, credentialSchema: [], allowedPackages: [], status: "active", createdAt: "2024-01-01", updatedAt: "2024-01-01" },
      { id: "2", connectorKey: "microfish", connectorName: "MicroFish", description: null, endpointUrl: null, hostingMode: "remote", authType: null, credentialSchema: [], allowedPackages: [], status: "active", createdAt: "2024-01-01", updatedAt: "2024-01-01" },
    ]);

    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <Connectors />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("DeerFlow");
    expect(container.textContent).toContain("MicroFish");
    expect(container.textContent).toContain("deerflow");
    expect(container.textContent).toContain("microfish");

    await act(async () => {
      root.unmount();
    });
  });
});
