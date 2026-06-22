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
const describeReviewCenterE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;

const approvedRoleReview = {
  approvedAt: now,
  boundCommonCapabilities: ["image.generation"],
  category: "image",
  cloudPackageId: null,
  cloudPackageVersion: null,
  cloudRoleListingId: null,
  cloudRolePackageId: null,
  cloudSubmitStatus: "未提交",
  createdAt: now,
  developerId: "developer-e2e",
  id: "review-e2e",
  listingDraftId: "draft-e2e",
  packageDir: "/tmp/openclaw-e2e-role-package",
  requiredCapabilities: ["image.generation"],
  reviewDecision: "人工确认通过，允许岗位开发者确认上架。",
  reviewFindings: [
    {
      id: "finding-structure",
      section: "结构",
      severity: "pass",
      message: "manifest.json 已存在。",
    },
    {
      id: "finding-capability",
      section: "能力绑定",
      severity: "pass",
      message: "能力绑定已通过。",
    },
    {
      id: "finding-validation",
      section: "跑通性",
      severity: "pass",
      message: "smoke test 已通过。",
    },
    {
      id: "finding-risk",
      section: "风险",
      severity: "pass",
      message: "未发现 secret、token 或用户私有数据。",
    },
    { id: "finding-quality", section: "合格性", severity: "pass", message: "综合检查通过。" },
  ],
  reviewStatus: "已通过",
  riskLevel: "低",
  rolePackageId: "pkg-e2e-review-center",
  submitError: null,
  submittedAt: null,
  updatedAt: now,
  validationStatus: "已通过",
};

