import { chromium, type Browser, type Page } from "playwright";
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
const describeLocalMarketplaceHumanPath =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const now = 1_789_000_000_000;
const roleListingId = "local_rolelisting_marketplace_ops";
const entitlementId = "local_entitlement_marketplace_ops";
const dispatchRequestId = "dispatch-marketplace-ops";
const taskPackageId = "task-marketplace-ops";
const executionId = "exec-marketplace-ops";
const auditRecordId = "audit-exec-marketplace-ops";
const ledgerRef = `ledger:role_execution:${entitlementId}:${executionId}`;
const businessArtifactRef = "artifact:role-result:exec-marketplace-ops:summary";

const approvedRoleReview = {
  approvedAt: now,
  boundCommonCapabilities: ["marketplace.read", "audit.record"],
  category: "category:marketplace-ops-local@1",
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
  requiredCapabilities: ["marketplace.read", "audit.record"],
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

const marketplaceOpsBusinessDeliverables = [
  { label: "商城运营诊断报告", summary: "已生成本轮岗位商城运营诊断。" },
  { label: "岗位供给分析", summary: "已汇总岗位商品供给与品类覆盖。" },
  { label: "授权转化分析", summary: "已分析 0 元授权转化状态。" },
  { label: "执行成功率分析", summary: "已分析本地执行成功率。" },
  { label: "阻塞原因分析", summary: "已列出能力、授权、审计和账本阻塞。" },
  { label: "日/周/月运营建议", summary: "已输出日、周、月运营动作。" },
  { label: "下一步调度建议", summary: "已给出后续调度建议。" },
  { label: "审计摘要", summary: "已读回审计摘要。" },
  { label: "账本摘要", summary: "已读回账本摘要。" },
];

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

function authorizedRoleAsset() {
  return {
    authorizationFeeCents: 0,
    entitlementId,
    entitlementStatus: "authorized",
    priceLabel: "0 元",
    roleListingId,
    title: "商城运营诊断官",
  };
}

function materializedFlowReadModel() {
  return {
    blockedReasons: [],
    counts: { dispatchToRoleRequests: 1, roleResults: 0, taskPackages: 1 },
    currentStage: "role",
    executionPreflight: {
      blockedReasons: [],
      canRun: true,
      dispatchToRoleRequestId: dispatchRequestId,
      hasApiBinding: true,
      hasCostConfirmation: true,
      hasDispatchToRoleRequest: true,
      hasEntitlement: true,
      hasExecutionConfirmation: true,
      hasTaskPackage: true,
      hasToolSkillReadiness: true,
      taskPackageId,
    },
    latest: {
      dispatchToRoleRequest: {
        allowedSkills: ["skill.platform.marketplace_ops_diagnosis"],
        allowedTools: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
        confirmExecution: true,
        costConfirmed: true,
        entitlementId,
        id: dispatchRequestId,
        ledgerRef: `ledger:pending:${entitlementId}`,
        roleListingId,
        roleTitle: "商城运营诊断官",
        status: "ready",
      },
      roleResult: null,
      taskPackage: {
        expectedOutput: "商城运营诊断报告、日周月建议、审计摘要和账本摘要。",
        id: taskPackageId,
        status: "materialized",
        taskText: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断。",
        title: "商城运营诊断",
      },
    },
    objects: {
      dispatchToRoleRequests: [{ id: dispatchRequestId, status: "ready" }],
      roleResults: [],
      taskPackages: [{ id: taskPackageId, status: "materialized" }],
    },
    readiness: {
      canEnterRoleExecution: true,
      canRunApprovedTask: true,
    },
    updatedAt: now,
    version: 1,
  };
}

function readyMyRolesReadModel() {
  return {
    blockedReasons: [],
    executions: [
      {
        allowedSkills: ["skill.platform.marketplace_ops_diagnosis"],
        allowedTools: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
        canRun: true,
        confirmExecution: true,
        costConfirmed: true,
        dispatchRequestId,
        expectedOutput: "商城运营诊断报告、日周月建议、审计摘要和账本摘要。",
        id: dispatchRequestId,
        ledgerRef: `ledger:pending:${entitlementId}`,
        roleListingId,
        roleTitle: "商城运营诊断官",
        status: "ready",
        taskPackageId,
        taskText: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断。",
        title: "商城运营诊断",
      },
    ],
    roles: [authorizedRoleAsset()],
    summary: { artifactCount: 0, completed: 0, ready: 1, total: 1 },
  };
}

function completedMyRolesReadModel() {
  return {
    blockedReasons: [],
    executions: [
      {
        artifactRefs: [businessArtifactRef, `audit:${auditRecordId}`, ledgerRef],
        dispatchRequestId,
        expectedOutput: "商城运营诊断报告、日周月建议、审计摘要和账本摘要。",
        executionId,
        id: dispatchRequestId,
        result: {
          id: executionId,
          executionEvidence: {
            auditReadback: {
              auditRecordId,
              executionId,
              summary: "审计已记录商城运营诊断结果。",
              status: "completed",
            },
            businessDeliverables: marketplaceOpsBusinessDeliverables,
            costSummary: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              modelUsageCostCents: 0,
              source: "local_role_marketplace",
              totalCostCents: 0,
            },
            humanConfirmationRef: "human:confirm:dispatch-marketplace-ops:exec-marketplace-ops",
            ledgerReadback: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              ledgerRef,
              status: "recorded",
            },
            ledgerRef,
            modelUsage: {
              costCents: 0,
              inputTokens: 120,
              outputTokens: 80,
              provider: "test-model",
              totalTokens: 200,
            },
            toolUsage: { failedCalls: 0, successfulCalls: 4, totalToolCalls: 4 },
          },
          outcome: "succeeded",
          summary: "已完成商城运营诊断。",
        },
        roleListingId,
        roleTitle: "商城运营诊断官",
        status: "completed",
        taskPackageId,
        taskText: "观察岗位供给、授权转化、执行成功率、审计和账本，输出运营诊断。",
        title: "商城运营诊断",
        updatedAt: now,
      },
    ],
    roles: [authorizedRoleAsset()],
    summary: { artifactCount: 3, completed: 1, ready: 0, total: 1 },
  };
}

