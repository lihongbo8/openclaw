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
const describeBuildSessionE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;
const sessionId = "session-marketplace-ops-e2e";
const reviewId = "review-marketplace-ops-e2e";
const categoryReviewId = "category-review-marketplace-ops-e2e";

const requirements = "创建商城运营岗位，观察授权转化、执行成功率、审计和账本。";

const marketplaceOpsBrief = {
  roleTitle: "商城运营诊断官",
  roleDescription: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断和调度建议。",
  targetUser: "岗位商城运营者",
  targetCategory: "商城运营",
  coreResponsibilities: ["观察岗位供给", "分析授权转化", "检查执行成功率", "回看审计和账本"],
  taskExamples: ["输出商城运营诊断报告", "发现品类能力和执行链路阻塞"],
  dailySop: ["查看授权转化、执行失败和审核阻塞"],
  weeklySop: ["复盘品类能力缺口、执行质量和费用收益"],
  monthlySop: ["汇总岗位商城经营表现和下一轮能力建设建议"],
  requiredCapabilities: [],
  inputTypes: ["岗位商品、授权、执行、审计和账本摘要"],
  outputTypes: ["运营诊断报告", "原因归因", "目标建议", "调度建议", "审计摘要"],
  forbiddenActions: ["不自动上架", "不绕过审核", "不绕过费用确认", "不读取原始账本明细"],
  qualityStandards: ["必须产生可回看的结果、审计记录和账本引用"],
};

const capabilityAnalysis = {
  roleTitle: "商城运营诊断官",
  categoryName: "商城运营",
  categoryRef: "category:marketplace-ops@1",
  requiredCapabilities: [
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "document.write",
    "human.confirm",
    "model.chat.analysis",
  ],
  neededTools: [
    "tool.platform.marketplace_read_model",
    "tool.platform.audit-record",
    "tool.platform.template_renderer",
  ],
  neededSkills: ["skill.platform.marketplace_ops_diagnosis"],
  neededProviders: ["provider.platform.model_chat_analysis"],
  existingCapabilities: ["human.confirm", "document.write"],
  missingCapabilities: [
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "model.chat.analysis",
  ],
  humanConfirmationCapabilities: ["human.confirm"],
  nonAutomaticCapabilities: ["audit.record"],
  categoryCapabilityReview: {
    id: categoryReviewId,
    workflowStatus: "waiting_category_review",
  },
  toolSkillReviews: [
    { assetId: "tool.platform.marketplace_read_model" },
    { assetId: "skill.platform.marketplace_ops_diagnosis" },
  ],
};

const roleReview = {
  approvedAt: null,
  boundCommonCapabilities: [],
  category: "category:marketplace-ops@1",
  cloudPackageId: null,
  cloudPackageVersion: null,
  cloudRoleListingId: null,
  cloudRolePackageId: null,
  cloudSubmitStatus: "未提交",
  createdAt: now,
  developerId: "local-developer",
  id: reviewId,
  listingDraftId: sessionId,
  packageDir: "/tmp/openclaw-marketplace-ops-e2e",
  requiredCapabilities: capabilityAnalysis.requiredCapabilities,
  reviewDecision: "需要先处理品类能力申请和品类能力制作待办。",
  reviewFindings: [
    {
      id: "finding-capability",
      section: "能力绑定",
      severity: "blocking",
      message: "品类 category:marketplace-ops@1 尚未通过本地审核并激活，需先提交品类能力申请。",
    },
  ],
  reviewStatus: "待审核",
  riskLevel: "中",
  rolePackageId: "商城运营诊断官",
  submitError: null,
  submittedAt: null,
  updatedAt: now,
  validationStatus: "待检查",
};

