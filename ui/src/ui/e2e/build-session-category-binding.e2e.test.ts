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
const describeBuildSessionBindingE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;
const sessionId = "session-bind-category-e2e";
const reviewId = "review-bind-category-e2e";
const categoryReviewId = "category-review-bind-category-e2e";

const requiredCapabilities = [
  "marketplace.read",
  "gateway.role_read_model",
  "ledger.summary.read",
  "audit.record",
  "document.write",
  "human.confirm",
  "model.chat.analysis",
];

const brief = {
  roleTitle: "商城运营诊断官",
  roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本。",
  targetUser: "岗位商城运营者",
  targetCategory: "商城运营",
  coreResponsibilities: ["观察岗位供给", "输出运营诊断"],
  taskExamples: ["检查授权转化"],
  dailySop: ["每天查看执行失败"],
  weeklySop: ["每周复盘品类能力缺口"],
  monthlySop: ["每月输出经营报告"],
  requiredCapabilities,
  inputTypes: ["商城经营数据"],
  outputTypes: ["诊断报告"],
  forbiddenActions: ["不自动上架"],
  qualityStandards: ["必须有审计记录"],
};

const roleReview = {
  approvedAt: null,
  boundCommonCapabilities: [],
  category: "",
  cloudPackageId: null,
  cloudPackageVersion: null,
  cloudRoleListingId: null,
  cloudRolePackageId: null,
  cloudSubmitStatus: "未提交",
  createdAt: now,
  developerId: "local-developer",
  id: reviewId,
  listingDraftId: sessionId,
  packageDir: "/tmp/openclaw-bind-category-e2e",
  requiredCapabilities,
  reviewDecision: "等待开发者绑定已激活品类。",
  reviewFindings: [
    {
      id: "finding-category",
      section: "能力绑定",
      severity: "blocking",
      message: "岗位尚未绑定正式品类。",
    },
  ],
  reviewStatus: "待审核",
  riskLevel: "中",
  rolePackageId: "商城运营诊断官",
  submitError: null,
  submittedAt: null,
  updatedAt: now,
  validationStatus: "未检查",
};

const activatedCategoryReview = {
  capabilityRefs: requiredCapabilities,
  catalogRefs: requiredCapabilities,
  categoryName: "商城运营",
  categoryPackRef: "categorypack:marketplace-ops@1",
  categoryRef: "category:marketplace-ops@1",
  cloudSyncError: null,
  cloudSyncStatus: "已同步",
  cloudSyncedAt: now,
  createdAt: now,
  developerId: "local-developer",
  id: categoryReviewId,
  inputOutput: "输入：商城经营数据\n输出：诊断报告",
  listingDraftId: sessionId,
  requestId: "category-request-bind-category-e2e",
  requiredCapabilities,
  reviewedAt: now,
  reviewedBy: "local-reviewer",
  reviewDecision: "本地版已写入正式品类能力目录，开发者可绑定该品类。",
  reviewFindings: [],
  reviewStatus: "已通过",
  riskBoundaries: ["不自动上架", "必须有审计记录"],
  roleDescription: brief.roleDescription,
  roleMaterials: {
    dailyPlan: "每天查看执行失败",
    inputOutput: "输入：商城经营数据\n输出：诊断报告",
    monthlyPlan: "每月输出经营报告",
    requiredCapabilities,
    riskBoundaries: ["不自动上架", "必须有审计记录"],
    roleDescription: brief.roleDescription,
    roleTitle: brief.roleTitle,
    targetCategory: "商城运营",
    targetUser: brief.targetUser,
    weeklyPlan: "每周复盘品类能力缺口",
  },
  rolePackageId: "商城运营诊断官",
  skillPackRef: "skillpack:marketplace-ops@1",
  targetUser: brief.targetUser,
  title: "商城运营品类能力",
  toolPackRef: "toolpack:marketplace-ops@1",
  toolSkillRequirements: [
    "tool.platform.marketplace_read_model",
    "skill.platform.marketplace_ops_diagnosis",
    "provider.platform.model_chat_analysis",
  ],
  updatedAt: now,
  workflowStatus: "category_review_approved",
};

