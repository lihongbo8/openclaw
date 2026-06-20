import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMemoryDb, closePipelineDb, closeRoleInstancesDb } from "../../aics-main-flow/db.js";
import {
  createZeroPriceLocalRoleEntitlement,
  publishLocalRoleListing,
  recordLocalRoleExecutionReadback,
} from "../../aics-main-flow/local-role-marketplace.js";
import { RoleInstanceStore } from "../../aics-main-flow/role-instance-store.js";
import { startRolePreListingReview } from "../../aics-main-flow/role-pre-listing-review.js";
import {
  AicsMainFlowStore,
  confirmAttribution,
  confirmDispatch,
  confirmGoal,
  confirmObservation,
  confirmPlanning,
  confirmRoleExecution,
  confirmRoleExecutionCost,
  createDispatchProposal,
  createGoalCandidate,
  materializeTaskPackage,
  prepareAttribution,
  prepareObservation,
  preparePlanning,
} from "../../aics-main-flow/store.js";
import { ToolRegistry } from "../../aics-main-flow/tool-registry.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { requireNodeSqlite } from "../../infra/node-sqlite.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";
import { createConfigWriteSnapshot } from "./config.test-helpers.js";

const readConfigFileSnapshotForWriteMock = vi.fn();
const validateConfigObjectWithPluginsMock = vi.fn();
const commitGatewayConfigWriteMock = vi.fn();
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const queueFollowUpMock = vi.fn();

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
    validateConfigObjectWithPlugins: validateConfigObjectWithPluginsMock,
  };
});

vi.mock("./config-write-flow.js", () => ({
  commitGatewayConfigWrite: commitGatewayConfigWriteMock,
}));

const { coreGatewayHandlers } = await import("../server-methods.js");

let currentConfig: OpenClawConfig;

function cloneConfig(config: OpenClawConfig): OpenClawConfig {
  return structuredClone(config) as OpenClawConfig;
}

beforeEach(() => {
  currentConfig = {};
  vi.clearAllMocks();
  validateConfigObjectWithPluginsMock.mockImplementation((config: OpenClawConfig) => ({
    ok: true,
    config,
  }));
  readConfigFileSnapshotForWriteMock.mockImplementation(async () =>
    createConfigWriteSnapshot(cloneConfig(currentConfig)),
  );
  commitGatewayConfigWriteMock.mockImplementation(
    async ({ nextConfig }: { nextConfig: OpenClawConfig }) => {
      currentConfig = cloneConfig(nextConfig);
      return {
        config: cloneConfig(currentConfig),
        queueFollowUp: queueFollowUpMock,
      };
    },
  );
});

afterEach(() => {
  closePipelineDb();
  closeRoleInstancesDb();
  closeMemoryDb();
  ToolRegistry._clear();
  vi.unstubAllGlobals();
});

async function callExecutionRun(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.execution.run"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: "req-aics-execution-run", method: "aics.execution.run", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

async function callRoleTaskRun(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["dijie.roleTask.run"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: "req-dijie-role-task-run", method: "dijie.roleTask.run", params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

async function callExecutionConsoleReadModel(): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.executionConsole.readModel.get"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-aics-execution-console",
      method: "aics.executionConsole.readModel.get",
      params: {},
    },
    params: {},
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

async function callExecutionResultRecord(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.execution.result.record"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-aics-execution-result-record",
      method: "aics.execution.result.record",
      params,
    },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

async function callExecutionEvidenceReadback(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.executionEvidence.readback.get"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-aics-execution-evidence-readback",
      method: "aics.executionEvidence.readback.get",
      params,
    },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

async function callExecutionArtifactGet(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const respond = vi.fn();
  const handler = coreGatewayHandlers["aics.execution.artifact.get"];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: {
      type: "req",
      id: "req-aics-execution-artifact-get",
      method: "aics.execution.artifact.get",
      params,
    },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond,
    context: {
      getRuntimeConfig: () => currentConfig,
    },
  } as never);
  expect(respond).toHaveBeenCalled();
  const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
  if (!ok) {
    throw new Error(JSON.stringify(error ?? payload));
  }
  return payload as Record<string, unknown>;
}

function prepareExecutableTask(
  store: AicsMainFlowStore,
  authorization: {
    roleListingId?: string;
    roleTitle?: string;
    entitlementId?: string;
    ledgerRef?: string;
  } = {},
): {
  taskPackageId: string;
  dispatchToRoleRequestId: string;
} {
  const obs = store.update((state) =>
    prepareObservation(state, {
      title: "岗位商城经营观察",
      summary: "岗位详情页转化需要优化",
      signals: [
        {
          id: "signal-listing-conversion",
          title: "岗位商品页转化",
          summary: "首批岗位详情页缺少清晰交付样例",
          evidenceRefs: ["evidence:marketplace:listings:conversion"],
        },
      ],
    }),
  );
  store.update((state) => confirmObservation(state, obs.id));
  const attr = store.update((state) =>
    prepareAttribution(state, {
      observationPackageId: obs.id,
      title: "岗位商城转化归因",
      summary: "商品页结构和交付样例不足",
      findings: [
        {
          id: "finding-listing-structure",
          title: "岗位详情结构不足",
          summary: "授权前缺少输出样例和适用边界说明",
          confidence: "high",
          observationSignalIds: ["signal-listing-conversion"],
        },
      ],
    }),
  );
  store.update((state) => confirmAttribution(state, attr.id));
  const goal = store.update((state) =>
    createGoalCandidate(state, {
      attributionReportId: attr.id,
      title: "提升岗位商城首批岗位授权转化与执行成功率",
      owner: "迭界AI",
      metric: "授权转化和执行成功率",
      target: "首批岗位可授权、可执行、可计费",
      rationale: "经营闭环目标",
    }),
  );
  store.update((state) => confirmGoal(state, goal.id));
  const plan = store.update((state) =>
    preparePlanning(state, {
      goalId: goal.id,
      title: "岗位详情页转化规划",
      summary: "调度电商美工优化岗位商品页",
      rolePlanItems: [
        {
          title: "岗位详情页展示优化",
          roleCapabilityRef: "role-ecommerce-designer",
          taskIntent: "输出首批岗位商品页的展示优化建议",
          expectedOutput: "岗位商品页结构和视觉转化建议",
        },
      ],
    }),
  );
  store.update((state) => confirmPlanning(state, plan.id));
  const proposal = store.update((state) =>
    createDispatchProposal(state, {
      planningPackageId: plan.id,
      title: "调度电商美工执行岗位商品页优化",
      riskSummary: "低风险，本地生成建议",
      confirmationSummary: "确认执行",
    }),
  );
  store.update((state) => confirmDispatch(state, proposal.id));
  const materialized = store.update((state) =>
    materializeTaskPackage(state, {
      title: "岗位商品页展示优化",
      taskText: "为首批岗位商品页输出展示优化、详情结构和视觉转化建议。",
      capabilityResolution: {
        categoryCapabilityId: "cloud:role-marketplace-design",
        category: "岗位商城",
        allowedTools: ["tool:model_prompt"],
        allowedSkills: ["skill:listing_optimization"],
        dispatchReady: true,
        blockedReasons: [],
      },
    }),
  );
  store.update((state) =>
    confirmRoleExecution(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      roleListingId: authorization.roleListingId ?? "role-ecommerce-designer",
      roleTitle: authorization.roleTitle ?? "电商美工",
      entitlementId: authorization.entitlementId ?? "entitlement-zero-yuan-1",
    }),
  );
  store.update((state) =>
    confirmRoleExecutionCost(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      entitlementId: authorization.entitlementId ?? "entitlement-zero-yuan-1",
      ledgerRef: authorization.ledgerRef ?? "ledger:entitlement-zero-yuan-1",
    }),
  );
  return {
    taskPackageId: materialized.taskPackage.id,
    dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
  };
}

