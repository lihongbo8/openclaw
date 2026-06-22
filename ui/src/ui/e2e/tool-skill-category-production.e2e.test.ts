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
const describeToolSkillProductionE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;

function createReadModel(reviewStatus: "待审核" | "检查中" | "已通过") {
  const reviewFindings =
    reviewStatus === "待审核"
      ? []
      : [
          {
            section: "合格性",
            severity: "pass",
            message: "Tool / Skill 依赖、权限、API 绑定和样例输入输出检查通过。",
          },
        ];
  return {
    authority: "openclaw_local",
    bindings: [],
    categories: [],
    cloudCapabilities: [],
    grants: [],
    localTools: [],
    metrics: {
      apiConnections: 0,
      available: reviewStatus === "已通过" ? 1 : 0,
      blocked: reviewStatus === "待审核" ? 1 : 0,
      cloudCapabilities: 0,
      disabled: 0,
      localTools: 0,
      pendingReview: reviewStatus === "已通过" ? 0 : 1,
      pluginTools: 0,
      risks: reviewStatus === "待审核" ? 1 : 0,
      skills: 0,
      total: 1,
    },
    packages: [],
    risks: [],
    skills: [],
    systemDevelopmentTodos: [
      {
        assetId: "tool.platform.marketplace_read_model",
        assetType: "tool",
        categoryCapabilityReviewId: "category-review-marketplace-ops",
        declaredCapabilities: ["marketplace.read", "gateway.role_read_model"],
        id: "tool-skill-development-marketplace-read-model",
        linkedReviewId: "tool-skill-review-marketplace-read-model",
        nextAction:
          reviewStatus === "已通过"
            ? {
                label: "已完成",
                reason: "该品类能力制作待办已通过，可激活正式品类能力包。",
              }
            : {
                label: "先检查",
                reason: "来自开发者中心的品类能力申请，需要在工具与 Skill 模块完成制作检查。",
              },
        reviewDecision: reviewStatus === "已通过" ? "人工确认通过，可绑定为品类通用能力。" : null,
        reviewFindings,
        reviewStatus,
        riskLevel: "中",
        source: "platform",
        sourceRequestId: "request-marketplace-ops",
        sourceRolePackageId: "pkg-marketplace-ops-local",
        targetCategoryName: "商城运营",
        targetCategoryRef: "category:marketplace-ops-local@1",
      },
    ],
    uniqueCapabilityRequests: [],
    updatedAt: now,
    version: 1,
  };
}

function createBlockingEvidenceReadModel() {
  return {
    authority: "openclaw_local",
    bindings: [],
    categories: [],
    cloudCapabilities: [],
    grants: [],
    localTools: [],
    metrics: {
      apiConnections: 0,
      available: 0,
      blocked: 2,
      cloudCapabilities: 0,
      disabled: 0,
      localTools: 0,
      pendingReview: 2,
      pluginTools: 0,
      risks: 2,
      skills: 0,
      total: 2,
    },
    packages: [],
    risks: [],
    skills: [],
    systemDevelopmentTodos: [
      {
        assetId: "skill.platform.marketplace_ops_diagnosis",
        assetType: "skill",
        categoryCapabilityReviewId: "category-review-marketplace-ops",
        declaredCapabilities: ["marketplace.read", "ledger.summary.read"],
        id: "tool-skill-development-marketplace-ops-diagnosis",
        linkedReviewId: "tool-skill-review-marketplace-ops-diagnosis",
        nextAction: {
          label: "修改后复查",
          reason: "当前检查存在 blocking 项，需要系统开发者修复后重新检查。",
        },
        reviewDecision: null,
        reviewFindings: [
          {
            section: "合格性",
            severity: "blocking",
            message: "未找到可用 Skill 实现 skill.platform.marketplace_ops_diagnosis。",
          },
        ],
        reviewStatus: "待开发者修改",
        riskLevel: "中",
        source: "platform",
        sourceRequestId: "request-marketplace-ops",
        sourceRolePackageId: "pkg-marketplace-ops-local",
        targetCategoryName: "商城运营",
        targetCategoryRef: "category:marketplace-ops-local@1",
      },
      {
        assetId: "provider.platform.model_chat_analysis",
        assetType: "tool",
        categoryCapabilityReviewId: "category-review-marketplace-ops",
        declaredCapabilities: ["model.chat.analysis"],
        id: "tool-skill-development-model-chat-analysis",
        linkedReviewId: "tool-skill-review-model-chat-analysis",
        nextAction: {
          label: "修改后复查",
          reason: "当前检查存在 blocking 项，需要系统开发者修复后重新检查。",
        },
        reviewDecision: null,
        reviewFindings: [
          {
            section: "合格性",
            severity: "blocking",
            message:
              "未找到可用 Provider/API 绑定 provider.platform.model_chat_analysis。请在 API 管理配置模型 API 后重新检查。",
          },
        ],
        reviewStatus: "待开发者修改",
        riskLevel: "中",
        source: "provider-api",
        sourceRequestId: "request-marketplace-ops",
        sourceRolePackageId: "pkg-marketplace-ops-local",
        targetCategoryName: "商城运营",
        targetCategoryRef: "category:marketplace-ops-local@1",
      },
    ],
    uniqueCapabilityRequests: [],
    updatedAt: now,
    version: 1,
  };
}