describeReviewCenterE2e("review center control UI E2E", () => {
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

  it("opens the local review center without letting reviewers submit listings", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.rolePreListingReview.events": {
          events: [
            {
              action: "review.approve",
              createdAt: now,
              id: "event-approve",
              reviewId: "review-e2e",
              summary: "人工确认通过，允许岗位开发者确认上架。",
            },
          ],
        },
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": { reviews: [] },
        "aics.rolePreListingReview.list": { reviews: [approvedRoleReview] },
        "aics.toolSkillReview.list": {
          reviews: [
            {
              approvedAt: now,
              assetId: "image.generation",
              assetType: "skill",
              createdAt: now,
              declaredCapabilities: ["image.generation"],
              id: "tool-skill-review-e2e",
              reviewDecision: "人工确认通过，可绑定为品类通用能力。",
              reviewFindings: [
                {
                  id: "tool-finding",
                  section: "合格性",
                  severity: "pass",
                  message: "Skill 可绑定。",
                },
              ],
              reviewStatus: "已通过",
              riskLevel: "低",
              source: "platform",
              updatedAt: now,
              version: "1.0.0",
            },
          ],
        },
      },
    });

    try {
      await page.goto(`${server.baseUrl}review-center`);
      await page.getByTestId("openclaw-review-center").waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "pkg-e2e-review-center" }).click();
      await page
        .getByRole("heading", { name: "pkg-e2e-review-center" })
        .waitFor({ timeout: 10_000 });
      expect(await page.getByRole("heading", { name: "工具与 Skill 审核" }).count()).toBe(0);
      expect(await page.getByText("Skill · image.generation").count()).toBe(0);
      await page
        .getByText("审核已通过；请岗位开发者回到开发者中心确认上架。")
        .waitFor({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "提交上架" }).count()).resolves.toBe(0);
      const submitRequests = await gateway.getRequests(
        "aics.rolePreListingReview.submitForListing",
      );
      expect(submitRequests).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("activates approved category capabilities through the local page action", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.activateLocal": { ok: true },
        "aics.categoryCapabilityReview.events": {
          events: [
            {
              action: "categoryCapabilityReview.approve",
              createdAt: now,
              id: "event-category-approve",
              reviewId: "category-review-e2e",
              summary: "本地审核已通过，等待激活品类。",
            },
          ],
        },
        "aics.categoryCapabilityReview.list": {
          reviews: [
            {
              capabilityRefs: ["image.generation"],
              catalogRefs: ["image.generation"],
              categoryName: "图片审核",
              categoryPackRef: "categorypack:image-review@1",
              categoryRef: "category:image-review@1",
              cloudSyncError: null,
              cloudSyncStatus: "未同步",
              cloudSyncedAt: null,
              createdAt: now,
              developerId: "developer-e2e",
              id: "category-review-e2e",
              inputOutput: "输入图片，输出审核结果。",
              listingDraftId: "draft-e2e",
              requestId: "request-e2e",
              requiredCapabilities: ["image.generation"],
              reviewDecision: "本地审核已通过，等待激活品类。",
              reviewFindings: [],
              reviewedAt: now,
              reviewedBy: "local-reviewer",
              reviewStatus: "已通过",
              riskBoundaries: ["不自动发布"],
              roleDescription: "图片审核岗位。",
              rolePackageId: "pkg-e2e-review-center",
              skillPackRef: "skillpack:image-review@1",
              targetUser: "运营者",
              title: "图片审核品类能力",
              toolPackRef: "toolpack:image-review@1",
              toolSkillRequirements: ["image.generation"],
              updatedAt: now,
              workflowStatus: "category_review_approved",
            },
          ],
        },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [approvedRoleReview] },
        "aics.toolSkillReview.list": {
          reviews: [
            {
              approvedAt: now,
              assetId: "image.generation",
              assetType: "skill",
              createdAt: now,
              declaredCapabilities: ["image.generation"],
              id: "tool-skill-review-e2e",
              reviewDecision: "人工确认通过，可绑定为品类通用能力。",
              reviewFindings: [],
              reviewStatus: "已通过",
              riskLevel: "低",
              source: "platform",
              updatedAt: now,
              version: "1.0.0",
            },
          ],
        },
      },
    });

    try {
      await page.goto(`${server.baseUrl}review-center`);
      await page.getByTestId("openclaw-review-center").waitFor({ timeout: 10_000 });
      await page
        .locator("tr", { hasText: "图片审核" })
        .getByText("未激活")
        .waitFor({ timeout: 10_000 });
      await expect(page.getByText("未同步").count()).resolves.toBe(0);

      await page
        .locator("tr", { hasText: "图片审核" })
        .getByRole("button", { name: "查看" })
        .click();
      await page.getByRole("button", { name: "激活品类", exact: true }).click();
      const activationRequest = await gateway.waitForRequest(
        "aics.categoryCapabilityReview.activateLocal",
      );
      expect(activationRequest.params).toEqual({ reviewId: "category-review-e2e" });
      expect(await gateway.getRequests("aics.categoryCapabilityReview.syncToCloud")).toHaveLength(
        0,
      );
    } finally {
      await context.close();
    }
  });

  it("does not let the reviewer bind an activated category from the review page", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const pendingRoleReview = {
      ...approvedRoleReview,
      approvedAt: null,
      category: "",
      reviewDecision: null,
      reviewStatus: "待审核",
      validationStatus: "未检查",
    };
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": {
          reviews: [
            {
              capabilityRefs: ["image.generation"],
              catalogRefs: ["image.generation"],
              categoryName: "图片审核",
              categoryPackRef: "categorypack:image-review@1",
              categoryRef: "category:image-review@1",
              cloudSyncError: null,
              cloudSyncStatus: "已同步",
              cloudSyncedAt: now,
              createdAt: now,
              developerId: "developer-e2e",
              id: "category-review-e2e",
              inputOutput: "输入图片，输出审核结果。",
              listingDraftId: "draft-e2e",
              requestId: "request-e2e",
              requiredCapabilities: ["image.generation"],
              reviewDecision: "本地版已写入正式品类能力目录，开发者可绑定该品类。",
              reviewFindings: [],
              reviewedAt: now,
              reviewedBy: "local-reviewer",
              reviewStatus: "已通过",
              riskBoundaries: ["不自动发布"],
              roleDescription: "图片审核岗位。",
              rolePackageId: "pkg-e2e-review-center",
              skillPackRef: "skillpack:image-review@1",
              targetUser: "运营者",
              title: "图片审核品类能力",
              toolPackRef: "toolpack:image-review@1",
              toolSkillRequirements: ["image.generation"],
              updatedAt: now,
              workflowStatus: "category_review_approved",
            },
          ],
        },
        "aics.rolePreListingReview.bindCategory": { ok: true },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": { reviews: [pendingRoleReview] },
        "aics.rolePreListingReview.runValidation": { ok: true },
        "aics.toolSkillReview.list": { reviews: [] },
      },
    });

    try {
      await page.goto(`${server.baseUrl}review-center`);
      await page.getByTestId("openclaw-review-center").waitFor({ timeout: 10_000 });
      await page
        .locator("tr", { hasText: "图片审核" })
        .getByText("已激活")
        .waitFor({ timeout: 10_000 });
      expect(await page.getByText("推荐品类可绑定").count()).toBe(0);
      expect(await page.getByRole("button", { name: "绑定推荐品类" }).count()).toBe(0);
      expect(await gateway.getRequests("aics.rolePreListingReview.bindCategory")).toHaveLength(0);
      expect(await gateway.getRequests("aics.rolePreListingReview.runValidation")).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("only lets reviewers approve a role after it has an activated bound category", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const unboundPassingReview = {
      ...approvedRoleReview,
      approvedAt: null,
      category: "",
      id: "review-unbound-e2e",
      rolePackageId: "review-unbound-e2e",
      reviewDecision: "综合检查通过，但尚未绑定正式品类。",
      reviewFindings: [
        { id: "finding-pass", section: "合格性", severity: "pass", message: "综合检查通过。" },
      ],
      reviewStatus: "检查中",
      validationStatus: "已通过",
    };
    const boundPassingReview = {
      ...approvedRoleReview,
      approvedAt: null,
      category: "category:image-review@1",
      id: "review-bound-e2e",
      rolePackageId: "review-bound-e2e",
      reviewDecision: "综合检查通过，等待人工确认。",
      reviewFindings: [
        { id: "finding-pass", section: "合格性", severity: "pass", message: "综合检查通过。" },
      ],
      reviewStatus: "检查中",
      validationStatus: "已通过",
    };
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.categoryCapabilityReview.events": { events: [] },
        "aics.categoryCapabilityReview.list": {
          reviews: [
            {
              capabilityRefs: ["image.generation"],
              catalogRefs: ["image.generation"],
              categoryName: "图片审核",
              categoryPackRef: "categorypack:image-review@1",
              categoryRef: "category:image-review@1",
              cloudSyncError: null,
              cloudSyncStatus: "已同步",
              cloudSyncedAt: now,
              createdAt: now,
              developerId: "developer-e2e",
              id: "category-review-e2e",
              inputOutput: "输入图片，输出审核结果。",
              listingDraftId: "draft-e2e",
              requestId: "request-e2e",
              requiredCapabilities: ["image.generation"],
              reviewDecision: "本地版已写入正式品类能力目录，开发者可绑定该品类。",
              reviewFindings: [],
              reviewedAt: now,
              reviewedBy: "local-reviewer",
              reviewStatus: "已通过",
              riskBoundaries: ["不自动发布"],
              roleDescription: "图片审核岗位。",
              rolePackageId: "pkg-e2e-review-center",
              skillPackRef: "skillpack:image-review@1",
              targetUser: "运营者",
              title: "图片审核品类能力",
              toolPackRef: "toolpack:image-review@1",
              toolSkillRequirements: ["image.generation"],
              updatedAt: now,
              workflowStatus: "category_review_approved",
            },
          ],
        },
        "aics.rolePreListingReview.approve": { ok: true },
        "aics.rolePreListingReview.events": { events: [] },
        "aics.rolePreListingReview.list": {
          reviews: [unboundPassingReview, boundPassingReview],
        },
        "aics.toolSkillReview.list": { reviews: [] },
      },
    });

    try {
      await page.goto(`${server.baseUrl}review-center`);
      await page.getByTestId("openclaw-review-center").waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "review-unbound-e2e" }).click();
      await page.getByRole("heading", { name: "review-unbound-e2e" }).waitFor({
        timeout: 10_000,
      });
      const unboundApproveButton = page.getByRole("button", { name: "人工通过" });
      expect(await unboundApproveButton.isDisabled()).toBe(true);
      expect(await unboundApproveButton.getAttribute("title")).toBe(
        "请先由岗位开发者绑定已激活的正式品类。",
      );
      expect(await gateway.getRequests("aics.rolePreListingReview.approve")).toHaveLength(0);

      await page.getByRole("button", { name: "review-bound-e2e" }).click();
      await page.getByRole("heading", { name: "review-bound-e2e" }).waitFor({
        timeout: 10_000,
      });
      const boundApproveButton = page.getByRole("button", { name: "人工通过" });
      expect(await boundApproveButton.isEnabled()).toBe(true);
      await boundApproveButton.click();
      const approveRequest = await gateway.waitForRequest("aics.rolePreListingReview.approve");
      expect(approveRequest.params).toEqual({ reviewId: "review-bound-e2e" });
    } finally {
      await context.close();
    }
  });
});
