import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeApiManagementE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;
const cloudBridgeReadModel = {
  entries: [
    {
      id: "marketplace-dijie-cloud-bridge",
      name: "迭界AI云端",
      kind: "marketplace",
      provider: "dijie-cloud-bridge",
      baseUrl: "http://127.0.0.1:9000",
      consumers: [
        "marketplace",
        "operations_backend",
        "buyer_storefront",
        "user_center",
        "developer_center",
        "role_execution",
      ],
      configBindings: [
        { owner: "apiConnections", path: "plugins.entries.aics.config.cloudAccessToken" },
      ],
      enabled: true,
      riskStatus: "ok",
      secret: {
        id: "/entries/marketplace-dijie-cloud-bridge/secret",
        mode: "secret_ref",
        provider: "api-connections",
        source: "file",
        status: "configured",
      },
      status: "available",
    },
  ],
  groups: { marketplace: [] },
  metrics: { available: 1, blocked: 0, configured: 1, risky: 0, unbound: 0 },
  riskReport: { counts: { blocking: 0, info: 0, warning: 0 }, items: [] },
};

const modelReadModel = {
  entries: [
    {
      id: "model-openai",
      name: "OpenAI",
      kind: "model",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      consumers: [
        "model",
        "local_dialog",
        "operations_backend",
        "build_session",
        "buyer_storefront",
        "user_center",
        "developer_center",
        "ai_review",
        "role_execution",
        "image",
        "media_model",
      ],
      configBindings: [{ owner: "apiConnections", path: "models.providers.openai" }],
      enabled: true,
      metadata: {
        availableModels: ["gpt-5.5"],
        defaultModel: "gpt-5.5",
        metering: { calls: 0, costCny: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        pricing: {
          currency: "CNY",
          inputCnyPerMillion: 8,
          outputCnyPerMillion: 32,
          unit: "1M_tokens",
        },
      },
      riskStatus: "ok",
      secret: {
        id: "/entries/model-openai/secret",
        mode: "secret_ref",
        provider: "api-connections",
        source: "file",
        status: "configured",
      },
      status: "available",
    },
  ],
  groups: { model: [] },
  metrics: { available: 1, blocked: 0, configured: 1, risky: 0, unbound: 0 },
  riskReport: { counts: { blocking: 0, info: 0, warning: 0 }, items: [] },
};

describeApiManagementE2e("API management closed-loop control UI E2E", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(
        `Playwright Chromium is not installed at ${chromiumExecutablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a compatible browser, or set OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
      );
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("saves a Dijie cloud bridge token, applies it, refreshes local role read models, and runs readiness checks", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.entry.create": { readModel: cloudBridgeReadModel },
        "aics.apiConnections.entry.materialize": { readModel: cloudBridgeReadModel },
        "aics.apiConnections.entry.test": {
          connectionTest: { message: "迭界AI云端连接检查通过。", status: "passed" },
          ok: true,
          readModel: cloudBridgeReadModel,
        },
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.closedLoop.readiness.get": {
          mode: "local",
          status: "ready",
          checks: [
            { id: "api", label: "API", message: "API 已配置。", status: "pass" },
            { id: "roles", label: "我的岗位", message: "已授权岗位可读。", status: "pass" },
            { id: "execution", label: "执行", message: "本地执行链路可用。", status: "pass" },
          ],
          nextActions: [
            {
              id: "localEvidenceReadback",
              label: "本地审计账本读回",
              message: "本地 API、授权和执行队列已准备好，但还没有真实执行结果、审计和账本读回。",
              action: "到岗位执行页点击“运行任务”，确认真实 API 费用提示。",
            },
          ],
        },
        "aics.mainFlow.readModel.get": {
          counts: { roleResults: 0 },
          objects: { roleResults: [] },
        },
        "aics.roles.mine.readModel.get": {
          readModel: { executionQueue: [], roleAssets: [] },
        },
        "dijie.marketplace.roles.list": {
          mode: "local",
          ok: true,
          roles: [],
        },
        "sessions.usage": { sessions: [], totals: {} },
        "usage.cost": { daily: [], days: 1, totals: {}, updatedAt: now },
      },
    });

    try {
      await page.goto(`${server.baseUrl}api-management`);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await page.getByRole("heading", { name: /API (管理|供给中心)/ }).waitFor({
        timeout: 10_000,
      });

      await page.locator("select").first().selectOption("dijie-cloud-bridge");
      await page.locator('input[type="password"]').first().fill("local-dijie-token");
      await page.getByRole("button", { name: "添加 API 连接" }).click();

      const createRequest = await gateway.waitForRequest("aics.apiConnections.entry.create");
      expect(createRequest.params).toEqual(
        expect.objectContaining({
          authMode: "secret_ref",
          baseUrl: "http://127.0.0.1:9000",
          bindingPath: "plugins.entries.aics.config.cloudAccessToken",
          consumers: expect.arrayContaining([
            "marketplace",
            "developer_center",
            "user_center",
            "role_execution",
          ]),
          kind: "marketplace",
          managedSecretValue: "local-dijie-token",
          provider: "dijie-cloud-bridge",
        }),
      );
      await page.getByText("已应用到迭界AI云端连接。").waitFor({
        timeout: 10_000,
      });

      const materializeRequest = await gateway.waitForRequest(
        "aics.apiConnections.entry.materialize",
      );
      expect(materializeRequest.params).toEqual({ id: "marketplace-dijie-cloud-bridge" });
      expect((await gateway.getRequests("dijie.marketplace.roles.list")).length).toBeGreaterThan(0);
      expect((await gateway.getRequests("aics.roles.mine.readModel.get")).length).toBeGreaterThan(
        0,
      );
      expect((await gateway.getRequests("aics.mainFlow.readModel.get")).length).toBeGreaterThan(0);

      await page.getByRole("button", { name: "测试" }).last().click();
      const testRequest = await gateway.waitForRequest("aics.apiConnections.entry.test");
      expect(testRequest.params).toEqual({ id: "marketplace-dijie-cloud-bridge" });
      await page.getByText("迭界AI云端连接检查通过。").waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "闭环检查" }).first().click();
      const readinessRequest = await gateway.waitForRequest("aics.closedLoop.readiness.get");
      expect(readinessRequest.params).toEqual({ mode: "local" });
      await page
        .getByText(/闭环检查可继续：3 项检查已通过。下一步：到岗位执行页点击/)
        .waitFor({ timeout: 10_000 });
      await page.getByText("API 已配置。").waitFor();
      await page.getByText("已授权岗位可读。").waitFor();
      await page.getByText("本地执行链路可用。").waitFor();
      await page.getByText("本地模式 · 可继续").waitFor();
      await page.getByText("下一步", { exact: true }).first().waitFor();
      await page.getByText("到岗位执行页点击“运行任务”").first().waitFor();
      await page.getByText("现场验收标准").waitFor();
      await page.getByText(/执行结果、审计记录、账本记录、业务产物/).waitFor();
    } finally {
      await context.close();
    }
  });

  it("keeps cloud variable sync failures visible without blocking local mode", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const failedSyncReadModel = {
      ...modelReadModel,
      entries: [
        {
          ...(modelReadModel.entries[0] ?? {}),
          metadata: {
            ...((modelReadModel.entries[0]?.metadata ?? {}) as Record<string, unknown>),
            cloudVariableSync: {
              message: "401 Unauthorized",
              status: "failed",
            },
          },
        },
      ],
      metrics: { available: 0, blocked: 1, configured: 1, risky: 1, unbound: 0 },
      riskReport: {
        counts: { blocking: 1, info: 0, warning: 0 },
        items: [
          {
            code: "cloud_variable_sync_failed",
            entryId: "model-openai",
            message: "401 Unauthorized",
            severity: "blocking",
          },
        ],
      },
    };
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.entry.create": { readModel: modelReadModel },
        "aics.apiConnections.entry.materialize": { readModel: modelReadModel },
        "aics.apiConnections.entry.syncCloudVariables": {
          cloudVariableSync: { message: "401 Unauthorized", status: "failed" },
          ok: false,
          readModel: failedSyncReadModel,
        },
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.mainFlow.readModel.get": {
          counts: { roleResults: 0 },
          objects: { roleResults: [] },
        },
        "aics.roles.mine.readModel.get": {
          readModel: { executionQueue: [], roleAssets: [] },
        },
        "dijie.marketplace.roles.list": {
          mode: "local",
          ok: true,
          roles: [],
        },
        "models.list": { models: [{ id: "gpt-5.5", name: "gpt-5.5", provider: "openai" }] },
        "sessions.usage": { sessions: [], totals: {} },
        "usage.cost": { daily: [], days: 1, totals: {}, updatedAt: now },
      },
    });

    try {
      await page.goto(`${server.baseUrl}api-management`);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await page.getByRole("heading", { name: /API (管理|供给中心)/ }).waitFor({
        timeout: 10_000,
      });

      await page.locator("select").first().selectOption("openai");
      await page.locator('input[type="password"]').first().fill("sk-local-openai");
      await page.getByRole("button", { name: "添加 API 连接" }).click();
      await gateway.waitForRequest("aics.apiConnections.entry.create");
      await page.getByRole("button", { name: "同步云端" }).waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "同步云端" }).click();
      const syncRequest = await gateway.waitForRequest(
        "aics.apiConnections.entry.syncCloudVariables",
      );
      expect(syncRequest.params).toEqual({ id: "model-openai" });
      await page.getByText("401 Unauthorized").first().waitFor({ timeout: 10_000 });
      await page.getByText(/云端变量同步未完成（本地版可跳过）/).waitFor();
      await page
        .getByText(
          "本地版岗位创建和岗位执行不受影响；需要云端 SaaS、使用者中心或开发者中心云端同步时再处理云端桥接授权。",
        )
        .waitFor();
      await page.getByText("本地版可跳过", { exact: true }).waitFor();
    } finally {
      await context.close();
    }
  });
});
