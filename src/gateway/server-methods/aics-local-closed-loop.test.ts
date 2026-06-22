import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeMemoryDb, closePipelineDb, closeRoleInstancesDb } from "../../aics-main-flow/db.js";
import {
  createZeroPriceLocalRoleEntitlement,
  getLocalRoleExecutionAudit,
  getLocalRoleLedgerEntry,
  publishLocalRoleListing,
  recordLocalRoleExecutionReadback,
} from "../../aics-main-flow/local-role-marketplace.js";
import {
  approveCategoryCapabilityReview,
  approveRolePreListingReview,
  approveToolSkillReview,
  bindRolePreListingReviewCategory,
  createCategoryCapabilityRequest,
  runRolePreListingValidation,
  runToolSkillValidation,
  startRolePreListingReview,
  startToolSkillReview,
  syncCategoryCapabilityReviewToCloud,
} from "../../aics-main-flow/role-pre-listing-review.js";
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
import {
  ToolRegistry,
  type ToolCapabilityGroup,
  type ToolRegistration,
} from "../../aics-main-flow/tool-registry.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { withStateDirEnv } from "../../test-helpers/state-dir-env.js";

const { coreGatewayHandlers } = await import("../server-methods.js");

let currentConfig: OpenClawConfig = {};

afterEach(() => {
  closePipelineDb();
  closeRoleInstancesDb();
  closeMemoryDb();
  ToolRegistry._clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  currentConfig = {};
});

function makeLocalTool(capability: ToolCapabilityGroup): ToolRegistration {
  return {
    toolId: capability,
    name: capability,
    label: capability,
    description: "Local closed-loop test tool",
    capabilities: [capability],
    inputSchema: {},
    outputSchema: {},
    riskLevel: "low",
    requiresHumanConfirm: false,
    qualityCheckRules: [],
    enabled: true,
    source: "core",
    handler: async () => ({
      ok: true,
      output: {},
      artifactRefs: [],
      durationMs: 1,
      qualityCheckPassed: true,
    }),
  };
}

function registerLocalCapabilityTool(toolId: string, capabilities: string[]): void {
  ToolRegistry.register({
    ...makeLocalTool(capabilities[0] as ToolCapabilityGroup),
    toolId,
    name: toolId,
    label: toolId,
    capabilities: capabilities as ToolCapabilityGroup[],
  });
}

function registerLocalMarketplaceOpsTools(): void {
  registerLocalCapabilityTool("tool.platform.marketplace_read_model", [
    "marketplace.read",
    "gateway.role_read_model",
  ]);
  registerLocalCapabilityTool("tool.platform.audit_record", ["audit.record"]);
}

function localMarketplaceOpsValidationEvidence() {
  const emptyRequirements = { bins: [], anyBins: [], env: [], config: [], os: [] };
  return {
    skillsReport: {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/skills",
      skills: [
        {
          name: "Marketplace Ops Diagnosis",
          description: "商城运营诊断 Skill",
          source: "openclaw-managed",
          bundled: false,
          filePath: "/tmp/skills/marketplace-ops/SKILL.md",
          baseDir: "/tmp/skills/marketplace-ops",
          skillKey: "marketplace_ops_diagnosis",
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          blockedByAgentFilter: false,
          eligible: true,
          modelVisible: true,
          userInvocable: true,
          commandVisible: true,
          requirements: emptyRequirements,
          missing: emptyRequirements,
          configChecks: [],
          install: [],
        },
      ],
    },
  };
}

