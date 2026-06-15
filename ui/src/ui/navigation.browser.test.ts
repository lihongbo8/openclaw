import { describe, expect, it, vi } from "vitest";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function expectElement<T extends Element>(
  root: Element,
  selector: string,
  constructor: new () => T,
): T {
  const element = root.querySelector<T>(selector);
  expect(element).toBeInstanceOf(constructor);
  if (!(element instanceof constructor)) {
    throw new Error(`Expected ${selector} to match ${constructor.name}`);
  }
  return element;
}

function expectButtonWithText(app: ReturnType<typeof mountApp>, text: string): HTMLButtonElement {
  const button = Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button with text "${text}"`);
  }
  return button;
}

function expectButtonContainingText(
  app: ReturnType<typeof mountApp>,
  text: string,
): HTMLButtonElement {
  const button = Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button containing text "${text}"`);
  }
  return button;
}

function createSessionsResult(sessions: Array<Record<string, unknown>>) {
  return {
    ts: 0,
    path: "",
    count: sessions.length,
    defaults: { modelProvider: "openai", model: "gpt-5.5", contextTokens: null },
    sessions: sessions.map((session) => ({
      kind: "direct",
      updatedAt: Date.now(),
      ...session,
    })),
  };
}

function createToolSupplyReadModel(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: Date.now(),
    authority: "openclaw_local",
    metrics: {
      total: 2,
      localTools: 1,
      pluginTools: 0,
      skills: 1,
      apiConnections: 0,
      cloudCapabilities: 0,
      available: 2,
      blocked: 0,
      disabled: 0,
      pendingReview: 0,
      risks: 0,
    },
    localTools: [
      {
        id: "core:read",
        label: "read",
        kind: "core_tool",
        source: "openclaw",
        status: "available",
        risk: "low",
        blockedReasons: [],
      },
    ],
    skills: [
      {
        id: "skill:browser-automation",
        label: "browser-automation",
        kind: "skill",
        source: "skill",
        status: "available",
        risk: "low",
        blockedReasons: [],
        skillKey: "browser-automation",
        configBindings: ["skills.entries.browser-automation.apiKey"],
      },
    ],
    apiBindings: [],
    cloudCapabilities: [],
    risks: [],
    grants: [],
    uniqueCapabilityRequests: [],
    ...overrides,
  };
}

async function confirmPendingGatewayChange(app: ReturnType<typeof mountApp>) {
  const confirmButton = expectButtonWithText(app, "Confirm");
  confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await app.updateComplete;
}

function expectConfirmedGatewayChange(app: ReturnType<typeof mountApp>) {
  expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/openclaw");
  expect(app.settings.token).toBe("abc123");
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("");
}

function fillAicsRoleBuilderRequiredFields(
  app: ReturnType<typeof mountApp>,
  overrides: Record<string, string> = {},
) {
  const fields = {
    requestZh: "生成一个客服质检岗位包",
    roleBuildBriefJson: JSON.stringify({
      name: "客服质检岗位",
      deliverables: ["role_package/manifest.json"],
    }),
    cloudAccessToken: "cloud_customer_token",
    executionId: "exec_123",
    executionToken: "token_123",
    roleListingId: "role_123",
    entitlementId: "ent_123",
    deviceId: "device_123",
    workspaceRef: "workspace_123",
    localGatewayId: "gateway_123",
    ...overrides,
  };
  for (const [field, value] of Object.entries(fields)) {
    app.updateAicsRoleBuilderField(field as never, value);
  }
}

