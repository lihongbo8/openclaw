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
const describeMainFlowExecutionE2e =
  chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

let browser: Browser;
let server: ControlUiE2eServer;

const roleListingId = "local_rolelisting_marketplace_ops";
const entitlementId = "local_entitlement_marketplace_ops";
const dispatchRequestId = "dispatch-1";
const taskPackageId = "task-1";
const executionId = "exec-marketplace-ops";
const ledgerRef = `ledger:role_execution:${entitlementId}:${executionId}`;
const auditRef = `audit:${executionId}:summary`;
const imageArtifactRef = "/tmp/aics-e2e/hero.png";
const htmlArtifactRef = "/tmp/aics-e2e/detail.html";
const summaryArtifactRef = "/tmp/aics-e2e/execution-summary.json";
const zipArtifactRef = "/tmp/aics-e2e/artifacts.zip";
const businessArtifactRefs = [
  imageArtifactRef,
  htmlArtifactRef,
  summaryArtifactRef,
  zipArtifactRef,
];
const executionSummaryArtifact = {
  title: "商品图和详情页生成任务",
  roleTitle: "电商美工执行官",
  category: "电商详情页",
  taskText: "为智能水杯生成一张商品主图和一个可打开的详情页。",
  deliverables: [
    { type: "image", name: "hero.png", ref: imageArtifactRef },
    { type: "detail_page", name: "detail.html", ref: htmlArtifactRef },
  ],
};

function authorizedRoleAsset() {
  return {
    authorizationFeeCents: 0,
    entitlementId,
    entitlementStatus: "authorized",
    priceLabel: "0 元",
    roleListingId,
    title: "电商美工执行官",
  };
}

function dispatchReadyReadModel() {
  return {
    blockedReasons: [],
    counts: { dispatchToRoleRequests: 0, roleResults: 0, taskPackages: 0 },
    currentStage: "dispatch",
    latest: {
      dispatchProposalReview: {
        id: "proposal-1",
        status: "confirmed",
      },
    },
    objects: {
      dispatchToRoleRequests: [],
      rolePlanItems: [
        {
          id: "role-plan-1",
          status: "confirmed",
          title: "商品图和详情页生成任务",
        },
      ],
      roleResults: [],
      taskPackages: [],
    },
    readiness: {
      canCreateDispatchProposal: false,
      canMaterializeTaskPackage: true,
    },
    updatedAt: 1,
    version: 1,
  };
}

function materializedReadModel() {
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
        allowedSkills: ["img:gen", "ws:write", "quality:check", "file:pack"],
        allowedTools: [
          "core.openai.image.generate",
          "core.workspace.detail.write",
          "core.artifact.quality.check",
          "core.artifact.package.bundle",
        ],
        confirmExecution: true,
        costConfirmed: true,
        entitlementId,
        id: dispatchRequestId,
        ledgerRef: `ledger:pending:${entitlementId}`,
        roleListingId,
        roleTitle: "电商美工执行官",
        status: "ready",
      },
      roleResult: null,
      taskPackage: {
        expectedOutput: "商品图、详情页 HTML、打包文件、审计记录和账本引用。",
        id: taskPackageId,
        status: "materialized",
        taskText: "为智能水杯生成一张商品主图和一个可打开的详情页。",
        title: "商品图和详情页派发单",
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
    updatedAt: 2,
    version: 1,
  };
}

function readyExecutionReadModel() {
  return {
    blockedReasons: [],
    executions: [
      {
        allowedSkills: ["img:gen", "ws:write", "quality:check", "file:pack"],
        allowedTools: [
          "core.openai.image.generate",
          "core.workspace.detail.write",
          "core.artifact.quality.check",
          "core.artifact.package.bundle",
        ],
        canRun: true,
        confirmExecution: true,
        costConfirmed: true,
        dispatchRequestId,
        expectedOutput: "商品图、详情页 HTML、打包文件、审计记录和账本引用。",
        id: dispatchRequestId,
        ledgerRef: `ledger:pending:${entitlementId}`,
        roleListingId,
        roleTitle: "电商美工执行官",
        status: "ready",
        taskPackageId,
        taskText: "为智能水杯生成一张商品主图和一个可打开的详情页。",
        title: "商品图和详情页生成任务",
      },
    ],
    roleAssets: [authorizedRoleAsset()],
    summary: { artifactCount: 0, completed: 0, ready: 1, total: 1 },
  };
}

