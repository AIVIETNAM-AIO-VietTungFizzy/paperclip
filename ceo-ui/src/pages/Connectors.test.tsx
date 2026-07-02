// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connectors } from "./Connectors";
import type { Connector } from "../api/connectors";

const mockConnectorsApi = vi.hoisted(() => ({
  list: vi.fn(),
  listForCompany: vi.fn(),
  sync: vi.fn(),
  setToolEnabled: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/connectors", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("../api/connectors", () => ({
  connectorsApi: mockConnectorsApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "c1",
    connectorKey: "deerflow",
    connectorName: "DeerFlow",
    description: null,
    endpointUrl: "http://localhost:9999/mcp",
    hostingMode: "remote",
    authType: null,
    credentialSchema: [],
    allowedPackages: [],
    capabilities: { tools: [{ name: "research" }, { name: "send_message" }] },
    status: "active",
    lastTestedAt: "2026-06-25T00:00:00Z",
    lastError: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-25T00:00:00Z",
    ...overrides,
  };
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("Connectors", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockConnectorsApi.list.mockResolvedValue([makeConnector()]);
    mockConnectorsApi.listForCompany.mockResolvedValue([
      {
        ...makeConnector(),
        enabled: true,
        tenantConnector: { id: "tc1", tenantId: "company-1", connectorId: "c1", status: "enabled", namespace: "deerflow" },
        tools: [
          { id: "r1", tenantConnectorId: "tc1", toolName: "research", namespacedName: "deerflow__research", description: null, enabled: true, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
          { id: "r2", tenantConnectorId: "tc1", toolName: "send_message", namespacedName: "deerflow__send_message", description: null, enabled: false, pending: true, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
        ],
      } as any,
    ]);
    mockConnectorsApi.sync.mockResolvedValue({ ok: true, added: [], removed: [], tools: [] });
    mockConnectorsApi.setToolEnabled.mockResolvedValue({ ok: true, tool: { id: "t1", enabled: true } });
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders pending tools in an amber awaiting-approval banner with an Approve button", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Connectors />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const expandBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /tools/i.test(b.textContent ?? ""),
    );
    expect(expandBtn).toBeDefined();
    await act(async () => { expandBtn!.click(); });
    await flushReact();

    expect(container.textContent).toContain("awaiting approval");
    expect(container.textContent).toContain("send_message");
    const approveBtns = Array.from(container.querySelectorAll("button")).filter((b) =>
      /approve/i.test(b.textContent ?? ""),
    );
    expect(approveBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("calls setToolEnabled with enabled:true when the Approve button is clicked", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Connectors />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const expandBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /tools/i.test(b.textContent ?? ""),
    );
    await act(async () => { expandBtn!.click(); });
    await flushReact();

    const approveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /approve/i.test(b.textContent ?? ""),
    );
    expect(approveBtn).toBeDefined();

    await act(async () => {
      approveBtn!.click();
    });
    await flushReact();

    expect(mockConnectorsApi.setToolEnabled).toHaveBeenCalledWith(
      "company-1",
      "c1",
      "send_message",
      true,
    );
  });

  it("renders an enable toggle for approved tools that persists via setToolEnabled", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Connectors />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const expandBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /tools/i.test(b.textContent ?? ""),
    );
    await act(async () => { expandBtn!.click(); });
    await flushReact();

    const toggles = container.querySelectorAll('input[type="checkbox"]');
    expect(toggles.length).toBeGreaterThanOrEqual(1);

    const researchToggle = Array.from(toggles).find((t) =>
      (t.closest("[data-tool-name]")?.getAttribute("data-tool-name") === "research"),
    ) as HTMLInputElement | undefined;
    expect(researchToggle).toBeDefined();

    await act(async () => {
      researchToggle!.click();
    });
    await flushReact();

    expect(mockConnectorsApi.setToolEnabled).toHaveBeenCalledWith(
      "company-1",
      "c1",
      "research",
      expect.any(Boolean),
    );
  });
});