describe("control UI routing", () => {
  it("renders responsive navigation shell, drawer, and collapsed states", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    expectElement(app, 'a.nav-item[href="/dreaming"]', HTMLAnchorElement);
  });

  it("renders the dashboard breadcrumb as a main chat home link", async () => {
    const app = mountApp("/channels");
    await app.updateComplete;

    const breadcrumb = expectElement(
      app,
      "dashboard-header .dashboard-header__breadcrumb-link",
      HTMLAnchorElement,
    );
    expect(breadcrumb.getAttribute("href")).toBe("/chat");

    breadcrumb.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
  });

  it("keeps AICS from rendering a second role-builder conversation form", async () => {
    const app = mountApp("/aics");
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("岗位执行");
    expect(text).not.toContain("中文需求");
    expect(text).not.toContain("RoleBuildBrief JSON");
    expect(
      Array.from(app.querySelectorAll<HTMLButtonElement>("button")).some(
        (candidate) => candidate.textContent?.trim() === "启动生成",
      ),
    ).toBe(false);
  });

  it("auto-syncs the tool and skill control page when opened directly", async () => {
    const app = mountApp("/skills");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel();
      }
      return {};
    });
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("工具供给与管控中心");
    expect(text).toContain("能力接入操作台");
    expect(text).toContain("read");
    expect(text).toContain("browser-automation");
    expect(text).toContain("添加工具");
    expect(text).toContain("添加 Skill");
    expect(text).not.toContain("尚未读取 OpenClaw 工具与 Skill");
    const buttonLabels = Array.from(app.querySelectorAll<HTMLButtonElement>("button")).map(
      (button) => button.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(buttonLabels).toEqual(
      expect.arrayContaining([
        "新增工具供给",
        "添加工具 API",
        "搜索 Skill",
        "重新评估",
        "处理阻塞",
      ]),
    );
    expect(buttonLabels).not.toContain("同步 OpenClaw");
    expect(buttonLabels).not.toContain("同步云端商城");
    expect(buttonLabels).not.toContain("API 管理");
  });

  it("wires tool and skill control actions to real supply workflows", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel();
      }
      if (method === "skills.search") {
        return {
          results: [
            {
              slug: "browser",
              displayName: "Browser Skill",
              summary: "Browser automation for OpenClaw",
              version: "1.0.0",
            },
          ],
        };
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    expectButtonWithText(app, "新增工具供给").click();
    await app.updateComplete;
    expect(app.tab).toBe("apiManagement");
    expect(app.apiConnections.form.kind).toBe("tool_skill");
    expect(app.apiConnections.form.templateId).toBe("tool-skill-api");
    expect(app.apiConnections.form.name).toBe("工具 / Skill API");

    app.setTab("skills");
    await app.updateComplete;
    await vi.waitFor(() => expectButtonWithText(app, "重新评估"));
    const readModelCallsBeforeEvaluate = request.mock.calls.filter(
      ([method]) => method === "aics.toolSupply.readModel.get",
    ).length;
    expectButtonWithText(app, "重新评估").click();
    await vi.waitFor(() =>
      expect(
        request.mock.calls.filter(([method]) => method === "aics.toolSupply.readModel.get").length,
      ).toBeGreaterThan(readModelCallsBeforeEvaluate),
    );

    const input = expectElement(
      app,
      'input[placeholder="搜索 Skill，例如 search、browser、image"]',
      HTMLInputElement,
    );
    input.value = "browser";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: "browser" }),
    );
    await app.updateComplete;
    expectButtonWithText(app, "搜索 Skill").click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("skills.search", { query: "browser", limit: 8 }),
    );
    await app.updateComplete;
    expect(app.textContent ?? "").toContain("Browser Skill");
    expectButtonWithText(app, "安装");
  });

  it("keeps tool and skill entry actions clickable before gateway data is connected", async () => {
    const app = mountApp("/skills");
    app.connected = true;
    app.client = null;
    await app.updateComplete;

    const addSupply = expectButtonWithText(app, "新增工具供给");
    const addToolApi = expectButtonWithText(app, "添加工具 API");
    expect(addSupply.disabled).toBe(false);
    expect(addToolApi.disabled).toBe(false);

    addSupply.click();
    await app.updateComplete;
    expect(app.tab).toBe("apiManagement");
    expect(app.apiConnections.form.templateId).toBe("tool-skill-api");

    app.setTab("skills");
    await app.updateComplete;
    const input = expectElement(
      app,
      'input[placeholder="搜索 Skill，例如 search、browser、image"]',
      HTMLInputElement,
    );
    input.value = "browser";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: "browser" }),
    );
    await app.updateComplete;
    const searchButton = expectButtonWithText(app, "搜索 Skill");
    expect(searchButton.disabled).toBe(false);
    searchButton.click();
    await app.updateComplete;
    expect(app.textContent ?? "").toContain("Gateway 未连接，暂时不能搜索 Skill。");
  });

  it("creates and deletes a tool and skill API connection from the UI", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.apiConnections.entry.delete") {
        return { readModel: { entries: [] } };
      }
      return {};
    });
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "tool-skill-api");
    app.updateApiConnectionFormField("secretValue", "sk-test-tool-skill");
    await app.updateComplete;

    expect(app.apiConnections.form.kind).toBe("tool_skill");
    expect(app.apiConnections.form.templateId).toBe("tool-skill-api");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "工具 / Skill API",
          kind: "tool_skill",
          provider: "tool-skill",
          secret: "sk-test-tool-skill",
          consumers: ["tool", "skill"],
        }),
      ),
    );
    await app.updateComplete;
    expect(app.textContent ?? "").toContain("连接已保存");
    expect(app.textContent ?? "").toContain("工具 / Skill API");

    expectButtonWithText(app, "删除").click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.delete", {
        id: "tool_skill-tool-skill",
      }),
    );
    await app.updateComplete;
    expect(app.textContent ?? "").toContain("连接记录已删除");
  });

  it("stores cloud smoke output as Dijie bridge metadata from API management", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "cloud-marketplace");
    app.updateApiConnectionFormField("baseUrl", "http://127.0.0.1:9000");
    app.updateApiConnectionFormField("secretValue", "cloud-token");
    app.updateApiConnectionFormField(
      "smokeJson",
      JSON.stringify({
        roleListingId: "djrole_marketplace_ops",
        entitlementId: "djent_marketplace_ops",
        deviceId: "local-admin-device",
        workspaceRef: "local-admin-workspace",
        localGatewayId: "openclaw-local-gateway",
      }),
    );
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "云端商城 API",
          kind: "marketplace",
          provider: "cloud-marketplace",
          baseUrl: "http://127.0.0.1:9000",
          metadata: {
            dijie: {
              roleListingId: "djrole_marketplace_ops",
              entitlementId: "djent_marketplace_ops",
              deviceId: "local-admin-device",
              workspaceRef: "local-admin-workspace",
              localGatewayId: "openclaw-local-gateway",
            },
          },
        }),
      ),
    );
  });

  it("stores nested Dijie cloud bridge smoke output from API management", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "dijie-cloud-bridge");
    app.updateApiConnectionFormField("baseUrl", "https://api.dijie.ai");
    app.updateApiConnectionFormField("secretValue", "cloud-token");
    app.updateApiConnectionFormField(
      "smokeJson",
      JSON.stringify({
        ok: true,
        result: {
          metadata: {
            dijie: {
              roleListingId: "djrole_nested_ops",
              deviceId: "nested-device",
            },
          },
          authorization: {
            entitlementId: "djent_nested_ops",
          },
          bridge: {
            workspaceRef: "nested-workspace",
            localGatewayId: "nested-gateway",
          },
        },
      }),
    );
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "迭界岗位商城云端桥",
          kind: "marketplace",
          provider: "dijie-cloud-bridge",
          baseUrl: "https://api.dijie.ai",
          metadata: {
            dijie: {
              roleListingId: "djrole_nested_ops",
              entitlementId: "djent_nested_ops",
              deviceId: "nested-device",
              workspaceRef: "nested-workspace",
              localGatewayId: "nested-gateway",
            },
          },
        }),
      ),
    );
  });

  it("edits Dijie cloud bridge entries with the bridge template selected", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        entries: [
          {
            id: "marketplace-dijie-cloud-bridge",
            name: "迭界岗位商城云端桥",
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            baseUrl: "https://api.dijie.ai",
            consumers: ["marketplace", "dispatch"],
            secret: {
              mode: "secret_ref",
              source: "env",
              provider: "default",
              id: "DIJIE_CLOUD_ACCESS_TOKEN",
            },
            metadata: {
              dijie: {
                roleListingId: "djrole_edit",
                entitlementId: "djent_edit",
              },
            },
          },
        ],
      },
    };

    app.editApiConnectionEntry("marketplace-dijie-cloud-bridge");

    expect(app.apiConnections.form.templateId).toBe("dijie-cloud-bridge");
    expect(app.apiConnections.form.provider).toBe("dijie-cloud-bridge");
    expect(app.apiConnections.form.smokeJson).toContain("djrole_edit");
  });

  it("treats API connection save during gateway restart as submitted", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.apiConnections.entry.create") {
        throw new Error("gateway closed (1012): service restart");
      }
      return {};
    });
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "tool-skill-api");
    app.updateApiConnectionFormField("secretValue", "sk-test-tool-skill");
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({ provider: "tool-skill" }),
      ),
    );
    await app.updateComplete;

    expect(app.apiConnections.error).toBeNull();
    expect(app.apiConnections.saving).toBe(false);
    expect(app.textContent ?? "").toContain("连接已保存，Gateway 正在重启");
    expect(app.textContent ?? "").not.toContain("gateway closed (1012)");
    expect(app.textContent ?? "").toContain("工具 / Skill API");
  });

  it("shows a retry state when the direct tool and skill sync fails", async () => {
    const app = mountApp("/skills");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        throw new Error("tool supply offline");
      }
      return {};
    });
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();

    await vi.waitFor(() => expect(app.toolSupplyControl.error).toBe("tool supply offline"));
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("tool supply offline");
    expect(text).toContain("重试读取");
    expect(text).toContain("尚未读取 OpenClaw 工具与 Skill");
  });

  it("keeps AICS customer-facing copy in Chinese without internal platform names", async () => {
    const app = mountApp("/aics");
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("岗位执行");
    expect(text).not.toContain("主对话工作台");
    expect(text).not.toContain("主对话是第一入口");
    expect(text).not.toContain("调度层是中枢");
    expect(text).not.toContain("真实任务队列");
    expect(text).not.toContain("岗位工作台");
    expect(text).not.toContain("用自然语言安排任务");
    expect(text).not.toContain("从这里");
    expect(text).not.toContain("对话和岗位任务的消耗会在这里汇总");
    for (const hiddenWord of [
      "OpenClaw",
      "Mercur",
      "Medusa",
      "API Bridge",
      "Gateway",
      "runtime",
      "授权与审计状态",
      "云端授权凭证",
      "执行授权凭证",
      "roleListingId",
      "role_quality_agent",
      "cloud access token",
      "cloud_customer_token",
      "execution token",
      "token_123",
      "dijie.marketplace.roles.list",
      "RoleBuildBrief",
    ]) {
      expect(text).not.toContain(hiddenWord);
    }
  });

  it("syncs installed marketplace roles through Gateway without rendering fake cards", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      roles: [
        {
          entitlementId: "ordgrp_001",
          orderId: "order_001",
          authorizedAt: "2026-05-31T00:00:00.000Z",
          role: {
            id: "role_quality_agent",
            title: "客服质检岗位",
            description: "检查客服对话质量",
            listingStatus: "published",
          },
        },
      ],
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;

    expect(app.aicsMarketplace.roles).toEqual([]);
    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", {
      cloud_access_token: "cloud_customer_token",
      workspace_ref: "workspace_123",
      device_id: "device_123",
    });
    expect(app.aicsMarketplace.error).toBeNull();
    expect(app.aicsMarketplace.roles).toEqual([
      {
        id: "role_quality_agent",
        title: "客服质检岗位",
        detail: "检查客服对话质量",
        status: "published",
        roleListingId: "role_quality_agent",
        entitlementId: "ordgrp_001",
      },
    ]);
    expect(JSON.stringify(app.aicsMarketplace.result)).not.toContain("cloud_customer_token");
  });

  it("syncs installed marketplace roles through the Gateway backend account when no token is visible", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      roles: [
        {
          entitlementId: "djent_role_marketplace_designer",
          role: {
            id: "djrole_role_marketplace_designer",
            title: "岗位商城电商美工岗位",
            description: "检查首批岗位商品页主图、详情结构和视觉转化卖点。",
            listingStatus: "published",
          },
        },
      ],
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { cloudAccessToken: "" });
    await app.updateComplete;

    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", {
      workspace_ref: "workspace_123",
      device_id: "device_123",
    });
    expect(app.aicsMarketplace.error).toBeNull();
    expect(app.aicsMarketplace.roles).toEqual([
      {
        id: "djrole_role_marketplace_designer",
        title: "岗位商城电商美工岗位",
        detail: "检查首批岗位商品页主图、详情结构和视觉转化卖点。",
        status: "published",
        roleListingId: "djrole_role_marketplace_designer",
        entitlementId: "djent_role_marketplace_designer",
      },
    ]);
    expect(app.aicsMarketplace.roles[0]?.title).toBe("岗位商城电商美工岗位");
  });

  it("syncs installed marketplace roles from gateway read-model shaped responses", async () => {
    const app = mountApp("/workboard");
    const request = vi.fn(async () => ({
      ok: true,
      readModel: {
        roles: [
          {
            roleListingId: "djrole_role_marketplace_designer",
            title: "岗位商城电商美工岗位",
            subtitle: "检查首批岗位商品页主图、详情结构和视觉转化卖点。",
            callable: true,
            reviewSignal: { listingStatus: "published", reviewState: "approved" },
            packageContext: {
              requiredCapabilities: ["image.inspect"],
              catalogBindings: [
                {
                  need: "image.generate",
                  catalogRef: "api.opencloud.image_generation",
                  kind: "api",
                },
              ],
            },
            entitlement: {
              id: "djent_role_marketplace_designer",
              status: "authorized",
              source: "checkout",
              authorizedAt: "2026-06-08T00:00:00.000Z",
            },
          },
        ],
      },
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { cloudAccessToken: "" });
    await app.updateComplete;

    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(app.aicsMarketplace.error).toBeNull();
    expect(app.aicsMarketplace.roles).toEqual([
      {
        id: "djrole_role_marketplace_designer",
        title: "岗位商城电商美工岗位",
        detail: "检查首批岗位商品页主图、详情结构和视觉转化卖点。",
        status: "published",
        roleListingId: "djrole_role_marketplace_designer",
        entitlementId: "djent_role_marketplace_designer",
        catalogRefs: ["image.inspect", "api.opencloud.image_generation"],
        callable: true,
        requiredCapabilities: ["image.inspect"],
      },
    ]);
    expect(app.aicsMarketplace.roles[0]?.title).toBe("岗位商城电商美工岗位");
    expect(JSON.stringify(app.aicsMarketplace.result)).not.toContain("云端授权凭证");
  });

  it("keeps project boards from directly calling the role task gateway", async () => {
    const app = mountApp("/projects");
    app.connected = true;
    const request = vi.fn(async () => ({ ok: true }));
    app.client = { request, stop: vi.fn() } as never;
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("项目看板");
    expect(text).toContain("项目看板不能直接创建岗位任务");
    expect(text).not.toContain("执行岗位");
    expect(text).not.toContain("派任务");
    expect(request).not.toHaveBeenCalledWith("dijie.roleTask.run", expect.anything());
    expect(request).not.toHaveBeenCalledWith("workboard.cards.create", expect.anything());
  });

  it("does not show cloud authorization as synced before marketplace sync runs", async () => {
    const app = mountApp("/workboard");
    app.connected = true;
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("任务调度");
    expect(text).toContain("岗位任务包");
    expect(text).not.toContain("云端授权已同步");
  });

  it("renders API management as a real OpenClaw management page", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        metrics: { configured: 1, available: 0, risky: 1, unbound: 0, blocked: 1 },
        groups: {
          model: [
            {
              id: "model-openai",
              name: "OpenAI 模型 API",
              provider: "openai",
              baseUrl: "https://api.openai.test/v1",
              status: "blocked",
              riskStatus: "blocked",
              secret: {
                mode: "secret_ref",
                source: "env",
                provider: "default",
                id: "OPENAI_API_KEY",
                status: "unresolved",
              },
              consumers: ["model"],
              configBindings: [{ path: "models.providers.openai.apiKey" }],
            },
          ],
          tool_skill: [],
          marketplace: [],
          dialog: [],
        },
        riskReport: {
          items: [
            {
              entryId: "model-openai",
              code: "unresolved_secret_ref",
              severity: "blocking",
              message: "SecretRef 当前无法解析。",
            },
          ],
        },
      },
    };
    app.connected = true;
    await app.updateComplete;

    expect(app.tab).toBe("apiManagement");
    const pageText = app.textContent ?? app.shadowRoot?.textContent ?? "";
    expect(pageText).toContain("API 供给中心");
    expect(pageText).toContain("统一供给 API");
    expect(pageText).toContain("系统使用总览");
    expect(pageText).toContain("推荐连接");
    expect(pageText).toContain("连接服务");
    expect(pageText).toContain("云端商城");
    expect(pageText).toContain("本地服务");
    expect(pageText).toContain("多模型适配");
    expect(pageText).toContain("已连接服务");
    expect(pageText).toContain("风险与阻塞");
    expect(pageText).toContain("OPENAI_API_KEY");
    expect(pageText).toContain("DeepSeek");
    expect(pageText).toContain("阿里百炼 / 通义千问");
    expect(pageText).toContain("直接输入 API Key");
    expect(pageText).toContain("测试");
    expect(pageText).toContain("编辑");
    expect(pageText).toContain("删除");
    expect(pageText).not.toContain("工具与 Skill 使用");
    expect(pageText).not.toContain("岗位使用");
    expect(pageText).not.toContain("工具 / Skill API");
    expect(pageText).not.toContain("图片生成 Provider");
    expect(pageText).not.toContain("视频生成 Provider");
    expect(pageText).not.toContain("费用计算");
    expect(pageText).not.toContain("Token 花费");
    expect(pageText).not.toContain("账单");
    expect(pageText).not.toContain("岗位价格");
    expect(pageText).not.toContain("方法与 Scope");
    expect(pageText).not.toContain("调用摘要");
  });

  it("uses a marketplace role by jumping into the existing main chat draft", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      roles: [
        {
          id: "role_quality_agent",
          title: "客服质检岗位",
          description: "检查客服对话质量",
          status: "installed",
        },
      ],
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;

    app.useAicsMarketplaceRole(app.aicsMarketplace.roles[0]);
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
    expect(app.chatMessage).toContain("客服质检岗位");
    expect(app.chatMessage).not.toContain("role_quality_agent");
    expect(app.chatMessage).not.toContain("cloud_customer_token");
    expect(app.chatMessage).not.toContain("token_123");
    expect(app.chatMessage).not.toContain("dijie");
    expect(app.chatMessage).not.toContain("Gateway");
    expect(app.chatMessage).not.toContain("execution");
    expect(app.chatMessages).toEqual([]);
    expect(app.aicsRoleBuilder.form.roleListingId).toBe("role_quality_agent");
  });

  it("keeps developer mode in main chat without rendering platform internals", async () => {
    const app = mountApp("/aics");
    await app.updateComplete;

    const aicsButtons = Array.from(app.querySelectorAll<HTMLButtonElement>("button"));
    expect(aicsButtons.some((candidate) => candidate.textContent?.trim() === "开发岗位")).toBe(
      false,
    );

    app.setTab("chat");
    await app.updateComplete;

    expectButtonContainingText(app, "开发者模式").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
    expect(app.aicsConversationMode).toBe("developer");
    expect(app.aicsConversationStage).toBe("idle");
    expect(app.aicsConversationProtocol).toMatchObject({
      role: "developerAssistant",
      roleLabel: "岗位开发专属助手",
      stage: "idle",
      stageLabel: "等待业务逻辑",
    });
    expect(app.chatMessage).toBe("");
    const text = app.textContent ?? "";
    expect(text).toContain("开发者模式");
    expect(text).toContain("使用者模式");
    expect(text).not.toContain("等待业务逻辑");
    expect(text).not.toContain("当前角色");
    expect(text).not.toContain("工作身份");
    expect(text).not.toContain("当前流程阶段");
    expect(text).not.toContain("岗位开发专属助手");
    expect(text).not.toContain("岗位授权与执行助手");
    expect(text).not.toContain("你只需要讲清楚");
    expect(text).not.toContain("只讲业务逻辑");
    expect(text).not.toContain(`对话${"对象"}`);
    const modeHelp = expectElement(app, ".agent-chat__aics-mode", HTMLElement);
    expect(modeHelp.getAttribute("aria-label")).toContain("等待业务逻辑");
    expect(modeHelp.getAttribute("data-tooltip")).toBe("说清楚业务目标、使用对象和判断流程即可。");
    for (const hiddenWord of [
      "RoleBuildBrief",
      "execution token",
      "cloud bearer",
      "entitlementId",
      "roleListingId",
      "cloud_customer_token",
      "token_123",
      "输入、输出、规则",
      "岗位包结构",
      "协议",
      "校验",
      "上传规则",
      "后端",
      "token、key",
    ]) {
      expect(text).not.toContain(hiddenWord);
      expect(modeHelp.getAttribute("data-tooltip")).not.toContain(hiddenWord);
    }
  });

  it("keeps developer mode context out of the visible chat transcript", async () => {
    const app = mountApp("/chat");
    const request = vi.fn(async () => ({ runId: "run_1", status: "ok" }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    await app.updateComplete;

    expectButtonContainingText(app, "开发者模式").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;

    app.chatMessage = "我想做一个发票审核岗位，按金额和供应商风险分流。";
    await app.handleSendChat();
    await app.updateComplete;

    expect(app.aicsConversationStage).toBe("intake");
    expect(app.aicsConversationProtocol).toMatchObject({
      roleLabel: "岗位开发专属助手",
      stage: "intake",
      stageLabel: "收集业务逻辑",
    });
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "我想做一个发票审核岗位，按金额和供应商风险分流。",
        aicsContext: {
          mode: "developer",
          stage: "intake",
        },
      }),
    );
    const requestCalls = request.mock.calls as unknown as Array<[string, unknown?]>;
    const sentPayload = requestCalls[0]?.[1] as
      | { aicsContext?: { mode?: string; stage?: string }; message?: string; modelPrompt?: string }
      | undefined;
    expect(sentPayload?.modelPrompt).toBeUndefined();
    expect(sentPayload?.aicsContext).toEqual({ mode: "developer", stage: "intake" });
    expect(JSON.stringify(sentPayload)).not.toContain("[迭界AI开发者模式]");
    expect(JSON.stringify(sentPayload)).not.toContain("package_only");
    expect(JSON.stringify(sentPayload)).not.toContain("confirm_brief");
    expect(sentPayload?.message).not.toContain("[迭界AI开发者模式]");
    const transcript = JSON.stringify(app.chatMessages);
    expect(transcript).toContain("发票审核岗位");
    expect(transcript).not.toContain("[迭界AI开发者模式]");
    expect(transcript).not.toContain("执行 token");

    expectButtonContainingText(app, "使用者模式").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;

    expect(app.aicsConversationMode).toBe("user");
    expect(app.aicsConversationStage).toBe("ready");
    expect(app.aicsConversationProtocol).toMatchObject({
      roleLabel: "岗位授权与执行助手",
      stage: "ready",
      stageLabel: "授权就绪",
    });
    app.chatMessage = "使用我的质检岗位处理今天的记录。";
    await app.handleSendChat();
    const chatSendCalls = requestCalls.filter(([method]) => method === "chat.send");
    const secondPayload = chatSendCalls[1]?.[1] as
      | { aicsContext?: unknown; message?: string; modelPrompt?: string }
      | undefined;
    expect(secondPayload?.message).toBe("使用我的质检岗位处理今天的记录。");
    expect(secondPayload?.modelPrompt).toBeUndefined();
    expect(secondPayload?.aicsContext).toBeUndefined();
  });

  it("sends marketplace role sync through the Gateway backend account when cloud auth is hidden", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: false,
      error: "backend aics.cloudAccessToken is required",
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { cloudAccessToken: "" });
    await app.updateComplete;

    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", {
      workspace_ref: "workspace_123",
      device_id: "device_123",
    });
    expect(app.aicsMarketplace.error).toBe(
      "Gateway 后端没有可用的迭界AI账号凭证，暂时不能连接云端岗位商城。",
    );
    expect(app.aicsMarketplace.roles).toEqual([]);
  });

  it("fails marketplace role sync clearly when Gateway is disconnected", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({ ok: true }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = false;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;

    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;

    expect(request).not.toHaveBeenCalled();
    expect(app.aicsMarketplace.error).toContain("本机连接未就绪");
  });

  it("does not fake marketplace role sync success when Gateway returns ok=false", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: false,
      error: "marketplace unavailable",
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;

    await app.refreshAicsMarketplaceRoles();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.marketplace.roles.list", expect.any(Object));
    expect(app.aicsMarketplace.error).toBe("岗位同步失败，请检查本机 Gateway 的迭界AI账号配置。");
    expect(app.aicsMarketplace.roles).toEqual([]);
  });

  it("submits the AICS role-builder handler through the Gateway RPC", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      summary: "done",
      executionId: "exec_role_builder_123",
      executionEngine: "openclaw-native",
      changedFiles: ["role_package/manifest.json"],
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;

    await app.runAicsRoleBuilder();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith(
      "dijie.roleBuilder.run",
      expect.objectContaining({
        request_zh: "生成一个客服质检岗位包",
        confirm_brief: true,
        role_build_brief_json: expect.stringContaining("客服质检岗位"),
        execution_token: "token_123",
        role_listing_id: "role_123",
        entitlement_id: "ent_123",
        device_id: "device_123",
        workspace_ref: "workspace_123",
        local_gateway_id: "gateway_123",
        timeout_ms: 120000,
      }),
    );
    expect(app.aicsRoleBuilder.error).toBeNull();
    expect(app.aicsRoleBuilder.result).toMatchObject({
      ok: true,
      executionEngine: "openclaw-native",
    });
    expect(app.aicsRoleBuilder.form.executionId).toBe("exec_role_builder_123");
  });

  it("fails the AICS role-builder form before RPC when the execution token is missing", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({ ok: true }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { executionToken: "" });
    await app.updateComplete;

    await app.runAicsRoleBuilder();
    await app.updateComplete;

    expect(request).not.toHaveBeenCalled();
    expect(app.aicsRoleBuilder.error).toContain("执行授权凭证不能为空");
  });

  it("requests an AICS execution token through the Gateway RPC and fills the form", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      summary: "issued",
      grant: {
        executionId: "exec_123",
        token: "short_lived_execution_token",
      },
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, {
      cloudAccessToken: "cloud_customer_token",
      executionId: "",
      executionToken: "",
    });
    await app.updateComplete;
    await app.requestAicsExecutionToken();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.executionToken.request", {
      cloud_access_token: "cloud_customer_token",
      role_listing_id: "role_123",
      entitlement_id: "ent_123",
      device_id: "device_123",
      workspace_ref: "workspace_123",
      local_gateway_id: "gateway_123",
    });
    expect(app.aicsRoleBuilder.form.executionToken).toBe("short_lived_execution_token");
    expect(app.aicsRoleBuilder.form.executionId).toBe("exec_123");
    expect(app.aicsRoleBuilder.error).toBeNull();
    expect(JSON.stringify(app.aicsRoleBuilder.result)).not.toContain("cloud_customer_token");
  });

  it("requests an AICS execution token through the Gateway backend account when cloud auth is hidden", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      summary: "issued",
      grant: {
        executionId: "exec_backend_123",
        token: "backend_short_lived_execution_token",
      },
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, {
      cloudAccessToken: "",
      executionToken: "",
    });
    await app.updateComplete;
    await app.requestAicsExecutionToken();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.executionToken.request", {
      role_listing_id: "role_123",
      entitlement_id: "ent_123",
      device_id: "device_123",
      workspace_ref: "workspace_123",
      local_gateway_id: "gateway_123",
    });
    expect(app.aicsRoleBuilder.form.executionToken).toBe("backend_short_lived_execution_token");
    expect(app.aicsRoleBuilder.form.executionId).toBe("exec_backend_123");
    expect(app.aicsRoleBuilder.error).toBeNull();
  });

  it("reads an AICS execution audit through Gateway without storing the cloud bearer in result", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      summary: "read",
      execution: {
        executionId: "exec_123",
        status: "completed",
        note: "cloud_customer_token should be redacted if returned",
      },
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;
    await app.readAicsExecutionAudit();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.executionAudit.read", {
      cloud_access_token: "cloud_customer_token",
      execution_id: "exec_123",
    });
    expect(app.aicsRoleBuilder.error).toBeNull();
    expect(app.aicsRoleBuilder.result).toMatchObject({
      ok: true,
      execution: {
        executionId: "exec_123",
        status: "completed",
        note: "[redacted_cloud_access_token] should be redacted if returned",
      },
    });
    expect(JSON.stringify(app.aicsRoleBuilder.result)).not.toContain("cloud_customer_token");
  });

  it("fails the AICS execution audit read before RPC when executionId is missing", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({ ok: true }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { executionId: "" });
    await app.updateComplete;
    await app.readAicsExecutionAudit();
    await app.updateComplete;

    expect(request).not.toHaveBeenCalled();
    expect(app.aicsRoleBuilder.error).toContain("执行编号不能为空");
  });

  it("reads an AICS execution audit through the Gateway backend account when cloud auth is hidden", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: true,
      execution: {
        executionId: "exec_123",
        status: "completed",
      },
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app, { cloudAccessToken: "" });
    await app.updateComplete;
    await app.readAicsExecutionAudit();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.executionAudit.read", {
      execution_id: "exec_123",
    });
    expect(app.aicsRoleBuilder.error).toBeNull();
    expect(app.aicsRoleBuilder.result).toMatchObject({
      ok: true,
      execution: {
        executionId: "exec_123",
        status: "completed",
      },
    });
  });

  it("fails the AICS execution audit read when Gateway is disconnected", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({ ok: true }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = false;
    fillAicsRoleBuilderRequiredFields(app);
    await app.readAicsExecutionAudit();
    await app.updateComplete;

    expect(request).not.toHaveBeenCalled();
    expect(app.aicsRoleBuilder.error).toContain("本机连接未就绪");
  });

  it("surfaces Gateway ok=false audit read failures without storing the cloud bearer", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: false,
      summary: "rejected",
      error: "cloud_customer_token is not authorized",
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;
    await app.readAicsExecutionAudit();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.executionAudit.read", expect.any(Object));
    expect(app.aicsRoleBuilder.error).toBe("当前迭界AI账号没有这个岗位的有效授权。");
    expect(JSON.stringify(app.aicsRoleBuilder.result)).not.toContain("cloud_customer_token");
  });

  it("surfaces Gateway ok=false executor failures in the AICS role-builder result", async () => {
    const app = mountApp("/aics");
    const request = vi.fn(async () => ({
      ok: false,
      summary: "failed",
      error:
        "No role-builder executor is configured. Configure OpenClaw-native runEmbeddedAgent or aics.localExecutorCommand before confirming a brief.",
    }));
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    fillAicsRoleBuilderRequiredFields(app);
    await app.updateComplete;

    await app.runAicsRoleBuilder();
    await app.updateComplete;
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("dijie.roleBuilder.run", expect.any(Object));
    expect(app.aicsRoleBuilder.error).toBe("迭界AI生成请求失败。");
    expect(app.aicsRoleBuilder.result).toMatchObject({ ok: false });
  });

  it("keeps the dashboard breadcrumb link inside the configured base path", async () => {
    const app = mountApp("/ui/channels");
    await app.updateComplete;

    const breadcrumb = expectElement(
      app,
      "dashboard-header .dashboard-header__breadcrumb-link",
      HTMLAnchorElement,
    );
    expect(breadcrumb.getAttribute("href")).toBe("/ui/chat");
  });

  it("renders the memory and evolution shell on the /dreaming route", async () => {
    const app = mountApp("/dreaming");
    app.dreamingStatus = {
      enabled: true,
      timezone: "Europe/Madrid",
      verboseLogging: false,
      storageMode: "inline",
      separateReports: false,
      shortTermCount: 2,
      recallSignalCount: 1,
      dailySignalCount: 1,
      groundedSignalCount: 0,
      totalSignalCount: 2,
      phaseSignalCount: 0,
      lightPhaseHitCount: 0,
      remPhaseHitCount: 0,
      promotedTotal: 1,
      promotedToday: 1,
      shortTermEntries: [],
      signalEntries: [],
      promotedEntries: [],
      phases: {
        light: { enabled: true, cron: "", managedCronPresent: false, lookbackDays: 7, limit: 20 },
        deep: {
          enabled: true,
          cron: "",
          managedCronPresent: false,
          limit: 20,
          minScore: 0.75,
          minRecallCount: 3,
          minUniqueQueries: 2,
          recencyHalfLifeDays: 7,
        },
        rem: {
          enabled: true,
          cron: "",
          managedCronPresent: false,
          lookbackDays: 7,
          limit: 20,
          minPatternStrength: 0.6,
        },
      },
    };
    app.dreamDiaryPath = "DREAMS.md";
    app.dreamDiaryContent = [
      "# Dream Diary",
      "",
      "<!-- openclaw:dreaming:diary:start -->",
      "",
      "---",
      "",
      "*January 1, 2026*",
      "",
      "What Happened",
      "1. Stable operator rule surfaced.",
      "",
      "<!-- openclaw:dreaming:diary:end -->",
    ].join("\n");
    app.requestUpdate();
    await app.updateComplete;

    expect(app.tab).toBe("dreams");
    const shell = expectElement(app, ".main-system-shell", HTMLElement);
    const text = shell.textContent ?? "";
    expect(text).toContain("记忆与进化");
    expect(text).toContain("记忆候选");
    expect(text).toContain("已确认记忆");
    expect(text).toContain("岗位优化候选");
    expect(shell.querySelector(".dreams__tab")).toBeNull();
    expect(shell.querySelector(".dreams__lobster")).toBeNull();
    expect(text).not.toContain("Dream Diary");
    expect(text).not.toContain("openclaw");
  });

  it("keeps restart controls out of the primary memory and evolution page", async () => {
    const app = mountApp("/dreaming");
    const request = vi.fn(async (method: string) => {
      if (method === "config.schema.lookup") {
        return {
          schema: {
            additionalProperties: true,
          },
          children: [{ key: "dreaming" }],
        };
      }
      if (method === "config.patch") {
        return { ok: true };
      }
      if (method === "config.get") {
        return {
          hash: "hash-2",
          config: {
            plugins: {
              slots: {
                memory: "memory-core",
              },
              entries: {
                "memory-core": {
                  config: {
                    dreaming: {
                      enabled: true,
                    },
                  },
                },
              },
            },
          },
        };
      }
      if (method === "doctor.memory.status") {
        return {
          dreaming: {
            enabled: true,
            timezone: "UTC",
            verboseLogging: false,
            storageMode: "inline",
            separateReports: false,
            shortTermCount: 0,
            recallSignalCount: 0,
            dailySignalCount: 0,
            groundedSignalCount: 0,
            totalSignalCount: 0,
            phaseSignalCount: 0,
            lightPhaseHitCount: 0,
            remPhaseHitCount: 0,
            promotedTotal: 0,
            promotedToday: 0,
            shortTermEntries: [],
            signalEntries: [],
            promotedEntries: [],
            phases: {
              light: {
                enabled: true,
                cron: "",
                managedCronPresent: false,
                lookbackDays: 7,
                limit: 20,
              },
              deep: {
                enabled: true,
                cron: "",
                managedCronPresent: false,
                limit: 20,
                minScore: 0.75,
                minRecallCount: 3,
                minUniqueQueries: 2,
                recencyHalfLifeDays: 7,
              },
              rem: {
                enabled: true,
                cron: "",
                managedCronPresent: false,
                lookbackDays: 7,
                limit: 20,
                minPatternStrength: 0.6,
              },
            },
          },
        };
      }
      return {};
    });

    app.client = {
      request,
      stop: vi.fn(),
    } as unknown as NonNullable<typeof app.client>;
    app.connected = true;
    app.configSnapshot = {
      hash: "hash-1",
      config: {
        plugins: {
          slots: {
            memory: "memory-core",
          },
          entries: {
            "memory-core": {
              config: {
                dreaming: {
                  enabled: true,
                },
              },
            },
          },
        },
      },
    };
    app.dreamingStatus = {
      enabled: true,
      timezone: "UTC",
      verboseLogging: false,
      storageMode: "inline",
      separateReports: false,
      shortTermCount: 0,
      recallSignalCount: 0,
      dailySignalCount: 0,
      groundedSignalCount: 0,
      totalSignalCount: 0,
      phaseSignalCount: 0,
      lightPhaseHitCount: 0,
      remPhaseHitCount: 0,
      promotedTotal: 0,
      promotedToday: 0,
      shortTermEntries: [],
      signalEntries: [],
      promotedEntries: [],
      phases: {
        light: { enabled: true, cron: "", managedCronPresent: false, lookbackDays: 7, limit: 20 },
        deep: {
          enabled: true,
          cron: "",
          managedCronPresent: false,
          limit: 20,
          minScore: 0.75,
          minRecallCount: 3,
          minUniqueQueries: 2,
          recencyHalfLifeDays: 7,
        },
        rem: {
          enabled: true,
          cron: "",
          managedCronPresent: false,
          lookbackDays: 7,
          limit: 20,
          minPatternStrength: 0.6,
        },
      },
    };
    app.requestUpdate();
    await app.updateComplete;

    expectElement(app, ".main-system-shell", HTMLElement);
    expect(app.querySelector(".dreams__phase-toggle--on")).toBeNull();
    expect(app.textContent).not.toContain("Confirm Restart");
    expect(request.mock.calls.some((call) => call[0] === "config.patch")).toBe(false);
  });

  it("renders the refreshed top navigation shell", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expectElement(app, ".topnav-shell", HTMLElement);
    expectElement(app, ".topnav-shell__content", HTMLElement);
    expectElement(app, ".topnav-shell__actions", HTMLElement);
    expect(app.querySelector(".topnav-shell .brand-title")).toBeNull();

    expectElement(app, ".sidebar-shell", HTMLElement);
    expectElement(app, ".sidebar-shell__header", HTMLElement);
    expectElement(app, ".sidebar-shell__body", HTMLElement);
    expectElement(app, ".sidebar-shell__footer", HTMLElement);
    expectElement(app, ".sidebar-brand", HTMLElement);
    expectElement(app, ".sidebar-brand__logo", HTMLElement);
    expectElement(app, ".sidebar-brand__copy", HTMLElement);

    app.hello = {
      ok: true,
      server: { version: "1.2.3" },
    } as never;
    app.requestUpdate();
    await app.updateComplete;

    expectElement(app, ".sidebar-version", HTMLElement);
    const statusDot = expectElement(app, ".sidebar-version__status", HTMLElement);
    expect(statusDot.getAttribute("aria-label")).toBe("Gateway status: Online");
    expect(statusDot.getAttribute("title")).toBe("Gateway status: Online");
    expect([...statusDot.classList]).toEqual([
      "sidebar-version__status",
      "sidebar-connection-status--online",
    ]);

    app.applySettings({ ...app.settings, navWidth: 360 });
    await app.updateComplete;

    expect(app.querySelector(".sidebar-resizer")).toBeNull();
    const shell = expectElement(app, ".shell", HTMLElement);
    expect(shell.style.getPropertyValue("--shell-nav-width")).toBe("");

    const split = expectElement(app, ".chat-split-container", HTMLElement);
    split.classList.add("chat-split-container--open");
    await app.updateComplete;
    expect([...split.classList]).toEqual(["chat-split-container", "chat-split-container--open"]);

    expectElement(app, ".chat-main", HTMLElement);

    const topShell = expectElement(app, ".topnav-shell", HTMLElement);
    const content = expectElement(app, ".topnav-shell__content", HTMLElement);

    expect([...topShell.classList]).toEqual(["topnav-shell"]);
    expect([...content.classList]).toEqual(["topnav-shell__content"]);
    expectElement(topShell, ".topbar-nav-toggle", HTMLElement);
    expect(topShell.children[1]).toBe(content);
    expectElement(topShell, ".topnav-shell__actions", HTMLElement);

    const toggle = expectElement(app, ".topbar-nav-toggle", HTMLElement);
    const actions = expectElement(app, ".topnav-shell__actions", HTMLElement);

    expect([...toggle.classList]).toEqual(["sidebar-menu-trigger", "topbar-nav-toggle"]);
    expect([...actions.classList]).toEqual(["topnav-shell__actions"]);
    expect(topShell.firstElementChild).toBe(toggle);
    expect(topShell.querySelector(".topbar-nav-toggle")).toBe(toggle);
    expectElement(actions, ".topbar-search", HTMLElement);
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");

    const nav = expectElement(app, ".shell-nav", HTMLElement);

    expect([...shell.classList]).toEqual(["shell", "shell--chat"]);
    toggle.click();
    await app.updateComplete;

    expect([...shell.classList]).toEqual(["shell", "shell--chat", "shell--nav-drawer-open"]);
    expect([...nav.classList]).toEqual(["shell-nav"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const link = expectElement(app, 'a.nav-item[href="/config"]', HTMLAnchorElement);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("config");
    expect([...shell.classList]).toEqual(["shell"]);

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    expect(app.querySelector(".nav-section__label")).toBeNull();
    expect(app.querySelector(".sidebar-brand__logo")).toBeNull();

    expectElement(app, ".sidebar-shell__footer", HTMLElement);
    expect(app.querySelector(".sidebar-utility-link")).toBeNull();

    const item = expectElement(app, ".sidebar .nav-item", HTMLElement);
    const header = expectElement(app, ".sidebar-shell__header", HTMLElement);
    const sidebar = expectElement(app, ".sidebar", HTMLElement);

    expect([...sidebar.classList]).toEqual(["sidebar", "sidebar--collapsed"]);
    expectElement(item, ".nav-item__icon", HTMLElement);
    expect(item.querySelector(".nav-item__text")).toBeNull();
    expect(app.querySelector(".sidebar-brand__copy")).toBeNull();
    expectElement(header, ".nav-collapse-toggle", HTMLElement);
  });

  it("shows only the final product entries in the primary sidebar", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const nav = expectElement(app, ".sidebar-nav", HTMLElement);
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a.nav-item"));
    expect(links.map((link) => link.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "迭界AI",
      "经营概览",
      "数据分析",
      "归因分析",
      "公司目标",
      "规划方案",
      "任务调度",
      "岗位执行",
      "工具与 Skill",
      "API 管理",
      "费用与授权",
      "对话记录",
      "记忆与进化",
      "Settings",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/chat",
      "/business-overview",
      "/observation",
      "/attribution",
      "/goals",
      "/company",
      "/workboard",
      "/aics",
      "/skills",
      "/api-management",
      "/usage",
      "/sessions",
      "/dreaming",
      "/config",
    ]);
    const apiManagementLink = expectElement(
      nav,
      'a.nav-item[href="/api-management"]',
      HTMLAnchorElement,
    );
    expect(apiManagementLink.target).toBe("");
    expect(apiManagementLink.rel).toBe("");
    apiManagementLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;
    expect(app.tab).toBe("apiManagement");
    expect(nav.querySelector('a.nav-item[href="/admin-console"]')).toBeNull();

    for (const legacyHref of [
      "/overview",
      "/activity",
      "/instances",
      "/cron",
      "/agents",
      "/nodes",
      "/debug",
      "/logs",
    ]) {
      expect(links.some((link) => link.getAttribute("href") === legacyHref)).toBe(false);
    }

    const settingsLink = expectElement(nav, 'a.nav-item[href="/config"]', HTMLAnchorElement);
    settingsLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    const settingsText = app.textContent ?? "";
    expect(settingsText).toContain("Context Profile");
    expect(settingsText).toContain("Appearance");
    expect(settingsText).toContain("Gateway");
    expect(settingsText).not.toContain("Developer Tools");
    expect(settingsText).not.toContain("Diagnostics");
    expect(settingsText).not.toContain("Advanced");
  });

  it("keeps the settings section nav scoped to visible settings modules", async () => {
    const app = mountApp("/appearance");
    await app.updateComplete;

    const primaryLinks = Array.from(
      expectElement(app, ".sidebar-nav", HTMLElement).querySelectorAll<HTMLAnchorElement>(
        "a.nav-item",
      ),
    );
    expect(primaryLinks.some((link) => link.getAttribute("href") === "/appearance")).toBe(false);

    const settingsNav = expectElement(app, ".settings-section-nav", HTMLElement);
    const settingsText = settingsNav.textContent ?? "";
    expect(settingsText).toContain("Settings");
    expect(settingsText).toContain("Appearance");
    expect(settingsText).not.toContain("Developer Tools");
    expect(settingsText).not.toContain("Diagnostics");
    expect(settingsNav.querySelector('a[href="/appearance"]')).toBeInstanceOf(HTMLAnchorElement);
    expect(settingsNav.querySelector('a[href="/appearance"]')?.classList).toContain(
      "settings-section-nav__item--active",
    );
  });

  it("hides child nav items when the active group is collapsed", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({
      ...app.settings,
      navGroupsCollapsed: { ...app.settings.navGroupsCollapsed, main: true },
    });
    await app.updateComplete;

    const chatLink = expectElement(app, 'a.nav-item[href="/chat"]', HTMLAnchorElement);
    const section = chatLink.closest(".nav-section");
    expect(section).toBeInstanceOf(HTMLElement);
    if (!(section instanceof HTMLElement)) {
      throw new Error("Expected chat link to be inside a nav section");
    }

    expect([...section.classList]).toContain("nav-section--collapsed");
    expect(
      section
        .querySelector<HTMLButtonElement>(".nav-section__label")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("shows recent sessions in the sidebar and switches through them", async () => {
    const app = mountApp("/overview");
    app.sessionKey = "agent:main:second";
    app.sessionsResult = createSessionsResult([
      { key: "global", kind: "global", label: "Global", updatedAt: Date.now() },
      { key: "unknown", kind: "unknown", label: "Unknown", updatedAt: Date.now() - 10_000 },
      { key: "cron:daily", kind: "cron", label: "Daily cron", updatedAt: Date.now() - 20_000 },
      {
        key: "agent:main:subagent:task",
        label: "Subagent",
        spawnedBy: "agent:main:second",
        updatedAt: Date.now() - 25_000,
      },
      { key: "agent:main:first", label: "First workspace", updatedAt: Date.now() - 5 * 60_000 },
      { key: "agent:main:second", label: "Second workspace", updatedAt: Date.now() - 30_000 },
    ]) as typeof app.sessionsResult;
    await app.updateComplete;

    const recent = Array.from(app.querySelectorAll<HTMLElement>(".sidebar-recent-session"));
    expect(recent.map((entry) => entry.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Second workspace just now",
      "First workspace 5m ago",
    ]);

    const recentSection = expectElement(app, ".sidebar-recent-sessions", HTMLElement);
    const recentToggle = expectElement(
      recentSection,
      ".sidebar-recent-sessions__label",
      HTMLButtonElement,
    );
    expect(recentToggle.getAttribute("aria-expanded")).toBe("true");

    recentToggle.click();
    await app.updateComplete;

    expect(app.settings.recentSessionsCollapsed).toBe(true);
    expect(recentToggle.getAttribute("aria-expanded")).toBe("false");
    expect([...recentSection.classList]).toContain("sidebar-recent-sessions--collapsed");

    recentToggle.click();
    await app.updateComplete;

    expect(app.settings.recentSessionsCollapsed).toBe(false);
    expect(recentToggle.getAttribute("aria-expanded")).toBe("true");
    expect([...recentSection.classList]).not.toContain("sidebar-recent-sessions--collapsed");

    recent[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe("agent:main:first");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=agent%3Amain%3Afirst");
  });

  it("creates a new chat session from the sidebar", async () => {
    const app = mountApp("/overview");
    app.sessionKey = "agent:main:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:main:main", label: "Main Session" },
    ]) as typeof app.sessionsResult;
    app.client = {
      stop: vi.fn(),
      request: vi.fn(async (method: string) => {
        if (method === "sessions.create") {
          return { key: "agent:main:fresh" };
        }
        if (method === "sessions.list") {
          return createSessionsResult([
            { key: "agent:main:fresh", label: "Fresh session" },
            { key: "agent:main:main", label: "Main Session" },
          ]);
        }
        return null;
      }),
    } as unknown as typeof app.client;
    await app.updateComplete;

    expectButtonWithText(app, "New session").click();

    await vi.waitFor(() => {
      expect(app.sessionKey).toBe("agent:main:fresh");
    });
    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
    expect(app.client?.["request"]).toHaveBeenCalledWith("sessions.create", {
      agentId: "main",
      parentSessionKey: "agent:main:main",
      emitCommandHooks: true,
    });
  });

  it("closes composer view settings on Escape, outside pointerdown, and tab changes", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const toggle = expectElement(app, ".chat-settings-chip", HTMLButtonElement);
    const dropdown = expectElement(app, ".chat-settings-popover", HTMLElement);

    toggle.focus();
    toggle.click();
    await app.updateComplete;

    expect(app.chatMobileControlsOpen).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect([...toggle.classList]).toEqual(["chat-settings-chip", "chat-settings-chip--open"]);
    expect([...dropdown.classList]).toEqual([
      "chat-settings-popover",
      "chat-settings-popover--open",
    ]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await app.updateComplete;
    await nextFrame();

    expect(app.chatMobileControlsOpen).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect([...dropdown.classList]).toEqual(["chat-settings-popover"]);
    expect(document.activeElement).toBe(toggle);

    toggle.click();
    await app.updateComplete;
    app.requestUpdate();
    await app.updateComplete;

    const openDropdown = expectElement(app, ".chat-settings-popover", HTMLElement);
    expect(app.chatMobileControlsOpen).toBe(true);
    expect([...openDropdown.classList]).toEqual([
      "chat-settings-popover",
      "chat-settings-popover--open",
    ]);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    await app.updateComplete;

    const closedDropdown = expectElement(app, ".chat-settings-popover", HTMLElement);
    expect(app.chatMobileControlsOpen).toBe(false);
    expect([...closedDropdown.classList]).toEqual(["chat-settings-popover"]);

    expectElement(app, ".chat-settings-chip", HTMLButtonElement).click();
    await app.updateComplete;
    expect(app.chatMobileControlsOpen).toBe(true);

    app.setTab("channels");
    await app.updateComplete;
    expect(app.chatMobileControlsOpen).toBe(false);
  });

  it("preserves session navigation without hiding the page chrome", async () => {
    const app = mountApp("/sessions?session=agent:main:subagent:task-123");
    await app.updateComplete;

    const link = expectElement(app, 'a.nav-item[href="/chat"]', HTMLAnchorElement);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe("agent:main:subagent:task-123");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=agent%3Amain%3Asubagent%3Atask-123");

    const shell = expectElement(app, ".shell", HTMLElement);
    const topbar = expectElement(app, ".topbar", HTMLElement);
    const sessionSelect = expectElement(app, ".sidebar-session-select", HTMLElement);
    expect([...shell.classList]).toEqual(["shell", "shell--chat"]);
    expect(topbar.hasAttribute("inert")).toBe(false);
    expect(topbar.hasAttribute("aria-hidden")).toBe(false);
    expect(app.querySelector(".content-header")).toBeNull();
    expect(sessionSelect.querySelector(".chat-controls__session-picker")).toBeInstanceOf(
      HTMLElement,
    );

    app.setTab("channels");

    await app.updateComplete;
    expect(app.tab).toBe("channels");
    expect([...shell.classList]).toEqual(["shell"]);
    expect(topbar.hasAttribute("inert")).toBe(false);
    expect(topbar.hasAttribute("aria-hidden")).toBe(false);
    const channelsContentHeader = expectElement(app, ".content-header", HTMLElement);
    expect(channelsContentHeader.hasAttribute("inert")).toBe(false);
    expect(channelsContentHeader.hasAttribute("aria-hidden")).toBe(false);

    const chatLink = expectElement(app, 'a.nav-item[href="/chat"]', HTMLAnchorElement);
    chatLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect([...shell.classList]).toEqual(["shell", "shell--chat"]);
    expect(topbar.hasAttribute("inert")).toBe(false);
    expect(topbar.hasAttribute("aria-hidden")).toBe(false);
    expect(app.querySelector(".content-header")).toBeNull();
  });

  it("auto-scrolls chat history to the latest message", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    const app = mountApp("/chat");
    await app.updateComplete;

    const initialContainer = app.querySelector<HTMLElement>(".chat-thread");
    expect(initialContainer).toBeInstanceOf(HTMLElement);
    const initialThread = initialContainer!;
    initialThread.style.maxHeight = "180px";
    initialThread.style.overflow = "auto";
    let scrollTop = 0;
    Object.defineProperty(initialThread, "clientHeight", {
      configurable: true,
      get: () => 180,
    });
    Object.defineProperty(initialThread, "scrollHeight", {
      configurable: true,
      get: () => 2400,
    });
    Object.defineProperty(initialThread, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    initialThread.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
      const top =
        typeof options === "number" ? (y ?? 0) : typeof options?.top === "number" ? options.top : 0;
      scrollTop = Math.max(0, Math.min(top, 2400 - 180));
    }) as typeof initialThread.scrollTo;

    app.chatMessages = Array.from({ length: 3 }, (_, index) => ({
      role: "assistant",
      content: `Line ${index}`,
      timestamp: Date.now() + index,
    }));

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    const container = app.querySelector<HTMLElement>(".chat-thread");
    expect(container).toBeInstanceOf(HTMLElement);
    const thread = container!;
    let finalScrollTop = 0;
    Object.defineProperty(thread, "clientHeight", {
      value: 180,
      configurable: true,
    });
    Object.defineProperty(thread, "scrollHeight", {
      value: 960,
      configurable: true,
    });
    Object.defineProperty(thread, "scrollTop", {
      configurable: true,
      get: () => finalScrollTop,
      set: (value: number) => {
        finalScrollTop = value;
      },
    });
    Object.defineProperty(thread, "scrollTo", {
      configurable: true,
      value: ({ top }: { top: number }) => {
        finalScrollTop = top;
      },
    });
    const targetScrollTop = thread.scrollHeight;
    expect(targetScrollTop).toBeGreaterThan(thread.clientHeight);
    app.chatMessages = [
      ...app.chatMessages,
      {
        role: "assistant",
        content: "Line 3",
        timestamp: Date.now() + 3,
      },
    ];
    await app.updateComplete;
    for (let i = 0; i < 10; i++) {
      if (thread.scrollTop === targetScrollTop) {
        break;
      }
      await nextFrame();
    }
    expect(thread.scrollTop).toBe(targetScrollTop);
  });

  it("hydrates hash tokens, restores same-tab refreshes, and clears after gateway changes", async () => {
    const app = mountApp("/ui/overview#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("openclaw.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/overview");
    expect(window.location.hash).toBe("");
    app.remove();

    const refreshed = mountApp("/ui/overview");
    await refreshed.updateComplete;

    expect(refreshed.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("openclaw.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );

    const gatewayUrlInput = expectElement(
      refreshed,
      'input[placeholder="ws://100.x.y.z:18789"]',
      HTMLInputElement,
    );
    gatewayUrlInput.value = "wss://other-gateway.example/openclaw";
    gatewayUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
    await refreshed.updateComplete;

    expect(refreshed.settings.gatewayUrl).toBe("wss://other-gateway.example/openclaw");
    expect(refreshed.settings.token).toBe("");
  });

  it("keeps a hash token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/overview?gatewayUrl=wss://other-gateway.example/openclaw#token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/openclaw");
    expect(app.settings.token).toBe("");

    await confirmPendingGatewayChange(app);

    expectConfirmedGatewayChange(app);
  });
});