function completedExecutionReadModel() {
  return {
    blockedReasons: [],
    executions: [
      {
        artifactRefs: [...businessArtifactRefs, auditRef, ledgerRef],
        dispatchRequestId,
        expectedOutput: "商品图、详情页 HTML、打包文件、审计记录和账本引用。",
        executionId,
        id: dispatchRequestId,
        result: {
          id: executionId,
          executionEvidence: {
            auditReadback: {
              executionId,
              status: "completed",
              summary: "已生成商品图、详情页和打包文件。",
            },
            ledgerReadback: {
              authorizationFeeCents: 0,
              executionFeeCents: 0,
              status: "recorded",
            },
            ledgerRef,
            modelUsage: {
              costCents: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
            steps: [
              { status: "completed", stepIndex: 1, stepName: "role_execution_analysis" },
              { status: "completed", stepIndex: 2, stepName: "image_generation" },
              { status: "completed", stepIndex: 3, stepName: "detail_page_write" },
              { status: "completed", stepIndex: 4, stepName: "artifact_package_bundle" },
            ],
            toolUsage: { failedCalls: 0, successfulCalls: 4, totalToolCalls: 4 },
          },
          outcome: "succeeded",
          summary: "已生成商品图、详情页和打包文件。",
        },
        roleListingId,
        roleTitle: "电商美工执行官",
        status: "completed",
        taskPackageId,
        taskText: "为智能水杯生成一张商品主图和一个可打开的详情页。",
        title: "商品图和详情页生成任务",
        updatedAt: Date.now(),
      },
    ],
    roleAssets: [authorizedRoleAsset()],
    summary: { artifactCount: 4, completed: 1, ready: 0, total: 1 },
  };
}

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

function marketplaceOpsCompletedExecutionReadModel() {
  return {
    blockedReasons: [],
    executions: [
      {
        artifactRefs: ["artifact:role-result:exec-marketplace-ops:summary", auditRef, ledgerRef],
        dispatchRequestId,
        expectedOutput: "商城运营诊断报告、原因归因、目标建议、调度建议、审计摘要和账本摘要。",
        executionId,
        id: dispatchRequestId,
        result: {
          id: executionId,
          executionEvidence: {
            auditReadback: {
              auditRecordId: "audit-exec-marketplace-ops",
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
            humanConfirmationRef: "human-confirmation:exec-marketplace-ops",
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
            steps: [
              { status: "completed", stepIndex: 1, stepName: "role_execution_analysis" },
              { status: "completed", stepIndex: 2, stepName: "marketplace_ops_diagnosis" },
            ],
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
        updatedAt: Date.now(),
      },
    ],
    roleAssets: [
      {
        ...authorizedRoleAsset(),
        title: "商城运营诊断官",
      },
    ],
    summary: { artifactCount: 3, completed: 1, ready: 0, total: 1 },
  };
}

async function setDispatchReadyState(page: Page) {
  await page.evaluate(
    ({ flow, role }) => {
      const app = document.querySelector("openclaw-app") as any;
      if (!app) throw new Error("openclaw-app not mounted");
      app.connected = true;
      app.aicsMainFlow = {
        error: null,
        loading: false,
        readModel: flow,
      };
      app.myRoles = {
        artifactPreviews: {},
        detailTab: "overview",
        error: null,
        loading: false,
        query: "",
        readModel: {
          executions: [],
          roleAssets: [role],
          summary: { total: 0 },
        },
        runningExecutionId: null,
        selectedRoleKey: null,
        statusFilter: "all",
        viewMode: "queue",
      };
      app.aicsMarketplace = {
        error: null,
        loading: false,
        result: null,
        roles: [],
      };
      app.aicsRoleBuilder = {
        auditRunning: false,
        error: null,
        form: {
          cloudAccessToken: "",
          deviceId: "",
          entitlementId: role.entitlementId,
          executionId: "",
          executionToken: "",
          roleListingId: role.roleListingId,
          workspaceRef: "",
        },
        result: null,
        running: false,
        tokenRunning: false,
      };
      app.setTab("workboard");
      app.requestUpdate();
    },
    { flow: dispatchReadyReadModel(), role: authorizedRoleAsset() },
  );
}

describeMainFlowExecutionE2e("main flow dispatch and role execution control UI E2E", () => {
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

  it("dispatches authorized work, runs the role task, and shows generated artifacts, audit and ledger readback", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.executionEvidence.readback.get": {
          ok: true,
          status: "found",
          audit: {
            auditRecordId: "audit-exec-marketplace-ops",
            executionId,
          },
          ledger: {
            ledgerRef,
            executionId,
          },
        },
        "aics.execution.result.record": { ok: true },
        "aics.execution.artifact.get": {
          cases: [
            {
              match: { artifactRef: imageArtifactRef, executionId },
              response: {
                artifact: {
                  dataUrl: "data:image/png;base64,ZmFrZS1wbmc=",
                  kind: "image",
                  mimeType: "image/png",
                  name: "hero.png",
                  ref: imageArtifactRef,
                  sizeBytes: 8,
                },
                ok: true,
                status: "found",
              },
            },
            {
              match: { artifactRef: htmlArtifactRef, executionId },
              response: {
                artifact: {
                  dataUrl: "data:text/html;base64,PGh0bWw+PC9odG1sPg==",
                  kind: "document",
                  mimeType: "text/html; charset=utf-8",
                  name: "detail.html",
                  ref: htmlArtifactRef,
                  sizeBytes: 128,
                },
                ok: true,
                status: "found",
              },
            },
            {
              match: { artifactRef: summaryArtifactRef, executionId },
              response: {
                artifact: {
                  dataUrl: `data:application/json;base64,${Buffer.from(
                    JSON.stringify(executionSummaryArtifact),
                  ).toString("base64")}`,
                  kind: "document",
                  mimeType: "application/json",
                  name: "execution-summary.json",
                  ref: summaryArtifactRef,
                  sizeBytes: 256,
                },
                ok: true,
                status: "found",
              },
            },
            {
              match: { artifactRef: zipArtifactRef, executionId },
              response: {
                artifact: {
                  dataUrl: "data:application/zip;base64,UEs=",
                  kind: "archive",
                  mimeType: "application/zip",
                  name: "artifacts.zip",
                  ref: zipArtifactRef,
                  sizeBytes: 512,
                },
                ok: true,
                status: "found",
              },
            },
          ],
        },
        "aics.executionConsole.readModel.get": completedExecutionReadModel(),
        "aics.mainFlow.dispatch.materializeTaskPackage": { ok: true },
        "aics.mainFlow.readModel.get": dispatchReadyReadModel(),
        "aics.roles.mine.readModel.get": {
          readModel: {
            roles: [authorizedRoleAsset()],
          },
          roles: [authorizedRoleAsset()],
          summary: { availableRoles: 1, totalRoles: 1 },
        },
        "dijie.marketplace.roles.list": {
          mode: "local",
          ok: true,
          roles: [authorizedRoleAsset()],
        },
        "aics.mainFlow.execution.confirmAndRun": {
          auditUpload: {
            auditRecordId: "audit-exec-marketplace-ops",
          },
          billingSummary: {
            ledgerRef,
          },
          executionId,
          ok: true,
          roleResult: {
            artifactRefs: businessArtifactRefs,
            executionEvidence: {
              ledgerRef,
              modelUsage: {
                costCents: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
              steps: [
                { status: "completed", stepIndex: 1, stepName: "role_execution_analysis" },
                { status: "completed", stepIndex: 2, stepName: "image_generation" },
                { status: "completed", stepIndex: 3, stepName: "detail_page_write" },
                { status: "completed", stepIndex: 4, stepName: "artifact_package_bundle" },
              ],
              toolUsage: { failedCalls: 0, successfulCalls: 4, totalToolCalls: 4 },
            },
          },
          status: "completed",
          summary: "已生成商品图、详情页和打包文件。",
        },
      },
    });

    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await setDispatchReadyState(page);
      await page.getByRole("heading", { name: "派发中心" }).waitFor({ timeout: 10_000 });

      await gateway.deferNext("aics.executionConsole.readModel.get");
      await page.getByRole("button", { name: "检查并派发" }).click();
      const executionQueueRequest = await gateway.waitForRequest(
        "aics.executionConsole.readModel.get",
      );
      expect(executionQueueRequest.params).toEqual({});
      await gateway.resolveDeferred(
        "aics.executionConsole.readModel.get",
        readyExecutionReadModel(),
      );

      const dispatchRequest = await gateway.waitForRequest(
        "aics.mainFlow.dispatch.materializeTaskPackage",
      );
      expect(dispatchRequest.params).toEqual(
        expect.objectContaining({
          request: {
            entitlementId,
            roleListingId,
          },
          title: "商品图和详情页生成任务 - 结构化岗位派发单",
        }),
      );
      await page.evaluate((flow) => {
        const app = document.querySelector("openclaw-app") as any;
        if (!app) throw new Error("openclaw-app not mounted");
        app.aicsMainFlow = {
          error: null,
          loading: false,
          readModel: flow,
        };
        app.requestUpdate();
      }, materializedReadModel());
      await page.getByRole("heading", { name: "岗位执行 · 执行控制台" }).waitFor({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "确认并运行" }).waitFor({ timeout: 10_000 });

      await page.getByRole("button", { name: "确认并运行" }).click();
      const runRequest = await gateway.waitForRequest("aics.mainFlow.execution.confirmAndRun");
      expect(runRequest.params).toEqual(
        expect.objectContaining({
          dispatchToRoleRequestId: dispatchRequestId,
          entitlementId,
          ledgerRef: `ledger:pending:${entitlementId}`,
          roleListingId,
          roleTitle: "电商美工执行官",
        }),
      );
      expect(await gateway.getRequests("aics.execution.result.record")).toHaveLength(0);
      expect(await gateway.getRequests("aics.executionEvidence.readback.get")).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("does not run or record a role task when the final real API confirmation is cancelled", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "aics.apiConnections.readModel.get": { entries: [] },
        "aics.execution.result.record": { ok: true },
        "aics.executionConsole.readModel.get": readyExecutionReadModel(),
        "aics.mainFlow.dispatch.materializeTaskPackage": { ok: true },
        "aics.mainFlow.readModel.get": materializedReadModel(),
        "aics.roles.mine.readModel.get": {
          readModel: {
            roles: [authorizedRoleAsset()],
          },
          roles: [authorizedRoleAsset()],
          summary: { availableRoles: 1, totalRoles: 1 },
        },
        "dijie.marketplace.roles.list": {
          mode: "local",
          ok: true,
          roles: [authorizedRoleAsset()],
        },
        "aics.mainFlow.execution.confirmAndRun": {
          ok: true,
          status: "completed",
        },
      },
    });

    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await page.evaluate(
        ({ executionReadModel, flow, role }) => {
          const app = document.querySelector("openclaw-app") as any;
          if (!app) throw new Error("openclaw-app not mounted");
          app.connected = true;
          app.aicsMainFlow = {
            error: null,
            loading: false,
            readModel: flow,
          };
          app.myRoles = {
            ...(app.myRoles ?? {}),
            loading: true,
          };
          app.setTab("aics");
          app.myRoles = {
            artifactPreviews: {},
            detailTab: "overview",
            error: null,
            loading: false,
            query: "",
            readModel: {
              ...executionReadModel,
              roleAssets: [role],
            },
            runningExecutionId: null,
            selectedRoleKey: null,
            statusFilter: "all",
            viewMode: "queue",
          };
          app.aicsMarketplace = {
            error: null,
            loading: false,
            result: null,
            roles: [],
          };
          app.aicsRoleBuilder = {
            auditRunning: false,
            error: null,
            form: {
              cloudAccessToken: "",
              deviceId: "",
              entitlementId: role.entitlementId,
              executionId: "",
              executionToken: "",
              roleListingId: role.roleListingId,
              workspaceRef: "",
            },
            result: null,
            running: false,
            tokenRunning: false,
          };
          app.setTab("aics");
          app.requestUpdate();
        },
        {
          executionReadModel: readyExecutionReadModel(),
          flow: materializedReadModel(),
          role: authorizedRoleAsset(),
        },
      );

      await page.getByRole("heading", { name: "岗位执行 · 执行控制台" }).waitFor({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "确认并运行" }).click();
      await gateway.waitForRequest("aics.mainFlow.execution.confirmAndRun");
      expect(await gateway.getRequests("aics.mainFlow.execution.confirmAndRun")).toHaveLength(1);
      expect(await gateway.getRequests("aics.execution.result.record")).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  it("shows marketplace-ops business deliverables after the local role execution completes", async () => {
    const context = await browser.newContext({
      locale: "zh-CN",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    try {
      await page.goto(server.baseUrl);
      await page.locator("openclaw-app").waitFor({ timeout: 10_000 });
      await setDispatchReadyState(page);
      await page.evaluate(
        ({ executionReadModel, flow }) => {
          const app = document.querySelector("openclaw-app") as any;
          if (!app) throw new Error("openclaw-app not mounted");
          app.connected = true;
          app.aicsMainFlow = {
            error: null,
            loading: false,
            readModel: flow,
          };
          app.myRoles = {
            ...(app.myRoles ?? {}),
            loading: true,
          };
          app.setTab("aics");
          app.myRoles = {
            artifactPreviews: {},
            detailTab: "overview",
            error: null,
            loading: false,
            query: "",
            readModel: executionReadModel,
            runningExecutionId: null,
            selectedRoleKey: null,
            statusFilter: "all",
            viewMode: "queue",
          };
          app.requestUpdate();
        },
        {
          executionReadModel: marketplaceOpsCompletedExecutionReadModel(),
          flow: {
            ...materializedReadModel(),
            latest: {
              ...materializedReadModel().latest,
              roleResult: marketplaceOpsCompletedExecutionReadModel().executions[0].result,
            },
          },
        },
      );

      await page.getByText("商城运营诊断官").first().waitFor({ timeout: 10_000 });
      await page.getByText("成果：已完成商城运营诊断。").first().waitFor({ timeout: 10_000 });
      const pageText = (await page.locator("body").innerText()).replace(/\s+/gu, " ");
      for (const deliverable of marketplaceOpsBusinessDeliverables) {
        expect(pageText).toContain(`${deliverable.label}：${deliverable.summary}`);
      }
      expect(pageText).toContain("审计记录 已读回");
      expect(pageText).toContain("账本记录 已读回");
      await page
        .getByTestId("openclaw-aics-local-operator")
        .getByRole("button", { name: "详情" })
        .click();
      await page.getByRole("heading", { name: "商城运营诊断" }).waitFor({ timeout: 10_000 });
      await page.getByText("费用摘要").first().waitFor({ timeout: 10_000 });
      await page.getByText("人工确认").first().waitFor({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });
});