async function setCompletedDeveloperState(page: Page) {
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
          userRequirements: "创建商城运营诊断官",
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

async function setReadyExecutionState(page: Page) {
  await page.evaluate(
    ({ flow, myRoles }) => {
      const app = document.querySelector("openclaw-app") as any;
      if (!app) throw new Error("openclaw-app not mounted");
      app.connected = true;
      app.aicsMainFlow = { error: null, loading: false, readModel: flow };
      app.myRoles = {
        artifactPreviews: {},
        capabilityFilter: null,
        detailTab: "overview",
        error: null,
        loading: false,
        message: null,
        query: "",
        readModel: myRoles,
        runningExecutionId: null,
        selectedRoleKey: null,
        statusFilter: "all",
        viewMode: "queue",
      };
      app.aicsMarketplace = {
        error: null,
        loading: false,
        result: null,
        roles: [{ ...myRoles.roles[0], source: "local" }],
      };
      app.aicsRoleBuilder = {
        ...app.aicsRoleBuilder,
        form: {
          ...app.aicsRoleBuilder.form,
          entitlementId: myRoles.roles[0].entitlementId,
          roleListingId: myRoles.roles[0].roleListingId,
        },
      };
      app.setTab("aics");
      app.requestUpdate();
    },
    { flow: materializedFlowReadModel(), myRoles: readyMyRolesReadModel() },
  );
}

describeLocalMarketplaceHumanPath("local marketplace human path E2E", () => {
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

  it("lets a non-programmer click through listing, zero-yuan authorization, local execution, and evidence readback", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const confirmationMessages: string[] = [];
    page.on("dialog", (dialog) => {
      confirmationMessages.push(dialog.message());
      return dialog.accept();
    });
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.execution.artifact.get": {
          artifact: {
            dataUrl: "data:text/plain;base64,5ZWG5ZOB6L+Q6JCl6K+K5pat",
            kind: "document",
            mimeType: "text/plain",
            name: "marketplace-ops-summary.txt",
            ref: businessArtifactRef,
            sizeBytes: 32,
          },
          ok: true,
          status: "found",
        },
        "aics.execution.result.record": { ok: true },
        "aics.executionEvidence.readback.get": {
          audit: { auditRecordId, executionId, status: "completed" },
          ledger: { executionId, ledgerRef, status: "recorded" },
          ok: true,
          status: "found",
        },
        "aics.executionConsole.readModel.get": completedMyRolesReadModel(),
        "aics.mainFlow.readModel.get": materializedFlowReadModel(),
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
          readModel: completedMyRolesReadModel(),
          ...completedMyRolesReadModel(),
        },
        "dijie.marketplace.roles.list": {
          mode: "local",
          ok: true,
          roles: [marketplaceRole(false)],
        },
        "dijie.roleAuthorization.create": {
          entitlementId,
          mode: "local",
          ok: true,
          roleListingId,
        },
        "dijie.roleTask.run": {
          auditUpload: { auditRecordId },
          billingSummary: { ledgerRef },
          executionId,
          ok: true,
          roleResult: {
            artifactRefs: [businessArtifactRef],
            executionEvidence: {
              businessDeliverables: marketplaceOpsBusinessDeliverables,
              ledgerRef,
              modelUsage: { costCents: 0, inputTokens: 120, outputTokens: 80, totalTokens: 200 },
            },
            outcome: "succeeded",
            summary: "已完成商城运营诊断。",
          },
          status: "completed",
          summary: "已完成商城运营诊断。",
        },
        "sessions.usage": { sessions: [], totals: {} },
        "usage.cost": { daily: [], days: 1, totals: {}, updatedAt: now },
      },
    });

    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await setCompletedDeveloperState(page);

      await page.getByText("下一步：岗位开发者确认上架。").waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "开发者确认上架" }).click();
      expect((await gateway.waitForRequest("aics.roleDeveloper.submitForListing")).params).toEqual({
        reviewId: approvedRoleReview.id,
      });

      await page.getByRole("heading", { name: "费用与授权" }).waitFor({ timeout: 10_000 });
      await page.getByText("商城运营诊断官").first().waitFor({ timeout: 10_000 });
      await page.getByText(`${roleListingId} · 0 元`).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "创建 0 元正式授权" }).last().click();
      expect((await gateway.waitForRequest("dijie.roleAuthorization.create")).params).toEqual({
        device_id: "device-local",
        role_listing_id: roleListingId,
        workspace_ref: "workspace-main",
      });

      await page.getByRole("heading", { name: "派发中心" }).waitFor({ timeout: 10_000 });
      await setReadyExecutionState(page);
      await page.getByRole("heading", { name: "岗位执行 · 执行控制台" }).waitFor({
        timeout: 10_000,
      });
      await page.getByText("商城运营诊断官").first().waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "运行任务" }).waitFor({ timeout: 10_000 });
      await page.getByRole("button", { name: "运行任务" }).click();

      const runRequest = await gateway.waitForRequest("dijie.roleTask.run");
      expect(runRequest.params).toEqual(
        expect.objectContaining({
          confirmExecution: true,
          confirm_execution: true,
          costConfirmed: true,
          cost_confirmed: true,
          entitlement_id: entitlementId,
          role_listing_id: roleListingId,
          taskPackageId,
          dispatchToRoleRequestId: dispatchRequestId,
        }),
      );
      expect(confirmationMessages.at(-1)).toContain("岗位：商城运营诊断官");

      await gateway.waitForRequest("aics.execution.result.record");
      await gateway.waitForRequest("aics.executionEvidence.readback.get");
      await page
        .getByText("岗位任务已完成，执行结果、审计记录、账本记录和业务产物均已读回。")
        .waitFor({ timeout: 10_000 });
      await page.getByText("闭环证据完整").first().waitFor({ timeout: 10_000 });
      await page.getByText("业务明细").first().waitFor({ timeout: 10_000 });
      for (const deliverable of marketplaceOpsBusinessDeliverables) {
        await page
          .getByText(`${deliverable.label}：${deliverable.summary}`)
          .first()
          .waitFor({ timeout: 10_000 });
      }
      await page.getByText("账本：账本记录").first().waitFor({ timeout: 10_000 });
      await page.getByText("审计：审计记录 1").first().waitFor({ timeout: 10_000 });
      await page.getByText("费用摘要").first().waitFor({ timeout: 10_000 });
      await expect(page.getByText(ledgerRef).count()).resolves.toBe(0);
      await expect(page.getByText(`audit:${auditRecordId}`).count()).resolves.toBe(0);
    } finally {
      await context.close();
    }
  });
});