describeBuildSessionBindingE2e("build session category binding control UI E2E", () => {
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

  it("lets the role developer bind an activated category from developer center, not review center", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 920, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.buildSession.create": {
          availableTemplates: [],
          createdAt: now,
          sessionId,
          state: "created",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: "创建商城运营诊断官。",
          validationErrors: [],
        },
        "aics.buildSession.generate": {
          capabilityAnalysis: {
            categoryCapabilityReview: activatedCategoryReview,
            categoryName: "商城运营",
            categoryRef: "category:marketplace-ops@1",
            existingCapabilities: requiredCapabilities,
            humanConfirmationCapabilities: ["human.confirm"],
            missingCapabilities: [],
            neededProviders: [],
            neededSkills: [],
            neededTools: [],
            nonAutomaticCapabilities: ["audit.record", "ledger.summary.read"],
            requiredCapabilities,
            roleTitle: "商城运营诊断官",
            toolSkillReviews: [],
          },
          files: ["manifest.json", "listing.md", "README.md", "SOP.md", "validation.md"],
          packageDir: "/tmp/openclaw-bind-category-e2e",
          review: roleReview,
          session: {
            brief,
            createdAt: now,
            outputPackageDir: "/tmp/openclaw-bind-category-e2e",
            sessionId,
            state: "completed",
            updatedAt: now,
            userConfirmations: ["用户确认 brief"],
            userRequirements: "创建商城运营诊断官。",
            validationErrors: [],
          },
          validationErrors: [],
        },
        "aics.buildSession.list": [],
        "aics.buildSession.startBriefing": {
          capabilityReport: undefined,
          createdAt: now,
          matchedTemplate: null,
          sessionId,
          state: "briefing",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: "创建商城运营诊断官。",
          validationErrors: [],
        },
        "aics.buildSession.submitBrief": {
          brief,
          createdAt: now,
          sessionId,
          state: "confirming",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: "创建商城运营诊断官。",
          validationErrors: [],
        },
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [activatedCategoryReview] },
        "aics.roleCapabilityAnalysis.create": {
          analysis: {
            categoryCapabilityReview: activatedCategoryReview,
            categoryName: "商城运营",
            categoryRef: "category:marketplace-ops@1",
            existingCapabilities: requiredCapabilities,
            humanConfirmationCapabilities: ["human.confirm"],
            missingCapabilities: [],
            neededProviders: [],
            neededSkills: [],
            neededTools: [],
            nonAutomaticCapabilities: ["audit.record", "ledger.summary.read"],
            requiredCapabilities,
            roleTitle: "商城运营诊断官",
            toolSkillReviews: [],
          },
        },
        "aics.rolePreListingReview.bindCategory": { ok: true },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [roleReview] },
        "aics.rolePreListingReview.runValidation": { ok: true },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.readModel.get": {
          apiBindings: [],
          authority: "openclaw_local",
          bindings: [],
          categories: [],
          cloudCapabilities: [],
          grants: [],
          localTools: [],
          metrics: {
            apiConnections: 0,
            available: 0,
            blocked: 0,
            cloudCapabilities: 0,
            disabled: 0,
            localTools: 0,
            pendingReview: 0,
            pluginTools: 0,
            risks: 0,
            skills: 0,
            total: 0,
          },
          packages: [],
          risks: [],
          skills: [],
          systemDevelopmentTodos: [],
          uniqueCapabilityRequests: [],
          updatedAt: now,
          version: 1,
        },
      },
    });

    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await page.evaluate(() => {
        const app = document.querySelector("openclaw-app") as
          | (HTMLElement & { startAicsDeveloperMode?: () => void })
          | null;
        if (!app?.startAicsDeveloperMode) throw new Error("developer mode action is unavailable");
        app.startAicsDeveloperMode();
      });

      await page.getByRole("heading", { name: "生成新岗位" }).waitFor({ timeout: 10_000 });
      await page.getByPlaceholder("输入岗位需求描述...").fill("创建商城运营诊断官。");
      await page.getByRole("button", { name: /开始匹配/ }).click();
      await page.getByRole("button", { name: /确认匹配/ }).click();
      await page.getByRole("button", { name: /保存 Brief/ }).click();
      await page.getByRole("button", { name: /一键确认\+生成/ }).click();
      await page.getByTestId("openclaw-review-center").waitFor({ timeout: 10_000 });

      expect(await page.getByRole("button", { name: "绑定推荐品类" }).count()).toBe(0);
      expect(await gateway.getRequests("aics.rolePreListingReview.bindCategory")).toHaveLength(0);

      await page.evaluate(() => {
        const app = document.querySelector("openclaw-app") as
          | (HTMLElement & { startAicsDeveloperMode?: () => void })
          | null;
        app?.startAicsDeveloperMode?.();
      });
      await page.getByText("可选品类").waitFor({ timeout: 10_000 });
      await page.getByText("商城运营 · category:marketplace-ops@1").waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "绑定品类" }).click();
      const bindRequest = await gateway.waitForRequest("aics.rolePreListingReview.bindCategory");
      expect(bindRequest.params).toEqual({
        categoryCapabilityReviewId: categoryReviewId,
        reviewId,
      });
      const validationRequest = await gateway.waitForRequest(
        "aics.rolePreListingReview.runValidation",
      );
      expect(validationRequest.params).toEqual({ reviewId });
    } finally {
      await context.close();
    }
  });
});