const categoryCapabilityReview = {
  capabilityRefs: capabilityAnalysis.requiredCapabilities,
  catalogRefs: [],
  categoryName: "商城运营",
  categoryPackRef: "category-pack:marketplace-ops@1",
  categoryRef: "category:marketplace-ops@1",
  cloudSyncError: null,
  cloudSyncStatus: "未同步",
  cloudSyncedAt: null,
  createdAt: now,
  developerId: "local-developer",
  id: categoryReviewId,
  inputOutput: "输入：岗位商品、授权、执行、审计和账本摘要\n输出：运营诊断报告、调度建议、审计摘要",
  listingDraftId: sessionId,
  requestId: "category-request-marketplace-ops-e2e",
  requiredCapabilities: capabilityAnalysis.requiredCapabilities,
  reviewedAt: null,
  reviewedBy: null,
  reviewDecision: "岗位缺少正式商城运营品类能力包，等待本地审核中心制作。",
  reviewFindings: [
    {
      id: "category-finding",
      section: "能力绑定",
      severity: "blocking",
      message: "需要系统开发者补齐 Tool / Skill / Provider 后审核。",
    },
  ],
  reviewStatus: "待审核",
  riskBoundaries: marketplaceOpsBrief.forbiddenActions,
  roleDescription: marketplaceOpsBrief.roleDescription,
  rolePackageId: "商城运营诊断官",
  skillPackRef: "skill-pack:marketplace-ops@1",
  targetUser: marketplaceOpsBrief.targetUser,
  title: "商城运营品类能力",
  toolPackRef: "tool-pack:marketplace-ops@1",
  toolSkillRequirements: [
    ...capabilityAnalysis.neededTools,
    ...capabilityAnalysis.neededSkills,
    ...capabilityAnalysis.neededProviders,
  ],
  updatedAt: now,
  workflowStatus: "waiting_category_review",
};