describeToolSkillProductionE2e("Tool and Skill category production control UI E2E", () => {
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

  it("keeps category capability production approval blocked until the todo is checked", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [] },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSkillDevelopment.runValidation": { ok: true },
        "aics.toolSupply.readModel.get": createReadModel("待审核"),
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByRole("heading", { name: "工具与 Skill" }).waitFor({ timeout: 10_000 });
      await page.getByRole("heading", { name: "品类能力制作待办" }).waitFor({
        timeout: 10_000,
      });
      await page.getByText("Tool/API · tool.platform.marketplace_read_model").waitFor({
        timeout: 10_000,
      });
      const approveButton = page.getByRole("button", { name: "通过审核" });
      expect(await approveButton.isDisabled()).toBe(true);
      expect(await approveButton.getAttribute("title")).toBe(
        "请先点击检查，检查通过后才能人工通过。",
      );

      await page.getByRole("button", { name: "检查" }).click();
      const validationRequest = await gateway.waitForRequest(
        "aics.toolSkillDevelopment.runValidation",
      );
      expect(validationRequest.params).toEqual({
        taskId: "tool-skill-development-marketplace-read-model",
        assetType: "tool",
        assetId: "tool.platform.marketplace_read_model",
        source: "platform",
        declaredCapabilities: ["marketplace.read", "gateway.role_read_model"],
      });
      expect(await gateway.getRequests("aics.toolSkillReview.approve")).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("lets system developers approve a checked category capability production todo", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [] },
        "aics.toolSkillReview.approve": { ok: true },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.readModel.get": createReadModel("检查中"),
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByRole("heading", { name: "品类能力制作待办" }).waitFor({
        timeout: 10_000,
      });
      await page.getByText("Tool / Skill 依赖、权限、API 绑定和样例输入输出检查通过。").waitFor({
        timeout: 10_000,
      });
      const approveButton = page.getByRole("button", { name: "通过审核" });
      expect(await approveButton.isEnabled()).toBe(true);

      await approveButton.click();
      const approveRequest = await gateway.waitForRequest("aics.toolSkillReview.approve");
      expect(approveRequest.params).toEqual({
        reviewId: "tool-skill-review-marketplace-read-model",
      });
    } finally {
      await context.close();
    }
  });

  it("keeps formal category activation blocked until all production todos pass", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [] },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.readModel.get": createReadModel("检查中"),
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByRole("heading", { name: "品类能力制作待办" }).waitFor({
        timeout: 10_000,
      });

      const activateButton = page.getByRole("button", { name: "激活并回岗位开发" });
      expect(await activateButton.isDisabled()).toBe(true);
      expect(await activateButton.getAttribute("title")).toBe("该品类能力包还有 1 项待办未通过。");
      expect(
        await gateway.getRequests("aics.toolSupply.categoryCapability.activateReadyPackage"),
      ).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("activates the formal category package from Tool and Skill after production todos pass", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [] },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.categoryCapability.activateReadyPackage": {
          ok: true,
          review: {
            id: "category-review-marketplace-ops",
            categoryRef: "category:marketplace-ops-local@1",
            cloudSyncStatus: "已同步",
          },
        },
        "aics.toolSupply.readModel.get": createReadModel("已通过"),
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByRole("heading", { name: "品类能力制作待办" }).waitFor({
        timeout: 10_000,
      });
      await page.getByText("品类能力包进度：1/1").waitFor({ timeout: 10_000 });

      const activateButton = page.getByRole("button", { name: "激活并回岗位开发" });
      expect(await activateButton.isEnabled()).toBe(true);
      await activateButton.click();

      const activationRequest = await gateway.waitForRequest(
        "aics.toolSupply.categoryCapability.activateReadyPackage",
      );
      expect(activationRequest.params).toEqual({
        categoryCapabilityReviewId: "category-review-marketplace-ops",
      });
    } finally {
      await context.close();
    }
  });

  it("shows real Skill and Provider API blockers before production approval", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [] },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.readModel.get": createBlockingEvidenceReadModel(),
      },
    });

    try {
      await page.goto(`${server.baseUrl}skills`);
      await page.getByRole("heading", { name: "品类能力制作待办" }).waitFor({
        timeout: 10_000,
      });

      const skillTodo = page.locator("article").filter({
        hasText: "Skill · skill.platform.marketplace_ops_diagnosis",
      });
      await skillTodo
        .getByText("未找到可用 Skill 实现 skill.platform.marketplace_ops_diagnosis。")
        .waitFor({ timeout: 10_000 });
      expect(await skillTodo.getByRole("button", { name: "通过审核" }).isDisabled()).toBe(true);

      const providerTodo = page.locator("article").filter({
        hasText: "Tool/API · provider.platform.model_chat_analysis",
      });
      await providerTodo
        .getByText("未找到可用 Provider/API 绑定 provider.platform.model_chat_analysis。")
        .waitFor({ timeout: 10_000 });
      expect(await providerTodo.getByRole("button", { name: "通过审核" }).isDisabled()).toBe(true);

      expect(await gateway.getRequests("aics.toolSkillReview.approve")).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});