describe("aics execution API metering", () => {
  it("records an explicit ledgerRef back into execution evidence for UI readback", async () => {
    await withStateDirEnv("aics-execution-result-record-", async () => {
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      });

      const result = await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId: "exec-local-1",
        ok: true,
        status: "completed",
        summary: "商城运营执行完成。",
        artifactRefs: ["artifact:role-result:exec-local-1:summary"],
        auditRecordId: "audit-local-1",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-1",
        executionEvidence: {
          humanConfirmationRef: "human:confirm:exec-local-1",
          costSummary: {
            authorizationFeeCents: 0,
            executionFeeCents: 0,
            modelUsageCostCents: 0,
            totalCostCents: 0,
            currency: "CNY",
            source: "local_ledger",
            ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-1",
          },
          businessDeliverables: [
            { label: "商城运营诊断报告", summary: "已生成本轮岗位商城运营诊断。" },
            { label: "岗位供给分析", summary: "已汇总岗位商品供给与品类覆盖。" },
            { label: "授权转化分析", summary: "已分析 0 元授权转化状态。" },
            { label: "执行成功率分析", summary: "已分析本地执行成功率。" },
            { label: "阻塞原因分析", summary: "已列出能力、授权、审计和账本阻塞。" },
            { label: "日/周/月运营建议", summary: "已给出日、周、月运营动作。" },
            { label: "下一步调度建议", summary: "已给出后续调度建议。" },
            { label: "审计摘要", summary: "已读回审计摘要。" },
            { label: "账本摘要", summary: "已读回账本摘要。" },
          ],
          modelUsage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            costCents: 0,
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        executionId: "exec-local-1",
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-1",
      });
      const readModel = new AicsMainFlowStore().readModel();
      const latestRoleResult = readModel.latest.roleResult as Record<string, unknown>;
      expect(latestRoleResult.executionEvidence).toMatchObject({
        ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-1",
        humanConfirmationRef: "human:confirm:exec-local-1",
        costSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          modelUsageCostCents: 0,
          totalCostCents: 0,
          currency: "CNY",
          source: "local_ledger",
          ledgerRef: "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-1",
        },
        businessDeliverables: expect.arrayContaining([
          expect.objectContaining({ label: "商城运营诊断报告" }),
          expect.objectContaining({ label: "岗位供给分析" }),
          expect.objectContaining({ label: "授权转化分析" }),
          expect.objectContaining({ label: "执行成功率分析" }),
          expect.objectContaining({ label: "阻塞原因分析" }),
          expect.objectContaining({ label: "日/周/月运营建议" }),
          expect.objectContaining({ label: "下一步调度建议" }),
          expect.objectContaining({ label: "审计摘要" }),
          expect.objectContaining({ label: "账本摘要" }),
        ]),
        modelUsage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          costCents: 0,
        },
      });
      expect(latestRoleResult.artifactRefs).toEqual(
        expect.arrayContaining([
          "artifact:role-result:exec-local-1:summary",
          "audit:audit-local-1",
        ]),
      );
    });
  });

  it("blocks successful result recording when artifact, audit, or ledger evidence is missing", async () => {
    await withStateDirEnv("aics-execution-result-record-missing-evidence-", async () => {
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      });

      const result = await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId: "exec-local-missing-evidence",
        ok: true,
        status: "completed",
        summary: "商城运营执行完成。",
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        blockedReasons: expect.arrayContaining([
          "岗位执行成功写回必须包含业务产物 artifactRefs。",
          "岗位执行成功写回必须包含真实审计记录 auditRecordId 或 auditRef。",
          "岗位执行成功写回必须包含真实账本引用 ledgerRef 或 ledgerEntryId。",
          "岗位执行成功写回必须包含模型费用证据 modelUsage，或明确声明本次未调用模型。",
        ]),
      });
      const readModel = new AicsMainFlowStore().readModel();
      expect(readModel.latest.roleResult).toBeNull();
    });
  });

  it("requires model usage evidence or an explicit no-model reason for successful result recording", async () => {
    await withStateDirEnv("aics-execution-result-record-missing-model-usage-", async () => {
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      });

      const result = await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId: "exec-local-missing-model-usage",
        ok: true,
        status: "completed",
        summary: "文件打包任务已完成。",
        artifactRefs: ["artifact:role-result:exec-local-missing-model-usage:zip"],
        auditRecordId: "audit-local-missing-model-usage",
        ledgerRef:
          "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-missing-model-usage",
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        blockedReasons: expect.arrayContaining([
          "岗位执行成功写回必须包含模型费用证据 modelUsage，或明确声明本次未调用模型。",
        ]),
      });
      expect(new AicsMainFlowStore().readModel().latest.roleResult).toBeNull();
    });
  });

  it("does not count audit or ledger refs as business artifacts when recording a successful result", async () => {
    await withStateDirEnv("aics-execution-result-record-audit-ledger-only-", async () => {
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        entitlementId: "local_entitlement_marketplace_ops",
        ledgerRef: "ledger:pending:local_entitlement_marketplace_ops",
      });

      const result = await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId: "exec-local-audit-ledger-only",
        ok: true,
        status: "completed",
        summary: "审计和账本已记录，但没有业务产物。",
        artifactRefs: [
          "audit:audit-local-audit-ledger-only",
          "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-audit-ledger-only",
        ],
        auditRecordId: "audit-local-audit-ledger-only",
        ledgerRef:
          "ledger:role_execution:local_entitlement_marketplace_ops:exec-local-audit-ledger-only",
        executionEvidence: {
          modelUsage: {
            totalTokens: 100,
            costCents: 0,
          },
        },
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        blockedReasons: expect.arrayContaining(["岗位执行成功写回必须包含业务产物 artifactRefs。"]),
      });
      expect(new AicsMainFlowStore().readModel().latest.roleResult).toBeNull();
    });
  });

  it("allows explicit tool-only execution evidence to complete after audit and ledger readback", async () => {
    await withStateDirEnv("aics-execution-result-record-tool-only-", async ({ tempRoot }) => {
      const review = startRolePreListingReview({
        packageDir: path.join(tempRoot, "pkg-tool-only"),
        rolePackageId: "pkg-tool-only",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["file.bundle"],
      });
      const listing = publishLocalRoleListing({
        reviewId: review.id,
        rolePackageId: "pkg-tool-only",
        title: "文件打包岗位",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["file.bundle"],
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
      });
      const executionId = "exec-tool-only";
      const auditRecordId = "local_audit_exec_tool_only";
      const ledgerRef = `ledger:role_execution:${entitlement.entitlementId}:${executionId}`;
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        roleListingId: listing.roleListingId,
        roleTitle: listing.title,
        entitlementId: entitlement.entitlementId,
        ledgerRef,
      });

      await expect(
        callExecutionResultRecord({
          taskPackageId: prepared.taskPackageId,
          dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
          executionId,
          ok: true,
          status: "completed",
          summary: "文件打包任务已完成，未调用模型。",
          artifactRefs: [`artifact:role-result:${executionId}:zip`],
          auditRecordId,
          ledgerRef,
          executionEvidence: {
            executionId,
            modelUsageNotApplicable: true,
            modelUsageNotApplicableReason: "本次文件打包由本地工具完成，未调用模型。",
          },
        }),
      ).resolves.toMatchObject({
        ok: true,
        executionId,
        ledgerRef,
      });

      recordLocalRoleExecutionReadback({
        auditRecordId,
        executionId,
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
        status: "completed",
        summary: "文件打包任务已完成，未调用模型。",
        ledgerRef,
        billingSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        },
      });
      await callExecutionEvidenceReadback({ executionId, auditRecordId, ledgerRef });

      expect(new AicsMainFlowStore().readModel().executionClosure).toMatchObject({
        status: "completed",
        evidenceReadback: {
          hasRoleResult: true,
          hasBusinessArtifact: true,
          hasAudit: true,
          hasLedger: true,
          hasModelUsage: true,
          modelUsageStatus: "not_applicable",
          modelUsageMessage: "本次文件打包由本地工具完成，未调用模型。",
        },
        missingEvidence: [],
      });
    });
  });

  it("returns only recorded role execution artifact bytes for UI preview and download", async () => {
    await withStateDirEnv("aics-execution-artifact-get-", async ({ tempRoot }) => {
      const workspaceDir = path.join(tempRoot, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });
      const imagePath = path.join(workspaceDir, "hero.png");
      const summaryPath = path.join(workspaceDir, "execution-summary.json");
      const summaryPayload = {
        title: "智能水杯详情页",
        roleTitle: "电商美工",
        category: "电商详情页",
      };
      await fs.writeFile(imagePath, Buffer.from(VALID_PNG_BASE64, "base64"));
      await fs.writeFile(summaryPath, JSON.stringify(summaryPayload), "utf8");
      const instance = RoleInstanceStore.ensureInstance({
        roleListingId: "role-ecommerce-designer",
        roleTitle: "电商美工",
        workspaceDir,
      });
      const run = RoleInstanceStore.recordRun({
        instanceId: instance.instanceId,
        taskPackageId: "task-product-page",
        executionId: "exec-artifact-preview",
        status: "completed",
        summary: "图片和详情页已生成。",
        artifactRefs: [imagePath, summaryPath],
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
      RoleInstanceStore.recordArtifacts({
        instanceId: instance.instanceId,
        executionId: "exec-artifact-preview",
        artifacts: [
          {
            artifactId: "artifact-hero",
            runId: run.runId,
            relPath: imagePath,
            kind: "image",
            sizeBytes: Buffer.byteLength(Buffer.from(VALID_PNG_BASE64, "base64")),
            createdAt: Date.now(),
          },
          {
            artifactId: "artifact-summary",
            runId: run.runId,
            relPath: summaryPath,
            kind: "document",
            sizeBytes: Buffer.byteLength(JSON.stringify(summaryPayload)),
            createdAt: Date.now(),
          },
        ],
      });

      await expect(
        callExecutionArtifactGet({
          executionId: "exec-artifact-preview",
          artifactRef: imagePath,
        }),
      ).resolves.toMatchObject({
        ok: true,
        status: "found",
        artifact: {
          name: "hero.png",
          mimeType: "image/png",
          encoding: "base64",
          dataUrl: `data:image/png;base64,${VALID_PNG_BASE64}`,
        },
      });
      const summaryArtifact = await callExecutionArtifactGet({
        executionId: "exec-artifact-preview",
        artifactRef: summaryPath,
      });
      expect(summaryArtifact).toMatchObject({
        ok: true,
        status: "found",
        artifact: {
          name: "execution-summary.json",
          mimeType: "application/json",
          encoding: "base64",
          dataUrl: `data:application/json;base64,${Buffer.from(JSON.stringify(summaryPayload)).toString("base64")}`,
        },
      });
      const summaryDataUrl = String((summaryArtifact.artifact as Record<string, unknown>).dataUrl);
      const summaryBase64 = summaryDataUrl.replace(/^data:application\/json;base64,/u, "");
      expect(JSON.parse(Buffer.from(summaryBase64, "base64").toString("utf8"))).toEqual(
        summaryPayload,
      );

      await expect(
        callExecutionArtifactGet({
          executionId: "exec-artifact-preview",
          artifactRef: path.join(workspaceDir, "not-recorded.png"),
        }),
      ).resolves.toMatchObject({
        ok: false,
        status: "not_found",
      });
    });
  });

  it("does not let one execution read another execution's same-named artifact", async () => {
    await withStateDirEnv("aics-execution-artifact-isolation-", async ({ tempRoot }) => {
      const workspaceOne = path.join(tempRoot, "exec-1");
      const workspaceTwo = path.join(tempRoot, "exec-2");
      await fs.mkdir(workspaceOne, { recursive: true });
      await fs.mkdir(workspaceTwo, { recursive: true });
      const imageOne = path.join(workspaceOne, "hero.png");
      const imageTwo = path.join(workspaceTwo, "hero.png");
      await fs.writeFile(imageOne, Buffer.from("first-image"));
      await fs.writeFile(imageTwo, Buffer.from("second-image"));
      const instance = RoleInstanceStore.ensureInstance({
        roleListingId: "role-ecommerce-designer",
        roleTitle: "电商美工",
        workspaceDir: workspaceOne,
      });
      const firstRun = RoleInstanceStore.recordRun({
        instanceId: instance.instanceId,
        taskPackageId: "task-product-page-1",
        executionId: "exec-1",
        status: "completed",
        summary: "第一条任务已生成图片。",
        artifactRefs: [imageOne],
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
      const secondRun = RoleInstanceStore.recordRun({
        instanceId: instance.instanceId,
        taskPackageId: "task-product-page-2",
        executionId: "exec-2",
        status: "completed",
        summary: "第二条任务已生成图片。",
        artifactRefs: [imageTwo],
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
      RoleInstanceStore.recordArtifacts({
        instanceId: instance.instanceId,
        executionId: "exec-1",
        artifacts: [
          {
            artifactId: "artifact-hero-1",
            runId: firstRun.runId,
            relPath: imageOne,
            kind: "image",
            sizeBytes: Buffer.byteLength("first-image"),
            createdAt: Date.now(),
          },
        ],
      });
      RoleInstanceStore.recordArtifacts({
        instanceId: instance.instanceId,
        executionId: "exec-2",
        artifacts: [
          {
            artifactId: "artifact-hero-2",
            runId: secondRun.runId,
            relPath: imageTwo,
            kind: "image",
            sizeBytes: Buffer.byteLength("second-image"),
            createdAt: Date.now(),
          },
        ],
      });

      await expect(
        callExecutionArtifactGet({
          executionId: "exec-2",
          artifactRef: imageOne,
        }),
      ).resolves.toMatchObject({
        ok: false,
        status: "not_found",
      });
      await expect(
        callExecutionArtifactGet({
          executionId: "exec-2",
          artifactRef: imageTwo,
        }),
      ).resolves.toMatchObject({
        ok: true,
        status: "found",
        artifact: {
          name: "hero.png",
          dataUrl: `data:image/png;base64,${Buffer.from("second-image").toString("base64")}`,
        },
      });
    });
  });

  it("updates main flow execution closure only after audit and ledger readback are written back", async () => {
    await withStateDirEnv("aics-execution-closure-readback-sync-", async ({ tempRoot }) => {
      const review = startRolePreListingReview({
        packageDir: path.join(tempRoot, "pkg-closure-sync"),
        rolePackageId: "pkg-closure-sync",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const listing = publishLocalRoleListing({
        reviewId: review.id,
        rolePackageId: "pkg-closure-sync",
        title: "商城运营诊断官",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
      });
      const executionId = "exec-closure-readback-sync";
      const auditRecordId = "local_audit_exec_closure_readback_sync";
      const ledgerRef = `ledger:role_execution:${entitlement.entitlementId}:${executionId}`;
      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        roleListingId: listing.roleListingId,
        roleTitle: listing.title,
        entitlementId: entitlement.entitlementId,
        ledgerRef,
      });

      await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId,
        ok: true,
        status: "completed",
        summary: "商城运营执行完成。",
        artifactRefs: [`artifact:role-result:${executionId}:summary`],
        auditRecordId,
        ledgerRef,
        executionEvidence: {
          executionId,
          modelUsage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            costCents: 0,
          },
        },
      });

      const missingReadback = new AicsMainFlowStore().readModel().executionClosure;
      expect(missingReadback).toMatchObject({
        status: "blocked",
        missingEvidence: expect.arrayContaining(["审计记录未读回", "账本记录未读回"]),
      });

      recordLocalRoleExecutionReadback({
        auditRecordId,
        executionId,
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
        status: "completed",
        summary: "商城运营执行完成。",
        ledgerRef,
        billingSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        },
      });
      await expect(
        callExecutionEvidenceReadback({ executionId, auditRecordId, ledgerRef }),
      ).resolves.toMatchObject({
        ok: true,
        status: "found",
        audit: { auditRecordId, executionId },
        ledger: { ledgerRef, executionId },
      });

      expect(new AicsMainFlowStore().readModel().executionClosure).toMatchObject({
        status: "completed",
        businessResult: {
          summary: "商城运营执行完成。",
          artifactRefs: [`artifact:role-result:${executionId}:summary`],
        },
        evidenceReadback: {
          hasRoleResult: true,
          hasBusinessArtifact: true,
          hasAudit: true,
          hasLedger: true,
          hasModelUsage: true,
        },
        missingEvidence: [],
      });
    });
  });

  it("requires both audit and ledger readback facts before reporting execution evidence found", async () => {
    await withStateDirEnv("aics-execution-readback-strict-", async ({ tempRoot, stateDir }) => {
      const review = startRolePreListingReview({
        packageDir: path.join(tempRoot, "pkg-marketplace-ops"),
        rolePackageId: "pkg-marketplace-ops",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const listing = publishLocalRoleListing({
        reviewId: review.id,
        rolePackageId: "pkg-marketplace-ops",
        title: "商城运营诊断官",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
      });
      recordLocalRoleExecutionReadback({
        auditRecordId: "local_audit_exec_strict",
        executionId: "exec-strict",
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
        status: "completed",
        summary: "商城运营执行完成。",
        ledgerRef: `ledger:role_execution:${entitlement.entitlementId}:exec-strict`,
        billingSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        },
      });

      const db = new (requireNodeSqlite().DatabaseSync)(path.join(stateDir, "aics-pipeline.db"));
      try {
        db.prepare("DELETE FROM local_role_ledger_entries WHERE execution_id = ?").run(
          "exec-strict",
        );
      } finally {
        db.close();
      }

      await expect(
        callExecutionEvidenceReadback({ executionId: "exec-strict" }),
      ).resolves.toMatchObject({
        ok: false,
        status: "missing",
        audit: { auditRecordId: "local_audit_exec_strict" },
        ledger: null,
        blockedReasons: ["本地执行证据不完整：账本记录缺失。"],
      });
    });
  });

  it("surfaces missing role execution API binding before the user clicks run", async () => {
    await withStateDirEnv("aics-execution-api-preflight-", async () => {
      currentConfig = {};
      const prepared = prepareExecutableTask(new AicsMainFlowStore());
      const readModel = await callExecutionConsoleReadModel();
      const executions = readModel.executions as Array<Record<string, unknown>>;

      expect(readModel.blockedReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "missing_api_binding",
            message: expect.stringContaining("API 管理"),
          }),
        ]),
      );
      expect(executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: prepared.dispatchToRoleRequestId,
            taskPackageId: prepared.taskPackageId,
            status: "blocked",
            canRun: false,
            blockedReason: "missing_api_binding",
          }),
        ]),
      );
    });
  });

  it("orders execution console tasks by the most recent dispatch update", async () => {
    await withStateDirEnv("aics-execution-console-order-", async () => {
      currentConfig = {};
      const store = new AicsMainFlowStore();
      const older = prepareExecutableTask(store, {
        roleTitle: "旧任务岗位",
        entitlementId: "entitlement-old",
        ledgerRef: "ledger:old",
      });
      const newer = {
        taskPackageId: `${older.taskPackageId}-newer`,
        dispatchToRoleRequestId: `${older.dispatchToRoleRequestId}-newer`,
      };

      store.update((state) => {
        const oldTask = state.taskPackages.find((task) => task.id === older.taskPackageId);
        const oldRequest = state.dispatchToRoleRequests.find(
          (request) => request.id === older.dispatchToRoleRequestId,
        );
        if (!oldTask || !oldRequest) throw new Error("missing prepared dispatch request");
        state.taskPackages.push({
          ...oldTask,
          id: newer.taskPackageId,
          title: "新任务详情页执行",
          updatedAt: 200,
          createdAt: 200,
        });
        state.dispatchToRoleRequests.push({
          ...oldRequest,
          id: newer.dispatchToRoleRequestId,
          taskPackageId: newer.taskPackageId,
          roleTitle: "新任务岗位",
          entitlementId: "entitlement-new",
          ledgerRef: "ledger:new",
          updatedAt: 200,
          createdAt: 200,
        });
        oldRequest.updatedAt = 100;
        oldRequest.createdAt = 100;
        oldTask.updatedAt = 100;
        oldTask.createdAt = 100;
        state.updatedAt = 200;
      });

      const readModel = await callExecutionConsoleReadModel();
      const executions = readModel.executions as Array<Record<string, unknown>>;

      expect(executions.slice(0, 2).map((execution) => execution.dispatchRequestId)).toEqual([
        newer.dispatchToRoleRequestId,
        older.dispatchToRoleRequestId,
      ]);
      expect(readModel.latest).toMatchObject({
        dispatchRequestId: newer.dispatchToRoleRequestId,
        updatedAt: 200,
      });
    });
  });

  it("shows the selected OpenAI image runtime in the console read model", async () => {
    await withStateDirEnv("aics-execution-selected-model-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({ openai: "sk-role-exec-test", deepseek: "sk-role-exec-test" }),
        "utf8",
      );
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: { defaultModel: "auto" },
            },
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["model", "role_execution"],
              metadata: { defaultModel: "deepseek-chat" },
            },
          },
        },
      };
      const prepared = prepareExecutableTask(new AicsMainFlowStore());

      const readModel = await callExecutionConsoleReadModel();

      expect((readModel.summary as Record<string, unknown>).selectedModelRef).toMatchObject({
        entryId: "model-openai",
        provider: "openai",
        model: "auto",
        modelRef: "openai/auto",
      });
      expect(readModel.blockedReasons).toEqual([]);
      expect(readModel.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: prepared.dispatchToRoleRequestId,
            status: "ready",
            canRun: true,
            selectedModelRef: expect.objectContaining({
              entryId: "model-openai",
              provider: "openai",
              model: "auto",
            }),
          }),
        ]),
      );
    });
  });

  it("treats an image-only OpenAI auto connection as ready for role execution", async () => {
    await withStateDirEnv("aics-execution-image-only-openai-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(secretPath, JSON.stringify({ openai: "sk-image-only-test" }), "utf8");
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-openai-image": {
              id: "model-openai-image",
              name: "OpenAI Images",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["image"],
              metadata: { defaultModel: "auto" },
            },
          },
        },
      };
      const prepared = prepareExecutableTask(new AicsMainFlowStore());

      const readModel = await callExecutionConsoleReadModel();

      expect(readModel.blockedReasons).toEqual([]);
      expect((readModel.summary as Record<string, unknown>).selectedModelRef).toMatchObject({
        entryId: "model-openai-image",
        provider: "openai",
        model: "auto",
        modelRef: "openai/auto",
      });
      expect(readModel.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: prepared.dispatchToRoleRequestId,
            status: "ready",
            canRun: true,
            blockedReason: null,
            selectedModelRef: expect.objectContaining({
              entryId: "model-openai-image",
              model: "auto",
            }),
          }),
        ]),
      );
    });
  });

  it("treats an OAuth OpenAI auto connection as ready without requiring an API key", async () => {
    await withStateDirEnv("aics-execution-oauth-openai-", async () => {
      currentConfig = {
        apiConnections: {
          entries: {
            "model-openai-oauth": {
              id: "model-openai-oauth",
              name: "OpenAI OAuth",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com/v1",
              authMode: "oauth",
              consumers: ["image", "role_execution"],
              metadata: { defaultModel: "auto" },
            },
          },
        },
      };
      const prepared = prepareExecutableTask(new AicsMainFlowStore());

      const readModel = await callExecutionConsoleReadModel();

      expect(readModel.blockedReasons).toEqual([]);
      expect((readModel.summary as Record<string, unknown>).selectedModelRef).toMatchObject({
        entryId: "model-openai-oauth",
        provider: "openai",
        model: "auto",
        modelRef: "openai/auto",
      });
      expect(readModel.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: prepared.dispatchToRoleRequestId,
            status: "ready",
            canRun: true,
            blockedReason: null,
            selectedModelRef: expect.objectContaining({
              entryId: "model-openai-oauth",
              model: "auto",
            }),
          }),
        ]),
      );
    });
  });

  it("runs role execution through API Management SecretRef and records token usage", async () => {
    await withStateDirEnv("aics-execution-api-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(secretPath, JSON.stringify({ openai: "sk-role-exec-test" }), "utf8");
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: {
                defaultModel: "auto",
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 0.02,
                  outputCnyPerMillion: 0.02,
                },
              },
            },
          },
        },
      };
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer sk-role-exec-test",
        );
        return new Response(
          JSON.stringify({
            data: [{ b64_json: VALID_PNG_BASE64 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const prepared = prepareExecutableTask(new AicsMainFlowStore());
      const result = await callExecutionRun({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      if (result.ok !== true) {
        throw new Error(JSON.stringify(result));
      }
      expect(result.ok).toBe(true);
      expect(result.selectedModelRef).toMatchObject({
        entryId: "model-openai",
        provider: "openai",
        model: "auto",
        modelRef: "openai/auto",
      });
      expect(result.roleResult).toEqual(
        expect.objectContaining({
          artifactRefs: expect.arrayContaining([
            expect.stringMatching(/hero\.png$/u),
            expect.stringMatching(/detail\.html$/u),
            expect.stringMatching(/execution-summary\.json$/u),
            expect.stringMatching(/artifact-manifest\.json$/u),
            expect.stringMatching(/artifacts\.zip$/u),
          ]),
          executionEvidence: expect.objectContaining({
            ledgerRef: expect.stringMatching(/^ledger:role_execution:entitlement-zero-yuan-1:/u),
          }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.openai.com/v1/images/generations",
      );
      const metering = currentConfig.apiConnections?.entries?.["model-openai"]?.metadata
        ?.metering as Record<string, unknown> | undefined;
      expect(metering).toBeUndefined();
      const storedResult = new AicsMainFlowStore().readModel().latest.roleResult;
      expect(storedResult?.artifactRefs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/execution-summary\.json$/u),
          expect.stringMatching(/artifacts\.zip$/u),
        ]),
      );
      expect(storedResult?.executionEvidence?.ledgerRef).toMatch(
        /^ledger:role_execution:entitlement-zero-yuan-1:/u,
      );
      const recordedCountBefore = new AicsMainFlowStore().readModel().objects.roleResults.length;
      const executionId = String(result.executionId);
      const roleResult = result.roleResult as Record<string, unknown>;
      const executionEvidence = roleResult.executionEvidence as Record<string, unknown>;
      const idempotentRecord = await callExecutionResultRecord({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        executionId,
        ok: true,
        status: "completed",
        summary: String(roleResult.summary ?? ""),
        artifactRefs: roleResult.artifactRefs,
        auditRecordId: `audit-${executionId}`,
        ledgerRef: String(executionEvidence.ledgerRef),
        executionEvidence,
      });

      expect(idempotentRecord).toMatchObject({
        ok: true,
        idempotent: true,
        executionId,
      });
      expect(new AicsMainFlowStore().readModel().objects.roleResults).toHaveLength(
        recordedCountBefore,
      );
      const rerun = await callExecutionRun({
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });
      expect(rerun).toMatchObject({
        ok: false,
        status: "blocked",
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
        blockedReasons: [
          "该派发单已经执行完成并生成结果，不能重复运行。需要重新执行时请先由任务调度生成新的派发单。",
        ],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("runs the UI role task RPC through execution-token, model execution, audit upload, and ledger readback", async () => {
    await withStateDirEnv("dijie-role-task-run-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({ openai: "sk-role-exec-test", cloud: "cloud-operator-token" }),
        "utf8",
      );
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        plugins: {
          entries: {
            aics: {
              enabled: true,
              config: {
                defaultDeviceId: "device-local-admin",
                defaultWorkspaceRef: "workspace-local-admin",
                defaultLocalGatewayId: "gateway-local-admin",
              },
            },
          },
        },
        apiConnections: {
          entries: {
            "marketplace-dijie-cloud-bridge": {
              id: "marketplace-dijie-cloud-bridge",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "https://cloud.example.test",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/cloud" },
              consumers: ["marketplace", "role_execution"],
            },
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: {
                defaultModel: "auto",
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 0.02,
                  outputCnyPerMillion: 0.02,
                },
              },
            },
          },
        },
      };

      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const target = String(url);
        if (target === "https://cloud.example.test/dijie/execution-token") {
          expect((init?.headers as Record<string, string>).authorization).toBe(
            "Bearer cloud-operator-token",
          );
          return new Response(
            JSON.stringify({
              ok: true,
              grant: {
                executionId: "exec-cloud-1",
                roleListingId: "role-ecommerce-designer",
                packageId: "pkg-marketplace-ops",
                packageVersion: "1.0.0",
                developerRef: "dev-platform-admin",
                listingOwnerRef: "seller-platform-admin",
                billingBeneficiaryRef: "dev-platform-admin",
                entitlementId: "entitlement-zero-yuan-1",
                deviceId: "device-local-admin",
                workspaceRef: "workspace-local-admin",
                localGatewayId: "gateway-local-admin",
                token: "execution-token-1",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (target === "https://api.openai.com/v1/images/generations") {
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer sk-role-exec-test",
          );
          return new Response(
            JSON.stringify({
              data: [{ b64_json: VALID_PNG_BASE64 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (target === "https://cloud.example.test/dijie/audit") {
          expect((init?.headers as Record<string, string>).authorization).toBe(
            "Bearer execution-token-1",
          );
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          expect(body.auditSummary).toMatchObject({
            roleListingId: "role-ecommerce-designer",
            entitlementId: "entitlement-zero-yuan-1",
            status: "completed",
          });
          return new Response(
            JSON.stringify({
              ok: true,
              executionId: "exec-cloud-1",
              auditRecordId: "djaudit_1",
              billingSummary: { source: "role_usage", executionId: "exec-cloud-1" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${target}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const prepared = prepareExecutableTask(new AicsMainFlowStore());
      const result = await callRoleTaskRun({
        role_listing_id: "role-ecommerce-designer",
        entitlement_id: "entitlement-zero-yuan-1",
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "completed",
        auditUpload: { auditRecordId: "djaudit_1" },
        billingSummary: {
          source: "role_usage",
          ledgerRef: expect.stringMatching(/^ledger:role_execution:entitlement-zero-yuan-1:/u),
        },
      });
      expect(result).not.toHaveProperty("memoryCandidates");
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
        "https://cloud.example.test/dijie/execution-token",
        "https://api.openai.com/v1/images/generations",
        "https://cloud.example.test/dijie/audit",
      ]);
    });
  });

  it("downgrades a model-successful cloud role execution when audit upload fails", async () => {
    await withStateDirEnv("dijie-role-task-audit-fail-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({ openai: "sk-role-exec-test", cloud: "cloud-operator-token" }),
        "utf8",
      );
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        plugins: {
          entries: {
            aics: {
              enabled: true,
              config: {
                defaultDeviceId: "device-local-admin",
                defaultWorkspaceRef: "workspace-local-admin",
                defaultLocalGatewayId: "gateway-local-admin",
              },
            },
          },
        },
        apiConnections: {
          entries: {
            "marketplace-dijie-cloud-bridge": {
              id: "marketplace-dijie-cloud-bridge",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "https://cloud.example.test",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/cloud" },
              consumers: ["marketplace", "role_execution"],
            },
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: { defaultModel: "auto" },
            },
          },
        },
      };

      const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
        const target = String(url);
        if (target === "https://cloud.example.test/dijie/execution-token") {
          return new Response(
            JSON.stringify({
              ok: true,
              grant: {
                executionId: "exec-cloud-audit-fail",
                roleListingId: "role-ecommerce-designer",
                packageId: "pkg-marketplace-ops",
                packageVersion: "1.0.0",
                developerRef: "dev-platform-admin",
                listingOwnerRef: "seller-platform-admin",
                billingBeneficiaryRef: "dev-platform-admin",
                entitlementId: "entitlement-zero-yuan-1",
                deviceId: "device-local-admin",
                workspaceRef: "workspace-local-admin",
                localGatewayId: "gateway-local-admin",
                token: "execution-token-audit-fail",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (target === "https://api.openai.com/v1/images/generations") {
          return new Response(
            JSON.stringify({
              data: [{ b64_json: VALID_PNG_BASE64 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (target === "https://cloud.example.test/dijie/audit") {
          return new Response(JSON.stringify({ ok: false, error: "audit unavailable" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch: ${target}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const prepared = prepareExecutableTask(new AicsMainFlowStore());
      const result = await callRoleTaskRun({
        role_listing_id: "role-ecommerce-designer",
        entitlement_id: "entitlement-zero-yuan-1",
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        blockedReasons: [expect.stringContaining("audit unavailable")],
        roleResult: {
          status: "failed",
          outcome: "blocked",
          summary: expect.stringContaining("audit unavailable"),
        },
      });
      const readModel = new AicsMainFlowStore().readModel();
      expect(readModel.latest.roleResult).toMatchObject({
        status: "failed",
        outcome: "blocked",
        summary: expect.stringContaining("audit unavailable"),
      });
      expect(readModel.latest.dispatchToRoleRequest?.status).toBe("blocked");
      expect(readModel.latest.taskPackage?.status).toBe("blocked");
      expect(RoleInstanceStore.getRunByExecutionId(String(result.executionId))).toMatchObject({
        status: "blocked",
        error: expect.stringContaining("audit unavailable"),
      });
    });
  });

  it("blocks role task RPC before requesting execution-token when dispatch cost is unconfirmed", async () => {
    await withStateDirEnv("dijie-role-task-preflight-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({ deepseek: "sk-role-exec-test", cloud: "cloud-operator-token" }),
        "utf8",
      );
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "marketplace-dijie-cloud-bridge": {
              id: "marketplace-dijie-cloud-bridge",
              name: "迭界AI云端",
              kind: "marketplace",
              provider: "dijie-cloud-bridge",
              baseUrl: "https://cloud.example.test",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/cloud" },
              consumers: ["marketplace", "role_execution"],
            },
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["model", "role_execution"],
            },
          },
        },
      };
      const store = new AicsMainFlowStore();
      const prepared = prepareExecutableTask(store);
      store.update((state) => {
        const request = state.dispatchToRoleRequests.find(
          (item) => item.id === prepared.dispatchToRoleRequestId,
        );
        if (request) {
          request.costConfirmed = false;
          delete request.ledgerRef;
        }
        return request;
      });
      const fetchMock = vi.fn(async () => {
        throw new Error("execution-token must not be requested before local preflight passes");
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await callRoleTaskRun({
        role_listing_id: "role-ecommerce-designer",
        entitlement_id: "entitlement-zero-yuan-1",
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "cost_not_confirmed",
          }),
        ]),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("blocks role task RPC when the caller omits explicit execution or cost confirmation", async () => {
    await withStateDirEnv("dijie-role-task-explicit-confirmation-", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error(
          "execution must not request external services without explicit confirmation",
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const missingExecutionConfirm = await callRoleTaskRun({
        role_listing_id: "role-ecommerce-designer",
        entitlement_id: "entitlement-zero-yuan-1",
        costConfirmed: true,
      });
      expect(missingExecutionConfirm).toMatchObject({
        ok: false,
        status: "blocked",
        blockedReasons: ["岗位执行需要显式传入 confirmExecution=true。"],
      });

      const missingCostConfirm = await callRoleTaskRun({
        role_listing_id: "role-ecommerce-designer",
        entitlement_id: "entitlement-zero-yuan-1",
        confirmExecution: true,
      });
      expect(missingCostConfirm).toMatchObject({
        ok: false,
        status: "blocked",
        blockedReasons: ["岗位执行需要显式传入 costConfirmed=true。"],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("runs a local zero-yuan entitlement without requiring a cloud execution-token", async () => {
    await withStateDirEnv("dijie-local-role-task-run-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(secretPath, JSON.stringify({ openai: "sk-role-exec-test" }), "utf8");
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: {
                defaultModel: "auto",
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 0.02,
                  outputCnyPerMillion: 0.02,
                },
              },
            },
          },
        },
      };
      const review = startRolePreListingReview({
        packageDir: path.join(tempRoot, "pkg-marketplace-ops"),
        rolePackageId: "pkg-marketplace-ops",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const listing = publishLocalRoleListing({
        reviewId: review.id,
        rolePackageId: "pkg-marketplace-ops",
        title: "商城运营诊断官",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
      });
      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const target = String(url);
        expect(target).toBe("https://api.openai.com/v1/images/generations");
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer sk-role-exec-test",
        );
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body.model).toBe("gpt-image-1");
        return new Response(
          JSON.stringify({
            data: [{ b64_json: VALID_PNG_BASE64 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        roleListingId: listing.roleListingId,
        roleTitle: listing.title,
        entitlementId: entitlement.entitlementId,
        ledgerRef: `ledger:pending:${entitlement.entitlementId}`,
      });
      const result = await callRoleTaskRun({
        role_listing_id: listing.roleListingId,
        entitlement_id: entitlement.entitlementId,
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      expect(result).toMatchObject({
        ok: true,
        status: "completed",
        mode: "local",
        auditUpload: {
          source: "local",
          billingSummary: {
            authorizationFeeCents: 0,
            executionFeeCents: 0,
            source: "local_zero_price",
          },
        },
      });
      const executionId = String(result.executionId);
      const auditUpload = result.auditUpload as Record<string, unknown>;
      const billingSummary = result.billingSummary as Record<string, unknown>;
      const roleResult = result.roleResult as Record<string, unknown>;
      const executionEvidence = roleResult.executionEvidence as Record<string, unknown>;
      expect(roleResult.artifactRefs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/hero\.png$/u),
          expect.stringMatching(/detail\.html$/u),
          expect.stringMatching(/execution-summary\.json$/u),
          expect.stringMatching(/artifacts\.zip$/u),
        ]),
      );
      expect(executionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
      );
      expect(String(auditUpload.auditRecordId)).toBe(`local_audit_${executionId}`);
      expect(String(billingSummary.ledgerRef)).toBe(
        `ledger:role_execution:${entitlement.entitlementId}:${executionId}`,
      );
      expect(String(executionEvidence.ledgerRef)).toBe(
        `ledger:role_execution:${entitlement.entitlementId}:${executionId}`,
      );
      const readback = await callExecutionEvidenceReadback({
        executionId,
        auditRecordId: String(auditUpload.auditRecordId),
        ledgerRef: String(billingSummary.ledgerRef),
      });
      expect(readback).toMatchObject({
        ok: true,
        status: "found",
        audit: {
          auditRecordId: `local_audit_${executionId}`,
          executionId,
          roleListingId: listing.roleListingId,
          entitlementId: entitlement.entitlementId,
          status: "completed",
          ledgerRef: `ledger:role_execution:${entitlement.entitlementId}:${executionId}`,
        },
        ledger: {
          ledgerRef: `ledger:role_execution:${entitlement.entitlementId}:${executionId}`,
          executionId,
          roleListingId: listing.roleListingId,
          entitlementId: entitlement.entitlementId,
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
          status: "posted",
        },
      });
      const consoleReadModel = await callExecutionConsoleReadModel();
      expect(consoleReadModel.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: prepared.dispatchToRoleRequestId,
            status: "completed",
            result: expect.objectContaining({
              executionEvidence: expect.objectContaining({
                auditReadback: expect.objectContaining({
                  auditRecordId: `local_audit_${executionId}`,
                }),
                ledgerReadback: expect.objectContaining({
                  ledgerRef: `ledger:role_execution:${entitlement.entitlementId}:${executionId}`,
                }),
              }),
            }),
          }),
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces provider API failures from local zero-yuan role execution", async () => {
    await withStateDirEnv("dijie-local-role-task-run-api-error-", async ({ tempRoot }) => {
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(secretPath, JSON.stringify({ openai: "sk-role-exec-test" }), "utf8");
      currentConfig = {
        secrets: {
          providers: {
            "api-test": {
              source: "file",
              path: secretPath,
              mode: "json",
              allowInsecurePath: true,
            },
          },
        },
        apiConnections: {
          entries: {
            "model-openai": {
              id: "model-openai",
              name: "OpenAI",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["model", "role_execution", "image"],
              metadata: {
                defaultModel: "auto",
              },
            },
          },
        },
      };
      const review = startRolePreListingReview({
        packageDir: path.join(tempRoot, "pkg-marketplace-ops"),
        rolePackageId: "pkg-marketplace-ops",
        category: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const listing = publishLocalRoleListing({
        reviewId: review.id,
        rolePackageId: "pkg-marketplace-ops",
        title: "商城运营诊断官",
        categoryRef: "category:marketplace-ops@1",
        requiredCapabilities: ["marketplace.read"],
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
      });
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const prepared = prepareExecutableTask(new AicsMainFlowStore(), {
        roleListingId: listing.roleListingId,
        roleTitle: listing.title,
        entitlementId: entitlement.entitlementId,
        ledgerRef: `ledger:pending:${entitlement.entitlementId}`,
      });
      const result = await callRoleTaskRun({
        role_listing_id: listing.roleListingId,
        entitlement_id: entitlement.entitlementId,
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: prepared.taskPackageId,
        dispatchToRoleRequestId: prepared.dispatchToRoleRequestId,
      });

      expect(result).toMatchObject({
        ok: false,
        status: "blocked",
      });
      expect(result.blockedReasons).toEqual(
        expect.arrayContaining([expect.stringContaining("OpenAI 图片 API 401")]),
      );
      expect(result.roleResult).toEqual(
        expect.objectContaining({
          outcome: "blocked",
          blockedReason: expect.stringContaining("OpenAI 图片 API 401"),
        }),
      );
      expect(result.executionId).toBe(
        String((result.roleResult as Record<string, unknown>).executionId),
      );
      expect(String(result.executionId)).not.toMatch(/^local_exec_/u);
      expect(result).not.toHaveProperty("auditUpload");
    });
  });
});