describeBuildSessionE2e("build session category request control UI E2E", () => {
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

  it("lets a role developer create a marketplace-ops role draft and surfaces the category-capability request in the local review center", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 920, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.buildSession.list": [],
        "aics.buildSession.create": {
          availableTemplates: [],
          createdAt: now,
          sessionId,
          state: "created",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: requirements,
          validationErrors: [],
        },
        "aics.buildSession.startBriefing": {
          capabilityReport: undefined,
          createdAt: now,
          matchedTemplate: null,
          sessionId,
          state: "briefing",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: requirements,
          validationErrors: [],
        },
        "aics.buildSession.submitBrief": {
          brief: marketplaceOpsBrief,
          createdAt: now,
          sessionId,
          state: "confirming",
          updatedAt: now,
          userConfirmations: [],
          userRequirements: requirements,
          validationErrors: [],
        },
        "aics.buildSession.confirm": {
          brief: marketplaceOpsBrief,
          createdAt: now,
          sessionId,
          state: "confirming",
          updatedAt: now,
          userConfirmations: ["用户确认 brief"],
          userRequirements: requirements,
          validationErrors: [],
        },
        "aics.buildSession.generate": {
          capabilityAnalysis,
          files: ["manifest.json", "listing.md", "SOP.md", "validation.md"],
          packageDir: "/tmp/openclaw-marketplace-ops-e2e",
          review: roleReview,
          session: {
            brief: marketplaceOpsBrief,
            createdAt: now,
            outputPackageDir: "/tmp/openclaw-marketplace-ops-e2e",
            sessionId,
            state: "completed",
            updatedAt: now,
            userConfirmations: ["用户确认 brief"],
            userRequirements: requirements,
            validationErrors: [],
          },
          validationErrors: [],
        },
        "aics.categoryCapabilityReview.events": {
          events: [
            {
              action: "categoryCapabilityRequest.create",
              createdAt: now,
              id: "category-event-e2e",
              reviewId: categoryReviewId,
              summary: "岗位缺少正式品类能力，已进入本地审核中心。",
            },
          ],
        },
        "aics.categoryCapabilityReview.list": { reviews: [categoryCapabilityReview] },
        "aics.roleCapabilityAnalysis.create": { analysis: capabilityAnalysis },
        "aics.rolePreListingReview.events": {
          events: [
            {
              action: "review.start",
              createdAt: now,
              id: "role-event-e2e",
              reviewId,
              summary: "岗位包已进入本地上架前审核。",
            },
          ],
        },
        "aics.rolePreListingReview.list": { reviews: [roleReview] },
        "aics.toolSkillReview.list": { reviews: [] },
        "aics.toolSupply.readModel.get": {
          categories: [],
          metrics: { available: 0, blocked: 0 },
          risks: [],
          skills: [],
          tools: [],
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
      await page.getByPlaceholder("输入岗位需求描述...").fill(requirements);
      await page.getByRole("button", { name: /开始匹配/ }).click();
      const createRequest = await gateway.waitForRequest("aics.buildSession.create");
      expect(createRequest.params).toEqual({ requirements });

      await page.getByRole("button", { name: /确认匹配/ }).click();
      await gateway.waitForRequest("aics.buildSession.startBriefing");
      await page.getByPlaceholder("岗位名称（必填）").waitFor({ timeout: 10_000 });
      await expect(page.getByPlaceholder("岗位名称（必填）").inputValue()).resolves.toBe(
        "商城运营诊断官",
      );

      await page.getByRole("button", { name: /保存 Brief/ }).click();
      const analysisRequest = await gateway.waitForRequest("aics.roleCapabilityAnalysis.create");
      expect(analysisRequest.params).toEqual(
        expect.objectContaining({
          dailyPlan: expect.stringContaining("查看授权转化"),
          inputOutput: expect.stringContaining("运营诊断报告"),
          listingDraftId: sessionId,
          monthlyPlan: expect.stringContaining("经营表现"),
          rolePackageId: "商城运营诊断官",
          roleTitle: "商城运营诊断官",
          targetUser: "岗位商城运营者",
          weeklyPlan: expect.stringContaining("品类能力缺口"),
        }),
      );
      await page.getByText("能力分析已生成").waitFor({ timeout: 10_000 });
      await page.getByText(/品类制作待办：\d+ 项，具体在工具与 Skill 模块处理。/).waitFor({
        timeout: 10_000,
      });

      await page.getByRole("button", { name: /一键确认\+生成/ }).click();
      await gateway.waitForRequest("aics.buildSession.generate");
      const reviewCenter = page.getByTestId("openclaw-review-center");
      await reviewCenter.waitFor({ timeout: 10_000 });
      await reviewCenter
        .getByRole("heading", { name: "品类能力申请" })
        .waitFor({ timeout: 10_000 });
      const categoryRow = reviewCenter
        .locator("tr", { hasText: "category:marketplace-ops@1" })
        .nth(1);
      await categoryRow.getByText("待审核").first().waitFor({ timeout: 10_000 });
      await categoryRow.getByRole("button", { name: "查看" }).click();
      await reviewCenter.getByText("品类能力 · 商城运营").waitFor({ timeout: 10_000 });
      await reviewCenter.getByText("能力包状态：待审核").waitFor({ timeout: 10_000 });
      await reviewCenter
        .getByText("等待审核员判断申请资料是否完整、是否需要制作新品类能力包。")
        .waitFor({
          timeout: 10_000,
        });
      await reviewCenter
        .getByText("岗位缺少正式商城运营品类能力包，等待本地审核中心制作。")
        .waitFor({
          timeout: 10_000,
        });

      expect((await gateway.getRequests("aics.rolePreListingReview.list")).length).toBeGreaterThan(
        0,
      );
      expect(
        (await gateway.getRequests("aics.categoryCapabilityReview.list")).length,
      ).toBeGreaterThan(0);
      expect((await gateway.getRequests("aics.toolSupply.readModel.get")).length).toBeGreaterThan(
        0,
      );
    } finally {
      await context.close();
    }
  });
});
