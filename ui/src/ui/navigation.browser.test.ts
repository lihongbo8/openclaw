import { describe, expect, it, vi } from "vitest";
import type { ToolSupplyControlReadModel } from "./controllers/tool-supply-control.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

const MODEL_TOKEN_CONSUMERS = [
  "model",
  "local_dialog",
  "operations_backend",
  "build_session",
  "buyer_storefront",
  "user_center",
  "developer_center",
  "ai_review",
  "role_execution",
  "media_model",
] as const;

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

function expectCardContainingText(app: ReturnType<typeof mountApp>, text: string): HTMLElement {
  const card = Array.from(app.querySelectorAll<HTMLElement>("div"))
    .filter((candidate) => {
      const content = candidate.textContent ?? "";
      return content.includes(text) && content.includes("已用于");
    })
    .toSorted(
      (left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0),
    )[0];
  expect(card).toBeInstanceOf(HTMLElement);
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Expected card containing "${text}"`);
  }
  return card;
}

function expectButtonIn(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected scoped button with text "${text}"`);
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

function createToolSupplyReadModel(
  overrides: Partial<ToolSupplyControlReadModel> = {},
): ToolSupplyControlReadModel {
  const base: ToolSupplyControlReadModel = {
    version: 1 as const,
    updatedAt: Date.now(),
    authority: "openclaw_local" as const,
    metrics: {
      total: 2,
      localTools: 1,
      pluginTools: 0,
      skills: 1,
      apiConnections: 0,
      cloudCapabilities: 2,
      available: 2,
      blocked: 1,
      disabled: 0,
      pendingReview: 1,
      risks: 1,
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
    cloudCapabilities: [
      {
        id: "cloud:marketplace-ops",
        label: "岗位商城运营通用能力",
        kind: "cloud_capability",
        source: "cloud_marketplace",
        status: "blocked",
        risk: "medium",
        blockedReasons: ["cloud_capability_not_authorized"],
      },
      {
        id: "unique:visual-audit",
        label: "商品图视觉审核独特能力",
        kind: "cloud_capability",
        source: "cloud_marketplace",
        status: "pending_review",
        risk: "high",
        blockedReasons: ["unique_capability_pending"],
      },
    ],
    categories: [
      {
        id: "cloud:marketplace-ops",
        name: "岗位商城",
        source: "cloud",
        status: "active",
        listingCount: 2,
      },
    ],
    packages: [
      {
        category: {
          id: "cloud:marketplace-ops",
          name: "岗位商城",
          source: "cloud",
          status: "active",
          listingCount: 2,
        },
        skills: [],
        tools: [],
        roleUsageCount: 2,
      },
    ],
    risks: [
      {
        id: "cloud:marketplace-ops:cloud_capability_not_authorized",
        label: "岗位商城运营通用能力",
        targetKind: "cloud_capability",
        severity: "blocking",
        reason: "cloud_capability_not_authorized",
        message: "云端商城能力未授权，不能本地伪造通过。",
      },
    ],
    grants: [],
    bindings: [],
    uniqueCapabilityRequests: [],
    systemDevelopmentTodos: [],
  };
  return { ...base, ...overrides };
}

function createSkillsStatusReport() {
  return {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/skills",
    skills: [
      {
        name: "Browser Automation",
        description: "浏览器自动化 Skill",
        source: "openclaw-managed",
        filePath: "/tmp/skills/browser-automation/SKILL.md",
        baseDir: "/tmp/skills/browser-automation",
        skillKey: "browser-automation",
        bundled: false,
        primaryEnv: "BROWSER_API_KEY",
        always: false,
        disabled: false,
        blockedByAllowlist: false,
        eligible: true,
        requirements: { bins: [], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
    ],
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

  it("loads the three-part tool and skill management page when opened directly", async () => {
    const app = mountApp("/skills");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel();
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("skills.status", {}));
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const text = app.textContent ?? "";
    expect(text).toContain("工具与 Skill");
    expect(text).toContain("Skill");
    expect(text).toContain("工具");
    expect(text).toContain("品类能力");
    expect(text).not.toContain("独特能力");
    expect(text).toContain("browser-automation");
    expect(text).toContain("当前品类能力包");
    expect(text).toContain("全选当前列表");
    expect(text).toContain("取消选择");
    expect(text).toContain("保存组合");
    expect(text).not.toContain("选择品类");
    expect(text).not.toContain("新手使用路线");
    expect(text).not.toContain("缺口处理中心");
    expect(text).not.toContain("工具供给与管控中心");
    expect(text).not.toContain("去任务调度验证");
    const buttonLabels = Array.from(app.querySelectorAll<HTMLButtonElement>("button")).map(
      (button) => button.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(buttonLabels).toEqual(expect.arrayContaining(["Skill", "工具", "品类能力"]));
    expect(buttonLabels).not.toContain("独特能力");
    expect(buttonLabels).not.toContain("同步 OpenClaw");
    expect(buttonLabels).not.toContain("API 管理");
  });

  it("saves selected skills into the current category and keeps ClawHub install available", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel();
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
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
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("skills.status", {}));
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const skillCard = expectCardContainingText(app, "browser-automation");
    const checkbox = expectElement(skillCard, 'input[type="checkbox"]', HTMLInputElement);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;

    expect(request).not.toHaveBeenCalledWith("aics.toolSupply.binding.set", expect.anything());

    expectButtonWithText(app, "保存组合").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.toolSupply.binding.set",
        expect.objectContaining({
          sourceItemId: "skill:browser-automation",
          sourceKind: "skill",
          targetKind: "category_capability",
          targetId: "cloud:marketplace-ops",
          targetTitle: "岗位商城",
          syncStatus: "local",
        }),
      ),
    );

    const input = expectElement(app, 'input[placeholder="搜索 ClawHub Skill"]', HTMLInputElement);
    input.value = "browser";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: "browser" }),
    );
    await app.updateComplete;
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("skills.search", { query: "browser", limit: 20 }),
    );
    await app.updateComplete;
    expect(app.textContent ?? "").toContain("Browser Skill");
    expectButtonWithText(app, "安装");
  });

  it("keeps large category lists selectable from the current category control", async () => {
    const categories = Array.from({ length: 100 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        id: `cloud:category-${number}`,
        name: `云端品类 ${number}`,
        source: "cloud" as const,
        status: "active" as const,
        listingCount: 0,
      };
    });
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel({
          categories,
          packages: categories.map((category) => ({
            category,
            skills: [],
            tools: [],
            roleUsageCount: category.listingCount,
          })),
        });
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const categorySelect = expectElement(app, "select", HTMLSelectElement);
    expect(categorySelect.options.length).toBe(100);
    categorySelect.value = "cloud:category-099";
    categorySelect.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;

    const skillCard = expectCardContainingText(app, "browser-automation");
    const checkbox = expectElement(skillCard, 'input[type="checkbox"]', HTMLInputElement);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;

    expectButtonWithText(app, "保存组合").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.toolSupply.binding.set",
        expect.objectContaining({
          sourceItemId: "skill:browser-automation",
          sourceKind: "skill",
          targetKind: "category_capability",
          targetId: "cloud:category-099",
          targetTitle: "云端品类 099",
          status: "active",
        }),
      ),
    );
  });

  it("removes a skill from the current category only after saving", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel({
          bindings: [
            {
              id: "binding-skill-browser",
              sourceItemId: "skill:browser-automation",
              sourceKind: "skill",
              targetKind: "category_capability",
              targetId: "cloud:marketplace-ops",
              targetTitle: "岗位商城",
              status: "active",
              syncStatus: "local",
            },
          ],
        });
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const skillCard = expectCardContainingText(app, "browser-automation");
    const checkbox = expectElement(skillCard, 'input[type="checkbox"]', HTMLInputElement);
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;

    expect(request).not.toHaveBeenCalledWith("aics.toolSupply.binding.remove", expect.anything());
    expectButtonWithText(app, "保存组合").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.toolSupply.binding.remove",
        expect.objectContaining({
          id: "binding-skill-browser",
        }),
      ),
    );
  });

  it("saves selected tool bindings from the tool page", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel();
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    expectButtonWithText(app, "工具").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;
    const toolCard = expectCardContainingText(app, "read");
    const checkbox = expectElement(toolCard, 'input[type="checkbox"]', HTMLInputElement);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await app.updateComplete;
    expectButtonWithText(app, "保存组合").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.toolSupply.binding.set",
        expect.objectContaining({
          sourceItemId: "core:read",
          sourceKind: "tool",
          targetId: "cloud:marketplace-ops",
        }),
      ),
    );
  });

  it("opens category package editing with the clicked category selected", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        const categories = [
          {
            id: "cloud:marketplace-ops",
            name: "岗位商城",
            source: "cloud" as const,
            status: "active" as const,
            listingCount: 2,
          },
          {
            id: "cloud:content-ops",
            name: "内容运营",
            source: "cloud" as const,
            status: "active" as const,
            listingCount: 1,
          },
        ];
        return createToolSupplyReadModel({
          categories,
          packages: categories.map((category) => ({
            category,
            skills: [],
            tools: [],
            roleUsageCount: category.listingCount,
          })),
        });
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.toolSupplyActiveSubpage = "category";
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    const contentCategoryCard = Array.from(app.querySelectorAll<HTMLElement>("div"))
      .filter((candidate) => {
        const content = candidate.textContent ?? "";
        return content.includes("内容运营") && content.includes("编辑 Skill");
      })
      .toSorted(
        (left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0),
      )[0];
    expect(contentCategoryCard).toBeInstanceOf(HTMLElement);
    if (!(contentCategoryCard instanceof HTMLElement)) {
      throw new Error("Expected content category card");
    }
    expectButtonIn(contentCategoryCard, "编辑 Skill").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;

    expect(app.toolSupplyActiveSubpage).toBe("skill");
    const categorySelect = expectElement(app, "select", HTMLSelectElement);
    expect(categorySelect.value).toBe("cloud:content-ops");
  });

  it("does not expose direct skill uninstall from the user-facing skill list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel({
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
              canDelete: true,
            },
          ],
        });
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    expect(app.textContent ?? "").not.toContain("卸载");
    expect(request).not.toHaveBeenCalledWith("aics.toolSupply.skill.uninstall", expect.anything());
  });

  it("does not expose direct plugin uninstall from the user-facing tool list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "aics.toolSupply.readModel.get") {
        return createToolSupplyReadModel({
          localTools: [
            {
              id: "plugin:image-tools:compress",
              label: "compress-image",
              kind: "plugin_tool",
              source: "plugin",
              status: "available",
              risk: "low",
              blockedReasons: [],
              pluginId: "image-tools",
              canDelete: true,
            },
          ],
        });
      }
      if (method === "skills.status") {
        return createSkillsStatusReport();
      }
      if (method === "agents.list") {
        return { agents: [] };
      }
      return {};
    });
    const app = mountApp("/skills");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.setTab("skills");
    app.requestUpdate();
    await app.updateComplete;
    await nextFrame();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.toolSupply.readModel.get", {}),
    );
    await app.updateComplete;

    expectButtonWithText(app, "工具").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await app.updateComplete;
    expect(app.textContent ?? "").not.toContain("卸载");
    expect(request).not.toHaveBeenCalledWith("aics.toolSupply.plugin.uninstall", expect.anything());
  });

  it("keeps the three page shell before gateway data is connected", async () => {
    const app = mountApp("/skills");
    app.connected = true;
    app.client = null;
    await app.updateComplete;

    expect(app.textContent ?? "").toContain("工具与 Skill");
    expect(app.textContent ?? "").toContain("Skill");
    expect(app.textContent ?? "").toContain("工具");
    expect(app.textContent ?? "").toContain("品类能力");
    expect(app.textContent ?? "").not.toContain("独特能力");
  });

  it.skip("creates and deletes a tool and skill API connection from the UI", async () => {
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
    app.updateApiConnectionFormField("secretEnvId", "TOOL_SKILL_API_KEY");
    await app.updateComplete;

    expect(app.apiConnections.form.kind).toBe("tool_skill");
    expect(app.apiConnections.form.templateId).toBe("tool-skill-api");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const secretRefInput = expectElement(
      form,
      'input[placeholder="DEEPSEEK_API_KEY"]',
      HTMLInputElement,
    );
    expect(secretRefInput.closest("form")).toBe(form);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "添加 API 连接",
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
          secret: undefined,
          secretEnvId: "TOOL_SKILL_API_KEY",
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

  it.skip("stores cloud smoke output as Dijie bridge metadata from API management", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "cloud-marketplace");
    app.updateApiConnectionFormField("baseUrl", "http://127.0.0.1:9000");
    app.updateApiConnectionFormField("secretEnvId", "DIJIE_CLOUD_ACCESS_TOKEN");
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
      (button) => button.textContent?.trim() === "添加迭界AI云端连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "迭界AI云端（本地开发）",
          kind: "marketplace",
          provider: "cloud-marketplace",
          baseUrl: "http://127.0.0.1:9000",
          secret: undefined,
          secretEnvId: "DIJIE_CLOUD_ACCESS_TOKEN",
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
    expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
      id: "marketplace-cloud-marketplace",
    });
  });

  it("saves a model API for local model-token scenarios by default", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "openai");
    app.updateApiConnectionFormField("connectionMode", "direct");
    app.updateApiConnectionFormField("secretValue", "sk-test-openai");
    await app.updateComplete;

    expect(app.apiConnections.form.consumers).toEqual([...MODEL_TOKEN_CONSUMERS]);
    expect(app.apiConnections.form.modelId).toBe("gpt-5.5");
    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "8");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "32");
    app.updateApiConnectionFormField("dailyBudgetCny", "50");
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "添加 API 连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "OpenAI",
          kind: "model",
          provider: "openai",
          consumers: [...MODEL_TOKEN_CONSUMERS],
          metadata: expect.objectContaining({
            defaultModel: "gpt-5.5",
            availableModels: ["gpt-5.5"],
            pricing: {
              currency: "CNY",
              unit: "1M_tokens",
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            },
            budget: {
              currency: "CNY",
              period: "day",
              dailyCny: 50,
            },
            metering: expect.objectContaining({
              calls: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costCny: 0,
            }),
          }),
        }),
      ),
    );
  });

  it("allows a manual model id such as codex-bengalfox and refreshes the chat model catalog", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") {
        return {
          models: [
            { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
            { id: "codex-bengalfox", name: "codex-bengalfox", provider: "openai" },
          ],
        };
      }
      return {};
    });
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "openai");
    app.updateApiConnectionFormField("connectionMode", "direct");
    app.updateApiConnectionFormField("secretValue", "sk-test-openai");
    app.updateApiConnectionFormField("modelId", "codex-bengalfox");
    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "8");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "32");
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const customModelInput = expectElement(app, "[data-api-custom-model-id]", HTMLInputElement);
    expect(customModelInput.value).toBe("codex-bengalfox");
    expect(form.textContent ?? "").toContain("手动模型 ID，保存后以测试连接结果为准");
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "添加 API 连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "OpenAI",
          kind: "model",
          provider: "openai",
          metadata: expect.objectContaining({
            defaultModel: "codex-bengalfox",
            availableModels: ["gpt-5.5", "codex-bengalfox"],
            modelValidation: expect.objectContaining({
              status: "needs_test",
              source: "manual_model_id",
            }),
          }),
        }),
      ),
    );
    const createCall = request.mock.calls.find(
      ([method]) => method === "aics.apiConnections.entry.create",
    ) as [string, unknown] | undefined;
    expect(createCall?.[1]).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          pricing: expect.anything(),
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
        id: "model-openai",
      }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("models.list", { view: "configured" }),
    );
    await vi.waitFor(() =>
      expect(app.chatModelCatalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "codex-bengalfox", provider: "openai" }),
        ]),
      ),
    );
  });

  it("shows manual model validation status and marks it confirmed only after local fallback test", async () => {
    const app = mountApp("/api-management");
    app.client = null;
    app.connected = true;
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        entries: [
          {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            baseUrl: "https://api.openai.com/v1",
            consumers: ["model", "local_dialog"],
            secret: { mode: "oauth", status: "configured" },
            status: "available",
            riskStatus: "ok",
            risks: [],
            metadata: {
              defaultModel: "codex-bengalfox",
              availableModels: ["gpt-5.5", "codex-bengalfox"],
              modelValidation: {
                status: "needs_test",
                source: "manual_model_id",
                note: "手动模型 ID 已保存；需要用真实账号测试连接后才能确认可调用。",
              },
              pricing: {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
            },
            configBindings: [{ path: "models.providers.openai" }],
          },
        ],
      },
    };
    await app.updateComplete;

    expect(app.textContent ?? "").toContain("模型: codex-bengalfox");
    expect(app.textContent ?? "").toContain("模型验证: 待验证");
    expect(app.textContent ?? "").not.toContain("模型验证: 手动确认");
    expectButtonWithText(app, "测试").click();
    await app.updateComplete;

    expect(app.apiConnections.message).toContain("手动模型 ID 已做本地配置检查");
    const entry = (app.apiConnections.readModel as { entries?: Array<Record<string, unknown>> })
      .entries?.[0];
    expect(
      (entry?.metadata as Record<string, unknown>).modelValidation as Record<string, unknown>,
    ).toMatchObject({ status: "manual_confirmed" });
    expect(app.textContent ?? "").toContain("模型验证: 手动确认");
  });

  it("tests a manual model id through the Gateway when connected", async () => {
    const readModel = {
      entries: [
        {
          id: "model-openai",
          name: "OpenAI",
          kind: "model",
          provider: "openai",
          authMode: "oauth",
          baseUrl: "https://api.openai.com/v1",
          consumers: ["model", "local_dialog"],
          secret: { mode: "oauth", status: "configured" },
          status: "available",
          riskStatus: "ok",
          risks: [],
          metadata: {
            defaultModel: "codex-bengalfox",
            availableModels: ["gpt-5.5", "codex-bengalfox"],
            modelValidation: {
              status: "needs_test",
              source: "manual_model_id",
              note: "手动模型 ID 已保存；需要用真实账号测试连接后才能确认可调用。",
            },
            pricing: {
              currency: "CNY",
              unit: "1M_tokens",
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            },
          },
          configBindings: [{ path: "models.providers.openai" }],
        },
      ],
    };
    const confirmedReadModel = {
      entries: [
        {
          ...readModel.entries[0],
          metadata: {
            ...readModel.entries[0].metadata,
            modelValidation: {
              status: "manual_confirmed",
              source: "manual_model_id",
              note: "已完成后端配置检查；真实可调用性仍以外部模型请求结果为准。",
            },
          },
        },
      ],
    };
    const request = vi.fn(async () => ({
      ok: true,
      connectionTest: {
        status: "needs_review",
        message: "手动模型 ID 已做后端配置检查并标记为手动确认；这不代表已经发起外部模型调用。",
      },
      readModel: confirmedReadModel,
    }));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.apiConnections = {
      ...app.apiConnections,
      readModel,
    };
    await app.updateComplete;

    expectButtonWithText(app, "测试").click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.test", {
        id: "model-openai",
      }),
    );
    await app.updateComplete;

    expect(app.apiConnections.message).toContain("手动模型 ID 已做后端配置检查");
    const entry = (app.apiConnections.readModel as { entries?: Array<Record<string, unknown>> })
      .entries?.[0];
    expect(
      (entry?.metadata as Record<string, unknown>).modelValidation as Record<string, unknown>,
    ).toMatchObject({ status: "manual_confirmed" });
    expect(app.textContent ?? "").toContain("模型验证: 手动确认");
  });

  it("requires external model pricing before saving so token usage can produce cost", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "openai");
    app.updateApiConnectionFormField("connectionMode", "direct");
    app.updateApiConnectionFormField("secretValue", "sk-test-openai");
    await app.updateComplete;

    const findConnectButton = () => {
      const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
      return Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "添加 API 连接",
      );
    };
    let connectButton = findConnectButton();

    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    expect(connectButton?.disabled).toBe(false);

    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "");
    await app.updateComplete;

    connectButton = findConnectButton();
    expect(connectButton?.disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();

    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "8");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "32");
    await app.updateComplete;

    connectButton = findConnectButton();
    expect(connectButton?.disabled).toBe(false);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          metadata: expect.objectContaining({
            pricing: expect.objectContaining({
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            }),
          }),
        }),
      ),
    );
  });

  it.skip("stores nested Dijie cloud bridge smoke output from API management", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "dijie-cloud-bridge");
    app.updateApiConnectionFormField("baseUrl", "http://127.0.0.1:9000");
    app.updateApiConnectionFormField("secretEnvId", "DIJIE_CLOUD_ACCESS_TOKEN");
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
      (button) => button.textContent?.trim() === "添加迭界AI云端连接",
    );
    expect(connectButton).toBeInstanceOf(HTMLButtonElement);
    connectButton?.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "迭界AI云端",
          kind: "marketplace",
          provider: "dijie-cloud-bridge",
          baseUrl: "http://127.0.0.1:9000",
          secret: undefined,
          secretEnvId: "DIJIE_CLOUD_ACCESS_TOKEN",
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
            name: "迭界AI云端",
            kind: "marketplace",
            provider: "dijie-cloud-bridge",
            baseUrl: "http://127.0.0.1:9000",
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

  it("edits OAuth model connections without asking for an API key", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        entries: [
          {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            baseUrl: "https://api.openai.com/v1",
            consumers: ["model", "local_dialog", "operations_backend"],
            secret: { mode: "oauth", status: "configured" },
            metadata: {
              defaultModel: "gpt-5.5",
              availableModels: ["gpt-5.5"],
              pricing: {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
            },
            configBindings: [{ path: "models.providers.openai" }],
          },
        ],
      },
    };

    app.editApiConnectionEntry("model-openai");
    await app.updateComplete;

    expect(app.apiConnections.form.templateId).toBe("openai");
    expect(app.apiConnections.form.connectionMode).toBe("oauth");
    expect(app.apiConnections.form.modelId).toBe("gpt-5.5");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    expect(form.textContent ?? "").toContain("API Key");
    expect(form.querySelector('input[placeholder="sk-..."]')).toBeNull();
    const oauthButton = expectButtonWithText(app, "保存 API 修改");
    expect(oauthButton.disabled).toBe(false);
  });

  it("normalizes stale OpenAI OAuth model metadata to the current model option", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        entries: [
          {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            authMode: "oauth",
            baseUrl: "https://api.openai.com/v1",
            consumers: ["model", "local_dialog", "operations_backend"],
            secret: { mode: "oauth", status: "configured" },
            metadata: {
              defaultModel: "gpt-4.1",
              availableModels: ["gpt-4.1"],
              pricing: {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
            },
            configBindings: [{ path: "models.providers.openai" }],
          },
        ],
      },
    };

    app.editApiConnectionEntry("model-openai");
    await app.updateComplete;

    expect(app.apiConnections.form.connectionMode).toBe("oauth");
    expect(app.apiConnections.form.modelId).toBe("gpt-5.5");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    expect(form.textContent ?? "").toContain("选择模型");
    expect(form.textContent ?? "").toContain("gpt-5.5");
    expect(form.textContent ?? "").not.toContain("gpt-4.1");
    expect(form.textContent ?? "").toContain("API Key");
    expect(form.querySelector('input[placeholder="sk-..."]')).toBeNull();
  });

  it("saves OpenAI OAuth model configuration without asking for an API key", async () => {
    const request = vi.fn(async () => ({}));
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "openai");
    app.updateApiConnectionFormField("connectionMode", "oauth");
    await app.updateComplete;

    expect(app.apiConnections.form.connectionMode).toBe("oauth");
    expect(app.apiConnections.form.modelId).toBe("gpt-5.5");
    expect(app.apiConnections.form.inputTokenPriceCnyPerMillion).toBe("8");
    expect(app.apiConnections.form.outputTokenPriceCnyPerMillion).toBe("32");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    expect(form.querySelector('input[placeholder="sk-..."]')).toBeNull();
    const oauthButton = expectButtonWithText(app, "添加 API 连接");
    expect(oauthButton.disabled).toBe(false);
    oauthButton.click();

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          name: "OpenAI",
          kind: "model",
          provider: "openai",
          authMode: "oauth",
          secret: undefined,
          consumers: [...MODEL_TOKEN_CONSUMERS],
          metadata: expect.objectContaining({
            defaultModel: "gpt-5.5",
            availableModels: ["gpt-5.5"],
          }),
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
        id: "model-openai",
      }),
    );
  });

  it.skip("treats API connection save during gateway restart as submitted", async () => {
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
    app.updateApiConnectionFormField("secretEnvId", "TOOL_SKILL_API_KEY");
    await app.updateComplete;

    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    const connectButton = Array.from(form.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "添加 API 连接",
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
            title: "岗位商城运营诊断岗位",
            description: "检查首批岗位商品能力说明、授权说明、输出样例和可调用状态。",
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
        title: "岗位商城运营诊断岗位",
        detail: "检查首批岗位商品能力说明、授权说明、输出样例和可调用状态。",
        status: "published",
        roleListingId: "djrole_role_marketplace_designer",
        entitlementId: "djent_role_marketplace_designer",
      },
    ]);
    expect(app.aicsMarketplace.roles[0]?.title).toBe("岗位商城运营诊断岗位");
  });

  it("syncs installed marketplace roles from gateway read-model shaped responses", async () => {
    const app = mountApp("/workboard");
    const request = vi.fn(async () => ({
      ok: true,
      readModel: {
        roles: [
          {
            roleListingId: "djrole_role_marketplace_designer",
            title: "岗位商城运营诊断岗位",
            subtitle: "检查首批岗位商品能力说明、授权说明、输出样例和可调用状态。",
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
        title: "岗位商城运营诊断岗位",
        detail: "检查首批岗位商品能力说明、授权说明、输出样例和可调用状态。",
        status: "published",
        roleListingId: "djrole_role_marketplace_designer",
        entitlementId: "djent_role_marketplace_designer",
        catalogRefs: ["image.inspect", "api.opencloud.image_generation"],
        callable: true,
        requiredCapabilities: ["image.inspect"],
      },
    ]);
    expect(app.aicsMarketplace.roles[0]?.title).toBe("岗位商城运营诊断岗位");
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
    expect(text).toContain("待派发工作项");
    expect(text).toContain("去规划方案");
    expect(text).toContain("派发单");
    expect(text).not.toContain("创建调度方案");
    expect(text).not.toContain("确认调度");
    expect(text).not.toContain("只确认调度");
    expect(text).not.toContain("只生成任务包");
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
              kind: "model",
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
              configBindings: [{ path: "models.providers.openai" }],
              metadata: {
                defaultModel: "gpt-5.5",
                availableModels: ["gpt-5.5"],
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 8,
                  outputCnyPerMillion: 32,
                },
                metering: {
                  calls: 1,
                  inputTokens: 1280,
                  outputTokens: 620,
                  totalTokens: 1900,
                  costCny: 0.03008,
                  byConsumer: {
                    role_execution: {
                      calls: 1,
                      inputTokens: 1280,
                      outputTokens: 620,
                      totalTokens: 1900,
                      costCny: 0.03008,
                      lastUsageRef: "ui_role_execution:task-1",
                    },
                  },
                },
              },
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
    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "8");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "32");
    await app.updateComplete;

    expect(app.tab).toBe("apiManagement");
    const pageText = app.textContent ?? app.shadowRoot?.textContent ?? "";
    expect(pageText).toContain("API 管理");
    expect(pageText).toContain("多个模型/API Key、供给对象与调用计量");
    expect(pageText).toContain("费用按模型 Token 计量");
    expect(pageText).toContain("本地主对话框");
    expect(pageText).toContain("经营后台");
    expect(pageText).toContain("BuildSession");
    expect(pageText).toContain("商城前台");
    expect(pageText).toContain("使用者中心");
    expect(pageText).toContain("开发者中心");
    expect(pageText).toContain("AI 辅助审核");
    expect(pageText).toContain("岗位执行");
    expect(pageText).toContain("选择模型");
    expect(pageText).toContain("gpt-5.5");
    expect(pageText).toContain("密钥：未配置");
    expect(pageText).toContain("模型供应商");
    expect(pageText).toContain("添加 API");
    expect(pageText).toContain("模型供应商");
    expect(pageText).toContain("迭界AI云端");
    expect(pageText).not.toContain("服务类型");
    expect(pageText).not.toContain("商城 API");
    expect(pageText).toContain("工具");
    expect(pageText).toContain("Skill");
    expect(pageText).toContain("提供给");
    expect(pageText).toContain("勾选后进入对应调用池");
    expect(pageText).toContain("模型定价");
    expect(pageText).toContain("输入 Token 单价（元 / 百万）");
    expect(pageText).toContain("输出 Token 单价（元 / 百万）");
    expect(pageText).toContain("用量：1900 Token");
    expect(pageText).toContain("0.03008 元");
    expect(pageText).toContain("API 列表与计量");
    expect(pageText).toContain("提供给");
    expect(pageText).toContain("定价：8");
    expect(pageText).not.toContain("models.providers.openai.apiKey");
    expect(pageText).toContain("DeepSeek");
    expect(pageText).toContain("阿里百炼 / 通义千问");
    expect(pageText).toContain("SecretRef");
    expect(pageText).not.toContain("直接输入 API Key");
    const form = expectElement(app, "[data-api-connection-form]", HTMLElement);
    expect(form.textContent ?? "").toContain("模型供应商 / 服务");
    expect(form.textContent ?? "").toContain("选择模型");
    expect(form.textContent ?? "").toContain("API Key");
    expect(form.textContent ?? "").not.toContain("OAuth 已授权");
    expect(form.querySelector('input[type="password"]')).toBeInstanceOf(HTMLInputElement);
    const addButton = expectButtonWithText(app, "添加 API 连接");
    expect(addButton.disabled).toBe(true);
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
    expect(pageText).not.toContain("岗位商城闭环接入");
    expect(pageText).not.toContain("粘贴 smoke JSON");
    expect(app.apiConnections.form.templateId).toBe("openai");
  });

  it("keeps tool and Skill risks out of API management risk summary", async () => {
    const app = mountApp("/api-management");
    app.connected = true;
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        metrics: { configured: 0, available: 0, risky: 0, unbound: 0, blocked: 2 },
        groups: { model: [], tool_skill: [], marketplace: [], dialog: [], custom: [] },
        riskReport: {
          items: [
            {
              code: "missing_marketplace_api",
              severity: "blocking",
              message: "迭界AI云端未配置，授权读取、已购岗位和费用回写会被阻塞。",
            },
            {
              code: "missing_model_provider",
              severity: "blocking",
              message:
                "模型 Provider 未配置，本地主对话、经营后台、BuildSession 和岗位执行无法消耗模型 Token。",
            },
          ],
        },
      },
    };
    app.toolSupplyControl = {
      ...app.toolSupplyControl,
      readModel: createToolSupplyReadModel({
        risks: [
          ...Array.from({ length: 12 }, (_, index) => ({
            id: `skill-risk-${index}`,
            label: "Skill 依赖",
            targetKind: "skill" as const,
            severity: "blocking" as const,
            reason: "skill_missing_dependency" as const,
            message: "Skill 依赖未满足，需要安装依赖或补齐配置。",
          })),
          ...Array.from({ length: 4 }, (_, index) => ({
            id: `api-risk-${index}`,
            label: "API 绑定",
            targetKind: "skill" as const,
            severity: "blocking" as const,
            reason: "missing_api_binding" as const,
            message: "缺少可用 API 绑定，不能供给对应工具或 Skill。",
          })),
        ],
      }),
    };
    await app.updateComplete;

    const pageText = (app.textContent ?? "").replace(/\s+/g, " ");
    expect(pageText).toContain("API 列表与计量");
    expect(pageText).not.toContain("API 连接风险");
    expect(pageText).not.toContain("missing_marketplace_api");
    expect(pageText).not.toContain("skill_missing_dependency");
    expect(pageText).not.toContain("missing_api_binding");
    expect(pageText).not.toContain("Skill 依赖未满足");
    expect(pageText).not.toContain("缺少可用 API 绑定");
  });

  it("rolls session model usage into API management metering by provider and model", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        metrics: { configured: 1, available: 1, risky: 0, unbound: 0, blocked: 0 },
        groups: {
          model: [
            {
              id: "model-openai",
              name: "OpenAI 模型 API",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com/v1",
              status: "available",
              riskStatus: "ok",
              secret: { mode: "oauth", status: "configured" },
              consumers: ["model", "local_dialog", "developer_center"],
              configBindings: [{ path: "models.providers.openai" }],
              metadata: {
                defaultModel: "codex-bengalfox",
                availableModels: ["gpt-5.5", "codex-bengalfox"],
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 8,
                  outputCnyPerMillion: 32,
                },
                budget: { currency: "CNY", period: "day", dailyCny: 0.01 },
                metering: {
                  calls: 2,
                  inputTokens: 1000,
                  outputTokens: 500,
                  totalTokens: 1500,
                  costCny: 0.024,
                  byConsumer: {
                    local_dialog: {
                      calls: 1,
                      inputTokens: 400,
                      outputTokens: 100,
                      totalTokens: 500,
                      costCny: 0.0064,
                    },
                    developer_center: {
                      calls: 1,
                      inputTokens: 600,
                      outputTokens: 400,
                      totalTokens: 1000,
                      costCny: 0.0176,
                    },
                  },
                },
              },
            },
          ],
          tool_skill: [],
          marketplace: [],
          dialog: [],
        },
        riskReport: { items: [] },
      },
    };
    app.usageResult = {
      updatedAt: Date.now(),
      startDate: "2026-06-16",
      endDate: "2026-06-16",
      sessions: [
        {
          key: "main",
          label: "本地主对话框",
          updatedAt: Date.now(),
          usage: {
            input: 400,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 500,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 400,
                  output: 100,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 500,
                  totalCost: 0,
                  inputCost: 0,
                  outputCost: 0,
                  cacheReadCost: 0,
                  cacheWriteCost: 0,
                  missingCostEntries: 0,
                },
              },
            ],
          },
        },
        {
          key: "developer-center:role-builder",
          label: "开发者中心岗位包助手",
          channel: "developer_center",
          updatedAt: Date.now(),
          origin: { surface: "developer_center", label: "开发者中心" },
          usage: {
            input: 600,
            output: 400,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1000,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 600,
                  output: 400,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 1000,
                  totalCost: 0,
                  inputCost: 0,
                  outputCost: 0,
                  cacheReadCost: 0,
                  cacheWriteCost: 0,
                  missingCostEntries: 0,
                },
              },
            ],
          },
        },
      ],
      totals: {
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1500,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      },
      aggregates: {
        messages: { total: 2, user: 1, assistant: 1, toolCalls: 0, toolResults: 0, errors: 0 },
        tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
        byModel: [
          {
            provider: "openai",
            model: "codex-bengalfox",
            count: 2,
            totals: {
              input: 1000,
              output: 500,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 1500,
              totalCost: 0,
              inputCost: 0,
              outputCost: 0,
              cacheReadCost: 0,
              cacheWriteCost: 0,
              missingCostEntries: 0,
            },
          },
        ],
        byProvider: [],
        byAgent: [],
        byChannel: [],
        daily: [],
      },
    };
    app.connected = true;
    await app.updateComplete;

    const pageText = app.textContent ?? "";
    const compactPageText = pageText.replace(/\s+/g, " ");
    expect(compactPageText).toContain("codex-bengalfox · openai");
    expect(compactPageText).toContain("用量：1500 Token");
    expect(compactPageText).toContain("0.024 元");
  });

  it("shows missing model pricing instead of a fake zero price", async () => {
    const app = mountApp("/api-management");
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        metrics: { configured: 1, available: 1, risky: 0, unbound: 0, blocked: 0 },
        groups: {
          model: [
            {
              id: "model-openai",
              name: "OpenAI OAuth",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com/v1",
              status: "available",
              riskStatus: "ok",
              secret: { mode: "oauth", status: "configured" },
              consumers: ["local_dialog", "developer_center"],
              configBindings: [{ path: "models.providers.openai" }],
              metadata: {
                defaultModel: "codex-bengalfox",
                availableModels: ["gpt-5.5", "codex-bengalfox"],
              },
            },
          ],
          tool_skill: [],
          marketplace: [],
          dialog: [],
        },
        riskReport: { items: [] },
      },
    };
    app.usageResult = {
      updatedAt: Date.now(),
      startDate: "2026-06-16",
      endDate: "2026-06-16",
      sessions: [
        {
          key: "main",
          label: "本地主对话框",
          updatedAt: Date.now(),
          usage: {
            input: 400,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 500,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 400,
                  output: 100,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 500,
                  totalCost: 0,
                  inputCost: 0,
                  outputCost: 0,
                  cacheReadCost: 0,
                  cacheWriteCost: 0,
                  missingCostEntries: 0,
                },
              },
            ],
          },
        },
      ],
      totals: {
        input: 400,
        output: 100,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 500,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      },
      aggregates: {
        messages: { total: 1, user: 1, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
        tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
        byModel: [
          {
            provider: "openai",
            model: "codex-bengalfox",
            count: 1,
            totals: {
              input: 400,
              output: 100,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 500,
              totalCost: 0,
              inputCost: 0,
              outputCost: 0,
              cacheReadCost: 0,
              cacheWriteCost: 0,
              missingCostEntries: 0,
            },
          },
        ],
        byProvider: [],
        byAgent: [],
        byChannel: [],
        daily: [],
      },
    };
    app.connected = true;
    await app.updateComplete;

    const compactPageText = (app.textContent ?? "").replace(/\s+/g, " ");
    expect(compactPageText).toContain("计费状态: 缺少模型单价，费用不可计算");
    expect(compactPageText).not.toContain("定价: 输入 ¥0/百万");
  });

  it("runs the user path from API setup to chat model selection and token fee readback", async () => {
    const liveReadModel = {
      metrics: { configured: 1, available: 1, risky: 0, unbound: 0, blocked: 0 },
      groups: {
        model: [
          {
            id: "model-openai",
            name: "OpenAI",
            kind: "model",
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
            status: "available",
            riskStatus: "ok",
            secret: { mode: "plaintext", status: "configured" },
            consumers: ["model", "local_dialog", "developer_center", "role_execution"],
            configBindings: [{ path: "models.providers.openai" }],
            metadata: {
              defaultModel: "codex-bengalfox",
              availableModels: ["gpt-5.5", "codex-bengalfox"],
              modelValidation: {
                status: "needs_test",
                source: "manual_model_id",
              },
              pricing: {
                currency: "CNY",
                unit: "1M_tokens",
                inputCnyPerMillion: 8,
                outputCnyPerMillion: 32,
              },
              budget: { currency: "CNY", period: "day", dailyCny: 0.01 },
            },
          },
        ],
        tool_skill: [],
        marketplace: [],
        dialog: [],
      },
      riskReport: { items: [] },
    };
    const settlementReadModel = {
      ...liveReadModel,
      groups: {
        ...liveReadModel.groups,
        model: [
          {
            ...liveReadModel.groups.model[0],
            metadata: {
              ...liveReadModel.groups.model[0].metadata,
              metering: {
                calls: 1,
                inputTokens: 1280,
                outputTokens: 620,
                totalTokens: 1900,
                costCny: 0.03008,
                byConsumer: {
                  role_execution: {
                    calls: 1,
                    inputTokens: 1280,
                    outputTokens: 620,
                    totalTokens: 1900,
                    costCny: 0.03008,
                    lastUsageRef: "ui_role_execution:task-1",
                  },
                },
              },
            },
          },
        ],
      },
    };
    const usageResult = {
      updatedAt: Date.now(),
      startDate: "2026-06-16",
      endDate: "2026-06-16",
      sessions: [
        {
          key: "main",
          label: "本地主对话框",
          updatedAt: Date.now(),
          usage: {
            input: 400,
            output: 100,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 500,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 400,
                  output: 100,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 500,
                  totalCost: 0,
                  inputCost: 0,
                  outputCost: 0,
                  cacheReadCost: 0,
                  cacheWriteCost: 0,
                  missingCostEntries: 0,
                },
              },
            ],
          },
        },
        {
          key: "developer-center:role-builder",
          label: "开发者中心岗位包助手",
          channel: "developer_center",
          origin: { surface: "developer_center", label: "开发者中心" },
          updatedAt: Date.now(),
          usage: {
            input: 600,
            output: 400,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1000,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
            modelUsage: [
              {
                provider: "openai",
                model: "codex-bengalfox",
                count: 1,
                totals: {
                  input: 600,
                  output: 400,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 1000,
                  totalCost: 0,
                  inputCost: 0,
                  outputCost: 0,
                  cacheReadCost: 0,
                  cacheWriteCost: 0,
                  missingCostEntries: 0,
                },
              },
            ],
          },
        },
      ],
      totals: {
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1500,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      },
      aggregates: {
        messages: { total: 2, user: 1, assistant: 1, toolCalls: 0, toolResults: 0, errors: 0 },
        tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
        byModel: [
          {
            provider: "openai",
            model: "codex-bengalfox",
            count: 2,
            totals: {
              input: 1000,
              output: 500,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 1500,
              totalCost: 0,
              inputCost: 0,
              outputCost: 0,
              cacheReadCost: 0,
              cacheWriteCost: 0,
              missingCostEntries: 0,
            },
          },
        ],
        byProvider: [],
        byAgent: [],
        byChannel: [],
        daily: [],
      },
    };
    let currentReadModel: Record<string, unknown> = liveReadModel;
    const request = vi.fn(async (method: string) => {
      if (method === "aics.apiConnections.entry.create") {
        currentReadModel = liveReadModel;
        return { readModel: liveReadModel };
      }
      if (method === "aics.apiConnections.entry.materialize") {
        currentReadModel = liveReadModel;
        return { readModel: liveReadModel };
      }
      if (method === "aics.apiConnections.readModel.get") return currentReadModel;
      if (method === "models.list") {
        return {
          models: [
            { id: "gpt-5.5", name: "GPT-5.5", provider: "openai" },
            { id: "codex-bengalfox", name: "codex-bengalfox", provider: "openai" },
          ],
        };
      }
      if (method === "sessions.patch") return { ok: true, key: "main" };
      if (method === "sessions.usage") return usageResult;
      if (method === "usage.cost") return { updatedAt: Date.now(), days: 1, daily: [], totals: {} };
      if (method === "aics.toolSupply.readModel.get") return createToolSupplyReadModel();
      if (method === "aics.executionConsole.readModel.get") {
        return { roles: [], summary: { blockedRoles: 0 } };
      }
      if (method === "tools.effective") return { agentId: "main", profile: "coding", groups: [] };
      return {};
    });
    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.updateApiConnectionFormField("templateId", "openai");
    app.updateApiConnectionFormField("connectionMode", "direct");
    app.updateApiConnectionFormField("secretValue", "sk-test-openai");
    app.updateApiConnectionFormField("modelId", "codex-bengalfox");
    app.updateApiConnectionFormField("inputTokenPriceCnyPerMillion", "8");
    app.updateApiConnectionFormField("outputTokenPriceCnyPerMillion", "32");
    app.updateApiConnectionFormField("dailyBudgetCny", "0.01");
    await app.updateComplete;

    expectButtonWithText(app, "添加 API 连接").click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "aics.apiConnections.entry.create",
        expect.objectContaining({
          provider: "openai",
          metadata: expect.objectContaining({
            defaultModel: "codex-bengalfox",
            pricing: expect.objectContaining({
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            }),
            budget: expect.objectContaining({ dailyCny: 0.01 }),
          }),
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("aics.apiConnections.entry.materialize", {
        id: "model-openai",
      }),
    );
    await vi.waitFor(() =>
      expect(app.chatModelCatalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ provider: "openai", id: "codex-bengalfox" }),
        ]),
      ),
    );

    app.setTab("chat");
    await app.updateComplete;
    const modelOption = app.querySelector<HTMLButtonElement>(
      '[data-chat-model-option="openai/codex-bengalfox"]',
    );
    expect(modelOption).toBeInstanceOf(HTMLButtonElement);
    expect(modelOption?.textContent ?? "").toContain("codex-bengalfox");

    app.usageResult = usageResult;
    app.setTab("apiManagement");
    await vi.waitFor(() => expect(app.apiConnections.loading).toBe(false));
    await app.updateComplete;
    const apiText = (app.textContent ?? "").replace(/\s+/g, " ");
    expect(apiText).toContain("codex-bengalfox · openai");
    expect(apiText).toContain("本地主对话框");
    expect(apiText).toContain("开发者中心");
    expect(apiText).toContain("岗位执行");
    expect(apiText).toContain("用量：0 Token · 0 元");

    currentReadModel = settlementReadModel;
    app.apiConnections = {
      ...app.apiConnections,
      readModel: settlementReadModel,
    };
    app.aicsMainFlow = {
      loading: false,
      error: null,
      readModel: {
        version: 1,
        updatedAt: Date.now(),
        currentStage: "role",
        readiness: {},
        blockedReasons: [],
        latest: {
          roleResult: {
            id: "role_result-ui_role_execution:task-1",
            outcome: "succeeded",
            artifactRefs: [
              "ledger:role_execution:entitlement-zero-yuan-1:ui_role_execution:task-1",
              "audit:ui_role_execution:task-1:summary",
              "memory_candidate:ui_role_execution:task-1",
            ],
            executionEvidence: {
              modelUsage: {
                inputTokens: 1280,
                outputTokens: 620,
                totalTokens: 1900,
                costCents: 0,
              },
            },
          },
        },
        counts: { roleResults: 1 },
      },
    };
    app.setTab("usage");
    await vi.waitFor(() => expect(app.apiConnections.loading).toBe(false));
    await app.updateComplete;
    const billingText = (app.textContent ?? "").replace(/\s+/g, " ");
    expect(billingText).toContain("费用与授权");
    expect(billingText).toContain("执行次数 1");
    expect(billingText).toContain("Token用量");
    expect(billingText).toContain("费用 ¥");
  });

  it("reloads saved model API state into API management and billing readback", async () => {
    const persistedReadModel = {
      metrics: { configured: 1, available: 1, risky: 0, unbound: 0, blocked: 0 },
      entries: [
        {
          id: "model-openai",
          name: "OpenAI",
          kind: "model",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          authMode: "plaintext",
          status: "available",
          riskStatus: "warning",
          secret: { mode: "plaintext", status: "configured" },
          consumers: ["model", "local_dialog", "developer_center", "role_execution"],
          configBindings: [{ path: "models.providers.openai", owner: "apiConnections" }],
          metadata: {
            defaultModel: "codex-bengalfox",
            availableModels: ["gpt-5.5", "codex-bengalfox"],
            pricing: {
              currency: "CNY",
              unit: "1M_tokens",
              inputCnyPerMillion: 8,
              outputCnyPerMillion: 32,
            },
            budget: { currency: "CNY", period: "day", dailyCny: 0.01 },
            metering: {
              calls: 1,
              inputTokens: 1280,
              outputTokens: 620,
              totalTokens: 1900,
              costCny: 0.03008,
              lastUsageRef: "ui_role_execution:task-1",
              byConsumer: {
                role_execution: {
                  calls: 1,
                  inputTokens: 1280,
                  outputTokens: 620,
                  totalTokens: 1900,
                  costCny: 0.03008,
                  lastUsageRef: "ui_role_execution:task-1",
                },
              },
            },
          },
        },
      ],
      groups: {
        model: [],
        tool_skill: [],
        marketplace: [],
        dialog: [],
        custom: [],
      },
      riskReport: { items: [], counts: { blocking: 0, warning: 1, info: 0 } },
    };
    (persistedReadModel.groups.model as typeof persistedReadModel.entries) =
      persistedReadModel.entries;
    const request = vi.fn(async (method: string) => {
      if (method === "aics.apiConnections.readModel.get") return persistedReadModel;
      if (method === "usage.cost") return { updatedAt: Date.now(), days: 1, daily: [], totals: {} };
      if (method === "sessions.usage") {
        return { days: 1, daily: [], byModel: [], byProvider: [], byAgent: [], byChannel: [] };
      }
      if (method === "aics.toolSupply.readModel.get") return createToolSupplyReadModel();
      if (method === "aics.executionConsole.readModel.get") {
        return { roles: [], summary: { blockedRoles: 0 } };
      }
      return {};
    });

    const app = mountApp("/api-management");
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    await app.refreshApiConnectionsReadModel();
    await app.updateComplete;

    const apiText = (app.textContent ?? "").replace(/\s+/g, " ");
    expect(apiText).toContain("API 管理");
    expect(apiText).toContain("OpenAI");
    expect(apiText).toContain("codex-bengalfox · openai");
    expect(apiText).toContain("用量：1900 Token · 0.03008 元");

    app.remove();
    const reopened = mountApp("/api-management");
    reopened.client = { request, stop: vi.fn() } as never;
    reopened.connected = true;
    await reopened.refreshApiConnectionsReadModel();
    await reopened.updateComplete;

    const reopenedText = (reopened.textContent ?? "").replace(/\s+/g, " ");
    expect(reopenedText).toContain("OpenAI");
    expect(reopenedText).toContain("codex-bengalfox · openai");

    reopened.setTab("usage");
    await vi.waitFor(() => expect(reopened.apiConnections.loading).toBe(false));
    await reopened.updateComplete;
    const billingText = (reopened.textContent ?? "").replace(/\s+/g, " ");
    expect(billingText).toContain("费用与授权");
    expect(billingText).toContain("执行次数");
    expect(billingText).toContain("Token用量");
    expect(request).toHaveBeenCalledWith("aics.apiConnections.readModel.get", {});
  });

  it.skip("runs real observation collection from saved API management connections", async () => {
    const app = mountApp("/api-management");
    const request = vi.fn(async (method: string) => {
      if (method === "aics.mainFlow.observation.collect") {
        return { observationPackage: { id: "obs-api", title: "API 管理连接观察包" } };
      }
      if (method === "aics.mainFlow.readModel.get") {
        return {
          version: 1,
          updatedAt: Date.now(),
          currentStage: "observation",
          readiness: {},
          blockedReasons: [],
          latest: {
            observationPackage: {
              id: "obs-api",
              title: "API 管理连接观察包",
              status: "prepared",
              summary: "从 API 管理页连接采集",
              signals: [],
            },
          },
          counts: { observations: 1 },
        };
      }
      return { ok: true };
    });
    app.client = { request, stop: vi.fn() } as never;
    app.connected = true;
    app.apiConnections = {
      ...app.apiConnections,
      readModel: {
        metrics: { configured: 1, available: 1, risky: 0, unbound: 0, blocked: 0 },
        groups: {
          model: [],
          tool_skill: [],
          marketplace: [
            {
              id: "marketplace-dijie-cloud-bridge",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "http://127.0.0.1:9000",
              status: "available",
              riskStatus: "ok",
              secret: { mode: "secret_ref", id: "DIJIE_CLOUD_ACCESS_TOKEN", status: "configured" },
              consumers: ["marketplace"],
              configBindings: [{ path: "plugins.entries.aics.config.cloudBaseUrl" }],
            },
          ],
          dialog: [],
        },
        riskReport: { items: [] },
      },
    };
    await app.updateComplete;

    const button = expectButtonWithText(app, "生成数据分析包");
    expect(button.disabled).toBe(false);
    button.click();
    await nextFrame();
    await app.updateComplete;

    expect(request).toHaveBeenCalledWith("aics.mainFlow.observation.collect", {
      title: "API 管理连接观察包",
    });
    expect(app.tab).toBe("observation");
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
      "审核中心",
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
      "/review-center",
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
