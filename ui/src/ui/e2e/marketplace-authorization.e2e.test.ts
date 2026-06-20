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
const describeMarketplaceAuthorizationE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;
const roleListingId = "local_rolelisting_marketplace_ops";
const entitlementId = "local_entitlement_marketplace_ops";

const approvedRoleReview = {
  approvedAt: now,
  boundCommonCapabilities: [
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "document.write",
    "human.confirm",
    "model.chat.analysis",
  ],
  category: "category:marketplace-ops@1",
  cloudPackageId: null,
  cloudPackageVersion: null,
  cloudRoleListingId: null,
  cloudRolePackageId: null,
  cloudSubmitStatus: "未提交",
  createdAt: now,
  developerId: "local-admin",
  id: "review-marketplace-ops",
  listingDraftId: "draft-marketplace-ops",
  packageDir: "/tmp/openclaw-marketplace-ops",
  requiredCapabilities: [
    "marketplace.read",
    "gateway.role_read_model",
    "ledger.summary.read",
    "audit.record",
    "document.write",
    "human.confirm",
    "model.chat.analysis",
  ],
  reviewDecision: "人工确认通过，允许岗位开发者确认上架。",
  reviewFindings: [
    { id: "finding-structure", section: "结构", severity: "pass", message: "岗位包结构完整。" },
    {
      id: "finding-capability",
      section: "能力绑定",
      severity: "pass",
      message: "正式品类能力已绑定。",
    },
    {
      id: "finding-validation",
      section: "跑通性",
      severity: "pass",
      message: "本地 smoke 校验通过。",
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
  rolePackageId: "商城运营诊断官",
  submitError: null,
  submittedAt: null,
  updatedAt: now,
  validationStatus: "已通过",
};

function marketplaceRole(entitled = false) {
  return {
    authorizationFeeCents: 0,
    entitlementId: entitled ? entitlementId : undefined,
    entitlementStatus: entitled ? "authorized" : "missing",
    id: roleListingId,
    priceLabel: "0 元",
    roleListingId,
    source: "local",
    title: "商城运营诊断官",
  };
}

async function setCompletedDeveloperState(page: import("playwright").Page) {
  await page.evaluate(
    ({ review }) => {
      const app = document.querySelector("openclaw-app") as any;
      if (!app) throw new Error("openclaw-app not mounted");
      app.connected = true;
      app.aicsConversationMode = "developer";
      app.aicsConversationStage = "ready";
      app.buildSession = {
        availableTemplates: [],
        briefForm: {},
        capabilityAnalysis: null,
        error: null,
        generateResult: {
          files: ["manifest.json", "listing.md", "SOP.md", "validation.md"],
          packageDir: "/tmp/openclaw-marketplace-ops",
          review,
          validationErrors: [],
        },
        loading: false,
        requirements: "",
        session: {
          createdAt: Date.now(),
          sessionId: "session-marketplace-ops",
          state: "completed",
          updatedAt: Date.now(),
          userConfirmations: [],
          userRequirements: "创建商城运营岗位",
          validationErrors: [],
        },
        sessionId: "session-marketplace-ops",
        sessions: [],
        step: "completed",
      };
      app.reviewCenter = {
        actionBusyKey: null,
        categoryCapabilityReviews: [],
        error: null,
        eventsByReviewId: {},
        loading: false,
        roleReviews: [review],
        selectedCategoryCapabilityReviewId: null,
        selectedRoleReviewId: review.id,
      };
      app.aicsRoleBuilder = {
        ...app.aicsRoleBuilder,
        form: {
          ...app.aicsRoleBuilder.form,
          deviceId: "device-local",
          workspaceRef: "workspace-main",
        },
      };
      app.setTab("chat");
      app.requestUpdate();
    },
    { review: approvedRoleReview },
  );
}

describeMarketplaceAuthorizationE2e("marketplace authorization control UI E2E", () => {
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

  it("lets the role developer list an approved role, then create a formal zero-yuan entitlement", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.mainFlow.readModel.get": { counts: { roleResults: 0 }, objects: { roleResults: [] } },
        "aics.roleDeveloper.submitForListing": {
          cloud: { mode: "local", roleListingId },
          review: {
            ...approvedRoleReview,
            cloudRoleListingId: roleListingId,
            cloudSubmitStatus: "已提交",
            reviewStatus: "已提交上架",
            submittedAt: now,
          },
        },
        "aics.roles.mine.readModel.get": {
          readModel: {
            executionQueue: [],
            roleAssets: [],
          },
        },
        "dijie.marketplace.roles.list": {
          cases: [
            {
              response: {
                mode: "local",
                ok: true,
                roles: [marketplaceRole(false)],
              },
            },
          ],
        },
        "dijie.roleAuthorization.create": {
          entitlementId,
          mode: "local",
          ok: true,
          roleListingId,
        },
        "sessions.usage": { totals: {}, sessions: [] },
        "usage.cost": { daily: [], days: 1, totals: {}, updatedAt: now },
      },
    });

    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await setCompletedDeveloperState(page);

      await page.getByText("下一步：岗位开发者确认上架。").waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "开发者确认上架" }).click();

      const listingRequest = await gateway.waitForRequest("aics.roleDeveloper.submitForListing");
      expect(listingRequest.params).toEqual({ reviewId: "review-marketplace-ops" });
      await page.getByRole("heading", { name: "费用与授权" }).waitFor({ timeout: 10_000 });
      await page.getByText("商城运营诊断官").waitFor({ timeout: 10_000 });
      await page.getByText("授权价格：0 元").waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "创建 0 元正式授权" }).last().click();
      const authRequest = await gateway.waitForRequest("dijie.roleAuthorization.create");
      expect(authRequest.params).toEqual({
        device_id: "device-local",
        role_listing_id: roleListingId,
        workspace_ref: "workspace-main",
      });
      await page.getByRole("heading", { name: "派发中心" }).waitFor({ timeout: 10_000 });

      const roleListRequests = await gateway.getRequests("dijie.marketplace.roles.list");
      expect(roleListRequests.at(-1)?.params).toEqual({
        device_id: "device-local",
        includeUnauthorized: true,
        workspace_ref: "workspace-main",
      });
      const myRolesRequests = await gateway.getRequests("aics.roles.mine.readModel.get");
      expect(myRolesRequests.length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