async function callGateway(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  const handler = coreGatewayHandlers[method];
  expect(handler).toBeTypeOf("function");
  await handler({
    req: { type: "req", id: `req-${method}`, method, params },
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
  if (!ok) throw new Error(JSON.stringify(error ?? payload));
  return payload as Record<string, unknown>;
}

async function writeMarketplaceOpsPackage(packageDir: string) {
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(
      {
        rolePackageId: "pkg-marketplace-ops-local",
        version: "1.0.0",
        name: "商城运营诊断官",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        workPatterns: ["analyze"],
        outputContracts: ["document", "json"],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(packageDir, "listing.md"), "# 商城运营诊断官\n", "utf8");
  await fs.writeFile(path.join(packageDir, "README.md"), "# README\n", "utf8");
  await fs.writeFile(path.join(packageDir, "validation.md"), "# smoke\n- [ ] pass\n", "utf8");
}

function createExecutableMarketplaceOpsTask(params: {
  roleListingId: string;
  entitlementId: string;
}) {
  const store = new AicsMainFlowStore();
  const obs = store.update((state) =>
    prepareObservation(state, {
      title: "商城运营观察",
      summary: "需要诊断岗位供给、授权转化、执行成功率、费用和审计。",
      signals: [
        {
          id: "signal-marketplace-ops-local",
          title: "本地闭环信号",
          summary: "本地岗位商城闭环需要可授权、可执行、可回写。",
          evidenceRefs: ["evidence:local-marketplace:closed-loop"],
        },
      ],
    }),
  );
  store.update((state) => confirmObservation(state, obs.id));
  const attr = store.update((state) =>
    prepareAttribution(state, {
      observationPackageId: obs.id,
      title: "商城运营归因",
      summary: "岗位商品说明、授权确认和执行回写是首轮主要断点。",
      findings: [
        {
          id: "finding-marketplace-ops-local",
          title: "本地闭环需要真实授权事实",
          summary: "岗位必须经过审核、上架、0 元授权后才能执行。",
          confidence: "high",
          observationSignalIds: ["signal-marketplace-ops-local"],
        },
      ],
    }),
  );
  store.update((state) => confirmAttribution(state, attr.id));
  const goal = store.update((state) =>
    createGoalCandidate(state, {
      attributionReportId: attr.id,
      observationPackageId: obs.id,
      title: "跑通商城运营岗位本地闭环",
      owner: "OpenClaw",
      metric: "本地岗位授权和执行成功率",
      target: "本地 0 元岗位可授权、可执行、可回写审计账本",
      rationale: "小白真人使用前必须证明主链路真实可用。",
    }),
  );
  store.update((state) => confirmGoal(state, goal.id));
  const plan = store.update((state) =>
    preparePlanning(state, {
      goalId: goal.id,
      title: "商城运营本地执行规划",
      summary: "调度商城运营诊断官输出运营诊断和行动建议。",
      rolePlanItems: [
        {
          title: "商城运营诊断",
          category: "商城运营",
          roleCapabilityRef: "marketplace-ops-local",
          taskIntent: "分析岗位商品、授权、执行、费用和审计状态。",
          expectedOutput: "商城运营诊断结果、行动建议和验收摘要。",
          humanConfirmationRequired: true,
        },
      ],
    }),
  );
  store.update((state) => confirmPlanning(state, plan.id));
  const proposal = store.update((state) =>
    createDispatchProposal(state, {
      planningPackageId: plan.id,
      title: "调度商城运营诊断官",
      riskSummary: "低风险，本地读取聚合状态并生成建议。",
      confirmationSummary: "确认岗位已授权、费用已确认后执行。",
    }),
  );
  store.update((state) => confirmDispatch(state, proposal.id));
  const materialized = store.update((state) =>
    materializeTaskPackage(state, {
      title: "任务：商城运营诊断",
      taskText: "输出本地岗位商城运营诊断，覆盖岗位商品、授权、执行、费用和审计。",
      capabilityResolution: {
        categoryCapabilityId: "category:marketplace-ops-local@1",
        category: "商城运营",
        allowedTools: ["tool.platform.marketplace_read_model", "tool.platform.audit_record"],
        allowedSkills: ["skill.platform.marketplace_ops_diagnosis"],
        dispatchReady: true,
        blockedReasons: [],
      },
      request: {
        roleListingId: params.roleListingId,
        roleTitle: "商城运营诊断官",
      },
    }),
  );
  store.update((state) =>
    confirmRoleExecution(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      roleListingId: params.roleListingId,
      roleTitle: "商城运营诊断官",
      entitlementId: params.entitlementId,
    }),
  );
  store.update((state) =>
    confirmRoleExecutionCost(state, {
      dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
      entitlementId: params.entitlementId,
      ledgerRef: `ledger:pending:${params.entitlementId}`,
    }),
  );
  return {
    taskPackageId: materialized.taskPackage.id,
    dispatchToRoleRequestId: materialized.dispatchToRoleRequest.id,
  };
}

describe("AICS local role marketplace closed loop", () => {
  it("keeps readiness in local mode when cloud bridge config exists but local mode is requested", async () => {
    await withStateDirEnv("aics-local-readiness-mode-", async () => {
      currentConfig = {
        plugins: {
          entries: {
            aics: {
              config: {
                cloudBaseUrl: "https://cloud-should-not-be-called.test",
                cloudAccessToken: "stale-cloud-token",
                defaultDeviceId: "device-local",
                defaultWorkspaceRef: "workspace-local",
                defaultLocalGatewayId: "gateway-local",
              },
            },
          },
        },
      };
      const fetchMock = vi.fn(async () => {
        throw new Error("cloud should not be called in local readiness mode");
      });
      vi.stubGlobal("fetch", fetchMock);

      const readiness = await callGateway("aics.closedLoop.readiness.get", {
        live: true,
        mode: "local",
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(readiness).toMatchObject({
        mode: "local",
        context: {
          cloudBaseUrl: null,
        },
      });
      expect(readiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "localMode" }),
          expect.objectContaining({ id: "localAuthorizedRole" }),
        ]),
      );
      expect(readiness.checks).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "cloudBaseUrl" })]),
      );
    });
  });

  it("explains that the first local blocker is missing role creation when no role review exists", async () => {
    await withStateDirEnv("aics-local-readiness-empty-", async () => {
      const readiness = await callGateway("aics.closedLoop.readiness.get", {
        mode: "local",
      });

      expect(readiness).toMatchObject({
        ok: false,
        status: "blocked",
        mode: "local",
        context: {
          rolesCount: 0,
          authorizedRolesCount: 0,
          roleReviewsCount: 0,
          categoryCapabilityRequestsCount: 0,
        },
      });
      expect(readiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localRolePreparation",
            status: "blocked",
            message: expect.stringContaining("还没有岗位审核单"),
          }),
          expect.objectContaining({
            id: "localAuthorizedRole",
            status: "blocked",
          }),
        ]),
      );
      expect(readiness.nextActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localRolePreparation",
            action: expect.stringContaining("开发者中心创建商城运营岗位"),
          }),
        ]),
      );
    });
  });

  it("explains when a reviewed role is waiting for the developer to confirm local listing", async () => {
    await withStateDirEnv("aics-local-readiness-waiting-listing-", async ({ tempRoot }) => {
      const packageDir = path.join(tempRoot, "pkg-marketplace-ops-waiting-listing");
      await writeMarketplaceOpsPackage(packageDir);
      const roleReview = startRolePreListingReview({
        packageDir,
        rolePackageId: "pkg-marketplace-ops-waiting-listing",
        developerId: "local-admin",
      });
      const categoryRequest = createCategoryCapabilityRequest({
        title: "商城运营品类能力",
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops-local@1",
        rolePackageId: "pkg-marketplace-ops-waiting-listing",
        developerId: "local-admin",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        toolSkillRequirements: [
          "tool.platform.marketplace_read_model",
          "tool.platform.audit_record",
          "skill.platform.marketplace_ops_diagnosis",
        ],
        reason: "商城运营诊断官需要正式品类能力包。",
      });
      for (const assetId of [
        "tool.platform.marketplace_read_model",
        "tool.platform.audit_record",
        "skill.platform.marketplace_ops_diagnosis",
      ]) {
        const review = startToolSkillReview({
          assetType: assetId.startsWith("skill.") ? "skill" : "tool",
          assetId,
          declaredCapabilities: [assetId],
        });
        registerLocalMarketplaceOpsTools();
        runToolSkillValidation(review.id, localMarketplaceOpsValidationEvidence());
        approveToolSkillReview(review.id);
      }
      approveCategoryCapabilityReview(categoryRequest.id);
      await syncCategoryCapabilityReviewToCloud(categoryRequest.id, {
        cloudBaseUrl: "https://local-category-sync.test",
        cloudAccessToken: "local-category-token",
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              categoryRef: "category:marketplace-ops-local@1",
              category: { category_ref: "category:marketplace-ops-local@1" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      });
      bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
      runRolePreListingValidation(roleReview.id);
      approveRolePreListingReview(roleReview.id);

      const readiness = await callGateway("aics.closedLoop.readiness.get", {
        mode: "local",
      });

      expect(readiness).toMatchObject({
        ok: false,
        status: "blocked",
        mode: "local",
        context: {
          rolesCount: 0,
          authorizedRolesCount: 0,
          roleReviewsCount: 1,
          categoryCapabilityRequestsCount: 1,
        },
      });
      expect(readiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localRolePreparation",
            status: "blocked",
            message: expect.stringContaining("等待岗位开发者确认上架"),
          }),
        ]),
      );
      expect(readiness.nextActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localRolePreparation",
            action: expect.stringContaining("岗位开发者在开发者中心确认上架"),
          }),
        ]),
      );
    });
  });

  it("blocks local readiness when audit and ledger exist but business artifacts are missing", async () => {
    await withStateDirEnv("aics-local-readiness-missing-artifact-", async ({ tempRoot }) => {
      const packageDir = path.join(tempRoot, "pkg-marketplace-ops-missing-artifact");
      await writeMarketplaceOpsPackage(packageDir);
      const roleReview = startRolePreListingReview({
        packageDir,
        rolePackageId: "pkg-marketplace-ops-missing-artifact",
        developerId: "local-admin",
      });
      const listing = publishLocalRoleListing({
        reviewId: roleReview.id,
        rolePackageId: "pkg-marketplace-ops-missing-artifact",
        title: "商城运营诊断官",
        categoryRef: "category:marketplace-ops-local@1",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        authorizationFeeCents: 0,
      });
      const entitlement = createZeroPriceLocalRoleEntitlement({
        roleListingId: listing.roleListingId,
        accountId: "local-admin",
      });
      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({
          deepseek: "sk-role-exec-test",
          openai: "sk-openai-role-exec-test",
        }),
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
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["role_execution"],
              metadata: {
                defaultModel: "deepseek-chat",
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
      const task = createExecutableMarketplaceOpsTask({
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
      });
      const executionId = "exec-missing-business-artifact";
      const auditRecordId = `local_audit_${executionId}`;
      const ledgerRef = `ledger:role_execution:${entitlement.entitlementId}:${executionId}`;
      await callGateway("aics.mainFlow.dispatch.runApprovedTask", {
        taskPackageId: task.taskPackageId,
        dispatchToRoleRequestId: task.dispatchToRoleRequestId,
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
        ledgerRef,
        result: {
          id: executionId,
          outcome: "succeeded",
          summary: "模型返回完成，但没有业务产物。",
          artifactRefs: [`audit:${auditRecordId}`],
        },
      });
      recordLocalRoleExecutionReadback({
        auditRecordId,
        executionId,
        roleListingId: listing.roleListingId,
        entitlementId: entitlement.entitlementId,
        status: "completed",
        summary: "模型返回完成，但没有业务产物。",
        ledgerRef,
        billingSummary: {
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        },
      });

      const readiness = await callGateway("aics.closedLoop.readiness.get", {
        roleListingId: listing.roleListingId,
      });

      expect(readiness).toMatchObject({
        ok: false,
        status: "blocked",
        mode: "local",
        context: {
          executionId,
          auditRecordId,
          ledgerRef,
        },
      });
      expect(readiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "localExecutionQueue", status: "pass" }),
          expect.objectContaining({
            id: "localEvidenceReadback",
            status: "blocked",
            message: expect.stringContaining("业务产物"),
          }),
        ]),
      );
      expect(readiness.nextActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localEvidenceReadback",
          }),
        ]),
      );
    });
  });

  it("creates, reviews, locally publishes, zero-authorizes, executes, and readbacks audit ledger facts", async () => {
    await withStateDirEnv("aics-local-closed-loop-", async ({ tempRoot }) => {
      const packageDir = path.join(tempRoot, "pkg-marketplace-ops-local");
      await writeMarketplaceOpsPackage(packageDir);

      const roleReview = startRolePreListingReview({
        packageDir,
        rolePackageId: "pkg-marketplace-ops-local",
        developerId: "local-admin",
      });
      const categoryRequest = createCategoryCapabilityRequest({
        title: "商城运营品类能力",
        categoryName: "商城运营",
        categoryRef: "category:marketplace-ops-local@1",
        rolePackageId: "pkg-marketplace-ops-local",
        developerId: "local-admin",
        requiredCapabilities: ["marketplace.read", "audit.record"],
        toolSkillRequirements: [
          "tool.platform.marketplace_read_model",
          "tool.platform.audit_record",
          "skill.platform.marketplace_ops_diagnosis",
        ],
        reason: "商城运营诊断官需要正式品类能力包。",
      });
      for (const assetId of [
        "tool.platform.marketplace_read_model",
        "tool.platform.audit_record",
        "skill.platform.marketplace_ops_diagnosis",
      ]) {
        const review = startToolSkillReview({
          assetType: assetId.startsWith("skill.") ? "skill" : "tool",
          assetId,
          declaredCapabilities: [assetId],
        });
        registerLocalMarketplaceOpsTools();
        runToolSkillValidation(review.id, localMarketplaceOpsValidationEvidence());
        approveToolSkillReview(review.id);
      }
      approveCategoryCapabilityReview(categoryRequest.id);
      await syncCategoryCapabilityReviewToCloud(categoryRequest.id, {
        cloudBaseUrl: "https://local-category-sync.test",
        cloudAccessToken: "local-category-token",
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              ok: true,
              categoryRef: "category:marketplace-ops-local@1",
              category: { category_ref: "category:marketplace-ops-local@1" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      });
      bindRolePreListingReviewCategory(roleReview.id, categoryRequest.id);
      const checked = runRolePreListingValidation(roleReview.id);
      expect(checked.validationStatus).toBe("已通过");
      approveRolePreListingReview(roleReview.id);

      currentConfig = {};
      const listingPayload = await callGateway("aics.roleDeveloper.submitForListing", {
        reviewId: roleReview.id,
      });
      const roleListingId = String((listingPayload.cloud as Record<string, unknown>).roleListingId);
      expect((listingPayload.cloud as Record<string, unknown>).mode).toBe("local");
      expect(roleListingId).toMatch(/^local_rolelisting_/u);

      const authorizationPayload = await callGateway("dijie.roleAuthorization.create", {
        roleListingId,
      });
      const entitlementId = String(authorizationPayload.entitlementId);
      expect(entitlementId).toMatch(/^local_entitlement_/u);

      const rolesPayload = await callGateway("dijie.marketplace.roles.list", {});
      expect(rolesPayload).toMatchObject({
        ok: true,
        mode: "local",
      });
      expect(rolesPayload.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            roleListingId,
            entitlementId,
            entitlementStatus: "authorized",
            authorizationFeeCents: 0,
          }),
        ]),
      );
      const minePayload = await callGateway("aics.roles.mine.readModel.get", {});
      expect(minePayload.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            roleListingId,
            entitlementId,
            entitlementStatus: "authorized",
            authorizationFeeCents: 0,
          }),
        ]),
      );

      const secretPath = path.join(tempRoot, "api-secrets.json");
      await fs.writeFile(
        secretPath,
        JSON.stringify({
          deepseek: "sk-role-exec-test",
          openai: "sk-openai-role-exec-test",
        }),
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
            "model-deepseek": {
              id: "model-deepseek",
              name: "DeepSeek",
              kind: "model",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/deepseek" },
              consumers: ["model"],
              metadata: {
                defaultModel: "deepseek-chat",
                pricing: {
                  currency: "CNY",
                  unit: "1M_tokens",
                  inputCnyPerMillion: 0.02,
                  outputCnyPerMillion: 0.02,
                },
              },
            },
            "model-openai-image": {
              id: "model-openai-image",
              name: "OpenAI 图片",
              kind: "model",
              provider: "openai",
              baseUrl: "https://api.openai.com",
              authMode: "secret_ref",
              secret: { source: "file", provider: "api-test", id: "/openai" },
              consumers: ["image", "role_execution"],
              metadata: {
                defaultModel: "gpt-image-1",
              },
            },
          },
        },
      };
      const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.openai.com/v1/images/generations");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer sk-openai-role-exec-test",
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
                  "base64",
                ).toString("base64"),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const task = createExecutableMarketplaceOpsTask({ roleListingId, entitlementId });
      const preRunReadiness = await callGateway("aics.closedLoop.readiness.get", {});
      expect(preRunReadiness).toMatchObject({
        ok: true,
        status: "ready",
        mode: "local",
        context: {
          roleListingId,
          entitlementId,
          dispatchToRoleRequestId: task.dispatchToRoleRequestId,
          taskPackageId: task.taskPackageId,
        },
      });
      expect(preRunReadiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "localMode", status: "pass" }),
          expect.objectContaining({ id: "roleExecutionModel", status: "pass" }),
          expect.objectContaining({ id: "localAuthorizedRole", status: "pass" }),
          expect.objectContaining({ id: "localExecutionQueue", status: "pass" }),
          expect.objectContaining({ id: "localEvidenceReadback", status: "skipped" }),
        ]),
      );
      expect(preRunReadiness.nextActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "localEvidenceReadback",
            action: expect.stringContaining("岗位执行页"),
          }),
        ]),
      );
      const runPayload = await callGateway("dijie.roleTask.run", {
        roleListingId,
        entitlementId,
        confirmExecution: true,
        costConfirmed: true,
        taskPackageId: task.taskPackageId,
        dispatchToRoleRequestId: task.dispatchToRoleRequestId,
      });

      expect(runPayload).toMatchObject({
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const auditUpload = runPayload.auditUpload as Record<string, unknown>;
      const billingSummary = runPayload.billingSummary as Record<string, unknown>;
      const auditRecordId = String(auditUpload.auditRecordId);
      const ledgerRef = String(billingSummary.ledgerRef);
      expect(getLocalRoleExecutionAudit(auditRecordId)).toMatchObject({
        auditRecordId,
        executionId: String(runPayload.executionId),
        roleListingId,
        entitlementId,
        status: "completed",
        ledgerRef,
        billingSummary: expect.objectContaining({
          authorizationFeeCents: 0,
          executionFeeCents: 0,
          source: "local_zero_price",
        }),
      });
      expect(getLocalRoleLedgerEntry(ledgerRef)).toMatchObject({
        ledgerRef,
        executionId: String(runPayload.executionId),
        roleListingId,
        entitlementId,
        authorizationFeeCents: 0,
        executionFeeCents: 0,
        source: "local_zero_price",
        status: "posted",
      });
      await expect(
        callGateway("aics.executionEvidence.readback.get", { ledgerRef }),
      ).resolves.toMatchObject({
        ok: true,
        status: "found",
        audit: {
          auditRecordId,
          executionId: String(runPayload.executionId),
          roleListingId,
          entitlementId,
        },
        ledger: {
          ledgerRef,
          executionId: String(runPayload.executionId),
          roleListingId,
          entitlementId,
        },
      });
      await expect(
        callGateway("aics.executionEvidence.readback.get", {
          executionId: String(runPayload.executionId),
        }),
      ).resolves.toMatchObject({
        ok: true,
        status: "found",
        audit: { auditRecordId },
        ledger: { ledgerRef },
      });
      await expect(
        callGateway("aics.executionEvidence.readback.get", { executionId: "missing-exec" }),
      ).resolves.toMatchObject({
        ok: false,
        status: "missing",
      });

      const consolePayload = await callGateway("aics.executionConsole.readModel.get", {});
      expect(consolePayload.summary).toMatchObject({ completed: 1 });
      const executionRows = consolePayload.executions as Array<Record<string, unknown>>;
      const completedExecution = executionRows.find(
        (item) => item.dispatchRequestId === task.dispatchToRoleRequestId,
      );
      const executionResult = completedExecution?.result as Record<string, unknown>;
      const executionEvidence = executionResult.executionEvidence as Record<string, unknown>;
      expect(executionEvidence.auditReadback).toMatchObject({
        auditRecordId,
        executionId: String(runPayload.executionId),
        roleListingId,
        entitlementId,
        status: "completed",
        ledgerRef,
      });
      expect(executionEvidence.ledgerReadback).toMatchObject({
        ledgerRef,
        executionId: String(runPayload.executionId),
        roleListingId,
        entitlementId,
        status: "posted",
      });
      const postRunReadiness = await callGateway("aics.closedLoop.readiness.get", {});
      expect(postRunReadiness).toMatchObject({
        ok: true,
        status: "ready",
        mode: "local",
        context: {
          roleListingId,
          entitlementId,
          executionId: String(runPayload.executionId),
          modelUsage: expect.objectContaining({
            totalTokens: 0,
          }),
        },
      });
      expect(postRunReadiness.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "localExecutionQueue", status: "pass" }),
          expect.objectContaining({
            id: "localEvidenceReadback",
            status: "pass",
            message: expect.stringContaining("模型费用证据"),
          }),
        ]),
      );
      expect(postRunReadiness.nextActions).toEqual([]);
      expect(consolePayload.executions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dispatchRequestId: task.dispatchToRoleRequestId,
            roleListingId,
            status: "completed",
            artifactRefs: expect.arrayContaining([
              expect.stringMatching(/^audit:/u),
              expect.stringContaining(`ledger:role_execution:${entitlementId}`),
            ]),
          }),
        ]),
      );
    });
  });
});
